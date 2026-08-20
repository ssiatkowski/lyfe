// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const ONE_DAY = 24 * 60 * 60 * 1000;
const VALID_OWNERS = new Set(['Sebo', 'Alomi', 'All']);
const VALID_TYPES = new Set(['todo', 'repeating', 'contact', 'birthday']);
const APP_URL = 'https://ssiatkowski.github.io/lyfe/';
const MAX_DOCS_PER_COLLECTION = 200;
const API_RATE_WINDOW_MS = 60 * 1000;
const API_RATE_MAX_PER_WINDOW = 30;
const apiRateBuckets = new Map();

function pacificDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateStringForTimestamp(timestamp) {
  return pacificDateString(new Date(timestamp));
}

function dateStringToSafeTimestamp(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString || '')) return NaN;
  const timestamp = Date.parse(`${dateString}T12:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function taskDueTimestamp(collectionName, task) {
  if (collectionName === 'repeatingTasks') return task.lastCompleted + task.frequency * ONE_DAY;
  if (collectionName === 'contactTasks') return task.lastContact + task.frequency * ONE_DAY;
  return task.dueDate;
}

function taskDisplayName(collectionName, task) {
  return collectionName === 'contactTasks' ? (task.contactName || task.name) : task.name;
}

function collectionForType(type) {
  if (type === 'repeating') return 'repeatingTasks';
  if (type === 'contact') return 'contactTasks';
  if (type === 'todo') return 'todos';
  if (type === 'birthday') return 'birthdays';
  return null;
}

//////////////////////////////////////////////////
// PWA push reminders
//////////////////////////////////////////////////
async function sendPushReminders(context) {
  const subscriptionsSnap = await db.collection('notificationSubscriptions').get();
  if (subscriptionsSnap.empty) return null;

  const tokensByOwner = new Map();
  subscriptionsSnap.forEach(docSnap => {
    const { owner, token } = docSnap.data();
    if (!VALID_OWNERS.has(owner) || owner === 'All' || !token) return;
    if (!tokensByOwner.has(owner)) tokensByOwner.set(owner, []);
    tokensByOwner.get(owner).push(token);
  });
  if (!tokensByOwner.size) return null;

  const owners = [...tokensByOwner.keys()];
  const queryOwners = [...new Set([...owners, 'All'])];
  const collections = ['repeatingTasks', 'contactTasks', 'todos', 'birthdays'];
  const snapshots = await Promise.all(
    collections.map(name => db.collection(name).where('owner', 'in', queryOwners).get())
  );

  const today = pacificDateString();
  const alertsByOwner = new Map(owners.map(owner => [owner, { dueToday: [], overdue: [] }]));

  snapshots.forEach((snapshot, index) => {
    const collectionName = collections[index];
    snapshot.forEach(docSnap => {
      const task = docSnap.data();
      const dueTimestamp = taskDueTimestamp(collectionName, task);
      if (!Number.isFinite(dueTimestamp)) return;
      const dueDate = dateStringForTimestamp(dueTimestamp);
      if (dueDate > today) return;

      const recipients = task.owner === 'All' ? owners : [task.owner];
      const bucketName = dueDate < today ? 'overdue' : 'dueToday';
      const name = taskDisplayName(collectionName, task);
      recipients.forEach(owner => {
        const alerts = alertsByOwner.get(owner);
        if (alerts && name) alerts[bucketName].push(name);
      });
    });
  });

  const sends = [];
  for (const [owner, tokens] of tokensByOwner.entries()) {
    const alerts = alertsByOwner.get(owner);
    if (!alerts || (!alerts.dueToday.length && !alerts.overdue.length)) continue;
    const total = alerts.dueToday.length + alerts.overdue.length;
    const pieces = [];
    if (alerts.overdue.length) pieces.push(`${alerts.overdue.length} overdue`);
    if (alerts.dueToday.length) pieces.push(`${alerts.dueToday.length} due today`);
    const title = context === 'Morning'
      ? `Lyfe: ${total} task${total === 1 ? '' : 's'} need attention`
      : `Lyfe: ${total} task${total === 1 ? '' : 's'} remaining`;

    sends.push(admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body: pieces.join(' · ') },
      webpush: { fcmOptions: { link: `${APP_URL}?user=${encodeURIComponent(owner)}` } }
    }));
  }
  return Promise.all(sends);
}

const reminderSpecs = [
  { name: 'Morning', cron: '0 7 * * *' },
  { name: 'Night', cron: '0 20 * * *' }
];

for (const spec of reminderSpecs) {
  exports[`push${spec.name}`] = functions
    .region('us-west2')
    .pubsub
    .schedule(spec.cron)
    .timeZone('America/Los_Angeles')
    .onRun(() => sendPushReminders(spec.name));
}

//////////////////////////////////////////////////
// ChatGPT task API
//
// Two separate secrets bind callers to one person. The API never accepts an
// arbitrary person name for private tasks: Sebo's secret sees/writes Sebo + All,
// while Alomi's sees/writes Alomi + All.
//
// Cost guardrails:
// - no background work or listeners
// - at most four owner-filtered reads for a list operation
// - each collection query is capped at 200 documents
// - add = one Firestore write
// - modify = one document read + one write
// - maxInstances=1 and an in-memory 30 requests/minute safety throttle
//////////////////////////////////////////////////
function getCallerOwner(req) {
  const supplied = String(req.get('X-Lyfe-Key') || '');
  if (!supplied) return null;
  if (process.env.LYFE_SEBO_API_KEY && supplied === process.env.LYFE_SEBO_API_KEY) return 'Sebo';
  if (process.env.LYFE_ALOMI_API_KEY && supplied === process.env.LYFE_ALOMI_API_KEY) return 'Alomi';
  return null;
}

function allowApiRequest(owner) {
  const now = Date.now();
  const bucket = apiRateBuckets.get(owner);
  if (!bucket || now - bucket.startedAt >= API_RATE_WINDOW_MS) {
    apiRateBuckets.set(owner, { startedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= API_RATE_MAX_PER_WINDOW) return false;
  bucket.count += 1;
  return true;
}

async function readDueTasks(owner, throughDate) {
  const owners = [owner, 'All'];
  const result = [];
  const collections = ['repeatingTasks', 'contactTasks', 'todos', 'birthdays'];
  const snapshots = await Promise.all(
    collections.map(name => db.collection(name)
      .where('owner', 'in', owners)
      .limit(MAX_DOCS_PER_COLLECTION)
      .get())
  );

  snapshots.forEach((snapshot, index) => {
    const collectionName = collections[index];
    snapshot.forEach(docSnap => {
      const task = docSnap.data();
      const dueTimestamp = taskDueTimestamp(collectionName, task);
      if (!Number.isFinite(dueTimestamp)) return;
      if (dateStringForTimestamp(dueTimestamp) > throughDate) return;

      const type = collectionName === 'repeatingTasks'
        ? 'repeating'
        : collectionName === 'contactTasks'
          ? 'contact'
          : collectionName === 'todos'
            ? 'todo'
            : 'birthday';

      const item = {
        id: docSnap.id,
        type,
        name: taskDisplayName(collectionName, task),
        owner: task.owner,
        dueDate: dueTimestamp
      };
      if (task.frequency) item.frequency = task.frequency;
      result.push(item);
    });
  });

  return result.sort((a, b) => a.dueDate - b.dueDate);
}

function buildNewTask(type, name, owner, dueDate, frequency) {
  const todayTimestamp = dateStringToSafeTimestamp(pacificDateString());
  if (type === 'todo' || type === 'birthday') {
    const due = dateStringToSafeTimestamp(dueDate);
    if (!Number.isFinite(due)) return { error: 'dueDate must be YYYY-MM-DD' };
    return {
      collectionName: collectionForType(type),
      data: { owner, name: name.trim(), dueDate: due, type }
    };
  }

  const freq = Number(frequency);
  if (!Number.isInteger(freq) || freq < 1) return { error: 'frequency must be a positive integer' };
  if (type === 'repeating') {
    return {
      collectionName: 'repeatingTasks',
      data: { owner, name: name.trim(), frequency: freq, lastCompleted: todayTimestamp, streak: 0, type: 'repeating' }
    };
  }
  return {
    collectionName: 'contactTasks',
    data: { owner, contactName: name.trim(), frequency: freq, lastContact: todayTimestamp, streak: 0, type: 'contact' }
  };
}

function buildTaskUpdates(type, body) {
  const updates = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return { error: 'name must be a non-empty string' };
    if (type === 'contact') updates.contactName = body.name.trim();
    else updates.name = body.name.trim();
  }

  if (body.owner !== undefined) {
    if (body.owner !== 'self' && body.owner !== 'All') return { error: 'owner must be self or All' };
    updates.owner = body.owner; // converted to caller owner later
  }

  if (body.frequency !== undefined) {
    if (type !== 'repeating' && type !== 'contact') return { error: 'frequency only applies to repeating/contact tasks' };
    const freq = Number(body.frequency);
    if (!Number.isInteger(freq) || freq < 1) return { error: 'frequency must be a positive integer' };
    updates.frequency = freq;
  }

  if (body.dueDate !== undefined) {
    if (type !== 'todo' && type !== 'birthday') return { error: 'dueDate only applies to todo/birthday tasks' };
    const due = dateStringToSafeTimestamp(body.dueDate);
    if (!Number.isFinite(due)) return { error: 'dueDate must be YYYY-MM-DD' };
    updates.dueDate = due;
  }

  if (!Object.keys(updates).length) return { error: 'No supported fields supplied to modify' };
  return { updates };
}

exports.taskApi = functions
  .runWith({
    secrets: ['LYFE_SEBO_API_KEY', 'LYFE_ALOMI_API_KEY'],
    maxInstances: 1
  })
  .region('us-west2')
  .https
  .onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Lyfe-Key');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).send('');

    const callerOwner = getCallerOwner(req);
    if (!callerOwner) return res.status(401).json({ error: 'Unauthorized' });
    if (!allowApiRequest(callerOwner)) {
      return res.status(429).json({ error: 'Too many requests; try again in a minute' });
    }

    try {
      if (req.method === 'GET') {
        const through = req.query.through || pacificDateString();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) {
          return res.status(400).json({ error: 'through must be YYYY-MM-DD' });
        }
        const tasks = await readDueTasks(callerOwner, through);
        return res.json({ owner: callerOwner, through, count: tasks.length, tasks });
      }

      if (req.method === 'POST') {
        const { type, name, owner = 'self', dueDate, frequency } = req.body || {};
        if (!VALID_TYPES.has(type)) return res.status(400).json({ error: 'Invalid type' });
        if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name is required' });
        if (owner !== 'self' && owner !== 'All') return res.status(400).json({ error: 'owner must be self or All' });
        const actualOwner = owner === 'All' ? 'All' : callerOwner;
        const built = buildNewTask(type, name, actualOwner, dueDate, frequency);
        if (built.error) return res.status(400).json({ error: built.error });
        const ref = await db.collection(built.collectionName).add(built.data);
        return res.status(201).json({ id: ref.id, ...built.data });
      }

      if (req.method === 'PATCH') {
        const { id, type } = req.body || {};
        if (typeof id !== 'string' || !id.trim()) return res.status(400).json({ error: 'id is required' });
        if (!VALID_TYPES.has(type)) return res.status(400).json({ error: 'Invalid type' });
        const collectionName = collectionForType(type);
        const ref = db.collection(collectionName).doc(id.trim());
        const existingSnap = await ref.get();
        if (!existingSnap.exists) return res.status(404).json({ error: 'Task not found' });
        const existing = existingSnap.data();
        if (existing.owner !== callerOwner && existing.owner !== 'All') {
          return res.status(403).json({ error: 'Task belongs to another user' });
        }

        const built = buildTaskUpdates(type, req.body);
        if (built.error) return res.status(400).json({ error: built.error });
        if (built.updates.owner === 'self') built.updates.owner = callerOwner;
        await ref.update(built.updates);
        return res.json({ id: id.trim(), type, updated: built.updates });
      }

      return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
      console.error('taskApi error', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
