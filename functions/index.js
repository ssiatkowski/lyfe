// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const ONE_DAY = 24 * 60 * 60 * 1000;
const VALID_OWNERS = new Set(['Sebo', 'Alomi', 'All']);
const VALID_TYPES = new Set(['todo', 'repeating', 'contact', 'birthday']);
const APP_URL = 'https://ssiatkowski.github.io/lyfe/';

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
  if (collectionName === 'repeatingTasks') {
    return task.lastCompleted + task.frequency * ONE_DAY;
  }
  if (collectionName === 'contactTasks') {
    return task.lastContact + task.frequency * ONE_DAY;
  }
  return task.dueDate;
}

function taskDisplayName(collectionName, task) {
  return collectionName === 'contactTasks' ? (task.contactName || task.name) : task.name;
}

//////////////////////////////////////////////////
// PWA push reminders
//
// Reads occur only at the two scheduled reminder times. Each run first reads
// the small subscription collection and exits immediately if no devices are
// subscribed. With subscriptions present, it makes one filtered query against
// each of the four task collections. Sending notifications causes no Firestore
// writes.
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
      notification: {
        title,
        body: pieces.join(' · ')
      },
      webpush: {
        fcmOptions: {
          link: `${APP_URL}?user=${encodeURIComponent(owner)}`
        }
      }
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
// Minimal ChatGPT API
//
// Deliberately isolated from the web app. It performs Firestore work only
// when called: no listeners, polling, scheduled work, or background reads.
//////////////////////////////////////////////////
async function readDueTasks(owner, throughDate) {
  const owners = owner === 'All' ? ['Sebo', 'Alomi', 'All'] : [owner, 'All'];
  const result = [];
  const collections = ['repeatingTasks', 'contactTasks', 'todos', 'birthdays'];

  const snapshots = await Promise.all(
    collections.map(name => db.collection(name).where('owner', 'in', owners).get())
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

exports.taskApi = functions.region('us-west2').https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    if (req.method === 'GET') {
      const owner = req.query.owner || 'Sebo';
      if (!VALID_OWNERS.has(owner)) return res.status(400).json({ error: 'Invalid owner' });

      const through = req.query.through || pacificDateString();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) {
        return res.status(400).json({ error: 'through must be YYYY-MM-DD' });
      }

      const tasks = await readDueTasks(owner, through);
      return res.json({ owner, through, count: tasks.length, tasks });
    }

    if (req.method === 'POST') {
      const { type, name, owner = 'Sebo', dueDate, frequency } = req.body || {};
      if (!VALID_TYPES.has(type)) return res.status(400).json({ error: 'Invalid type' });
      if (!VALID_OWNERS.has(owner)) return res.status(400).json({ error: 'Invalid owner' });
      if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name is required' });

      let collectionName;
      let data;
      const todayTimestamp = dateStringToSafeTimestamp(pacificDateString());

      if (type === 'todo' || type === 'birthday') {
        const due = dateStringToSafeTimestamp(dueDate);
        if (!Number.isFinite(due)) return res.status(400).json({ error: 'dueDate must be YYYY-MM-DD' });
        collectionName = type === 'todo' ? 'todos' : 'birthdays';
        data = { owner, name: name.trim(), dueDate: due, type };
      } else {
        const freq = Number(frequency);
        if (!Number.isInteger(freq) || freq < 1) {
          return res.status(400).json({ error: 'frequency must be a positive integer' });
        }
        if (type === 'repeating') {
          collectionName = 'repeatingTasks';
          data = {
            owner,
            name: name.trim(),
            frequency: freq,
            lastCompleted: todayTimestamp,
            streak: 0,
            type: 'repeating'
          };
        } else {
          collectionName = 'contactTasks';
          data = {
            owner,
            contactName: name.trim(),
            frequency: freq,
            lastContact: todayTimestamp,
            streak: 0,
            type: 'contact'
          };
        }
      }

      const ref = await db.collection(collectionName).add(data);
      return res.status(201).json({ id: ref.id, ...data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('taskApi error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
