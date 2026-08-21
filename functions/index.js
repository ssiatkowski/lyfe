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

function daysBetweenDateStrings(earlier, later) {
  const a = dateStringToSafeTimestamp(earlier);
  const b = dateStringToSafeTimestamp(later);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / ONE_DAY));
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

function typeForCollection(collectionName) {
  if (collectionName === 'repeatingTasks') return 'repeating';
  if (collectionName === 'contactTasks') return 'contact';
  if (collectionName === 'todos') return 'todo';
  return 'birthday';
}

function normalizePublicOwner(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'sebo' || normalized === 'sebastian') return 'Sebo';
  if (normalized === 'alomi') return 'Alomi';
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
// Lyfe AI / ChatGPT task API
//
// GET is deliberately public and read-only so ordinary ChatGPT conversations
// can inspect current tasks without a custom GPT, plugin, or login. Public GET
// requires an explicit owner (Sebo/Sebastian or Alomi) and exposes only fields
// useful for planning; Firebase document IDs are withheld.
//
// POST/PATCH remain private. Two separate secrets bind write-capable callers to
// one person. Sebo's secret can only access Sebo + All, while Alomi's can only
// access Alomi + All. Delete is intentionally not exposed.
//
// Cost guardrails:
// - no API background work or polling
// - at most four owner-filtered reads for a list operation
// - each collection query capped at 200 documents
// - public reads rate-limited to 30/minute per owner and short-cacheable
// - add = one Firestore write
// - modify = one document read + one write
// - maxInstances=1 and an in-memory 30 requests/minute throttle
//////////////////////////////////////////////////
function getCallerOwner(req) {
  const supplied = String(req.get('X-Lyfe-Key') || '');
  if (!supplied) return null;
  if (process.env.LYFE_SEBO_API_KEY && supplied === process.env.LYFE_SEBO_API_KEY) return 'Sebo';
  if (process.env.LYFE_ALOMI_API_KEY && supplied === process.env.LYFE_ALOMI_API_KEY) return 'Alomi';
  return null;
}

function allowApiRequest(bucketName) {
  const now = Date.now();
  const bucket = apiRateBuckets.get(bucketName);
  if (!bucket || now - bucket.startedAt >= API_RATE_WINDOW_MS) {
    apiRateBuckets.set(bucketName, { startedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= API_RATE_MAX_PER_WINDOW) return false;
  bucket.count += 1;
  return true;
}

async function readDueTasks(owner, throughDate, includeIds = false) {
  const owners = [owner, 'All'];
  const result = [];
  const collections = ['repeatingTasks', 'contactTasks', 'todos', 'birthdays'];
  const snapshots = await Promise.all(
    collections.map(name => db.collection(name)
      .where('owner', 'in', owners)
      .limit(MAX_DOCS_PER_COLLECTION)
      .get())
  );

  const today = pacificDateString();

  snapshots.forEach((snapshot, index) => {
    const collectionName = collections[index];
    snapshot.forEach(docSnap => {
      const task = docSnap.data();
      const dueTimestamp = taskDueTimestamp(collectionName, task);
      if (!Number.isFinite(dueTimestamp)) return;

      const dueDate = dateStringForTimestamp(dueTimestamp);
      if (dueDate > throughDate) return;

      const status = dueDate < today ? 'overdue' : dueDate === today ? 'due_today' : 'upcoming';
      const item = {
        type: typeForCollection(collectionName),
        name: taskDisplayName(collectionName, task),
        owner: task.owner,
        dueDate,
        status,
        daysOverdue: status === 'overdue' ? daysBetweenDateStrings(dueDate, today) : 0
      };
      if (task.frequency) item.frequency = task.frequency;
      if (includeIds) item.id = docSnap.id;
      result.push(item);
    });
  });

  return result.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
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
    updates.owner = body.owner;
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

    const suppliedKey = String(req.get('X-Lyfe-Key') || '');
    const callerOwner = getCallerOwner(req);

    try {
      if (req.method === 'GET') {
        // If a caller supplies a key, require it to be valid. With no key,
        // use the explicit public owner query parameter.
        if (suppliedKey && !callerOwner) return res.status(401).json({ error: 'Unauthorized' });

        const publicOwner = normalizePublicOwner(req.query.owner);
        const owner = callerOwner || publicOwner;
        if (!owner) {
          return res.status(400).json({
            error: 'owner is required for public reads',
            acceptedOwners: ['Sebo', 'Sebastian', 'Alomi'],
            discovery: 'https://ssiatkowski.github.io/lyfe/lyfe-ai.json'
          });
        }

        const rateBucket = callerOwner ? `private:${callerOwner}` : `public:${owner}`;
        if (!allowApiRequest(rateBucket)) {
          return res.status(429).json({ error: 'Too many requests; try again in a minute' });
        }

        const through = req.query.through || pacificDateString();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) {
          return res.status(400).json({ error: 'through must be YYYY-MM-DD' });
        }

        // Public data can be cached very briefly to absorb accidental duplicate
        // fetches. Authenticated responses include IDs and must not be cached.
        if (callerOwner) res.set('Cache-Control', 'private, no-store');
        else res.set('Cache-Control', 'public, max-age=15, s-maxage=30');

        const tasks = await readDueTasks(owner, through, Boolean(callerOwner));
        return res.json({
          service: 'Lyfe',
          owner,
          today: pacificDateString(),
          through,
          count: tasks.length,
          tasks,
          discovery: 'https://ssiatkowski.github.io/lyfe/lyfe-ai.json'
        });
      }

      // All writes require a valid per-person secret.
      if (!callerOwner) return res.status(401).json({ error: 'Unauthorized' });
      if (!allowApiRequest(`private:${callerOwner}`)) {
        return res.status(429).json({ error: 'Too many requests; try again in a minute' });
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
