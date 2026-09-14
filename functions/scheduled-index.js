// Schedule-aware wrapper around the original Lyfe functions.
// Existing functions remain available; the read/history/reminder exports below
// replace only the functions whose due-date semantics need to understand
// scheduled repeating routines.
const base = require('./index.js');
Object.assign(exports, base);

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

const ONE_DAY = 24 * 60 * 60 * 1000;
const APP_URL = 'https://ssiatkowski.github.io/lyfe/';
const DISCOVERY_URL = 'https://ssiatkowski.github.io/lyfe/lyfe-ai.json';
const MAX_DOCS_PER_COLLECTION = 200;
const HISTORY_LIMIT = 100;
const VALID_PRIORITIES = new Set(['critical', 'important', 'routine', 'flexible', 'someday']);
const DEFAULT_PRIORITY = 'routine';
const WEEKDAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const apiRateBuckets = new Map();
const API_RATE_WINDOW_MS = 60 * 1000;
const API_RATE_MAX_PER_WINDOW = 30;

function pacificDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function pacificHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false
  }).format(date));
}

function dateStringForTimestamp(timestamp) {
  return pacificDateString(new Date(timestamp));
}

function dateStringToSafeTimestamp(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString || '')) return NaN;
  const timestamp = Date.parse(`${dateString}T12:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function addDays(dateString, days) {
  const ts = dateStringToSafeTimestamp(dateString);
  return new Date(ts + days * ONE_DAY).toISOString().slice(0, 10);
}

function dayOfWeekCode(dateString) {
  const ts = dateStringToSafeTimestamp(dateString);
  return WEEKDAY_CODES[new Date(ts).getUTCDay()];
}

function dayOfMonth(dateString) {
  return Number(dateString.slice(8, 10));
}

function daysBetweenDateStrings(earlier, later) {
  const a = dateStringToSafeTimestamp(earlier);
  const b = dateStringToSafeTimestamp(later);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / ONE_DAY));
}

function repeatStyleFor(task) {
  return task && (task.repeatStyle === 'weekdays' || task.repeatStyle === 'monthdays') ? task.repeatStyle : 'interval';
}

function matchesScheduledDate(task, dateString) {
  const style = repeatStyleFor(task);
  if (style === 'weekdays') {
    const days = Array.isArray(task.weekdays) ? task.weekdays : [];
    return days.includes(dayOfWeekCode(dateString));
  }
  if (style === 'monthdays') {
    const days = Array.isArray(task.monthDays) ? task.monthDays.map(Number) : [];
    return days.includes(dayOfMonth(dateString));
  }
  return false;
}

function nextScheduledDate(task, fromDateString = pacificDateString()) {
  const lastCompletedDate = Number(task.lastCompleted) ? dateStringForTimestamp(Number(task.lastCompleted)) : null;
  for (let i = 0; i <= 370; i++) {
    const candidate = addDays(fromDateString, i);
    if (!matchesScheduledDate(task, candidate)) continue;
    if (i === 0 && lastCompletedDate === candidate) continue;
    return candidate;
  }
  return null;
}

function taskDueDate(collectionName, task, today = pacificDateString()) {
  if (collectionName === 'repeatingTasks') {
    if (repeatStyleFor(task) !== 'interval') return nextScheduledDate(task, today);
    const due = Number(task.lastCompleted) + Number(task.frequency) * ONE_DAY;
    return Number.isFinite(due) ? dateStringForTimestamp(due) : null;
  }
  if (collectionName === 'contactTasks') {
    const due = Number(task.lastContact) + Number(task.frequency) * ONE_DAY;
    return Number.isFinite(due) ? dateStringForTimestamp(due) : null;
  }
  return Number.isFinite(Number(task.dueDate)) ? dateStringForTimestamp(Number(task.dueDate)) : null;
}

function taskDisplayName(collectionName, task) {
  return collectionName === 'contactTasks' ? (task.contactName || task.name) : task.name;
}

function typeForCollection(collectionName) {
  if (collectionName === 'repeatingTasks') return 'repeating';
  if (collectionName === 'contactTasks') return 'contact';
  if (collectionName === 'todos') return 'todo';
  return 'birthday';
}

function collectionForType(type) {
  if (type === 'repeating') return 'repeatingTasks';
  if (type === 'contact') return 'contactTasks';
  if (type === 'todo') return 'todos';
  if (type === 'birthday') return 'birthdays';
  return null;
}

function normalizePublicOwner(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'sebo' || normalized === 'sebastian') return 'Sebo';
  if (normalized === 'alomi') return 'Alomi';
  return null;
}

function normalizedPriority(collectionName, task) {
  if (collectionName !== 'repeatingTasks' && collectionName !== 'todos') return null;
  return VALID_PRIORITIES.has(task.priority) ? task.priority : DEFAULT_PRIORITY;
}

function shouldIncludeInRegularReminder(collectionName, task) {
  const priority = normalizedPriority(collectionName, task);
  if (!priority) return true;
  return priority !== 'flexible' && priority !== 'someday';
}

function completionHistoryDocId(type, taskId) {
  return `${type}__${taskId}`;
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

async function readDueTasks(owner, throughDate) {
  const owners = [owner, 'All'];
  const result = [];
  const collections = ['repeatingTasks', 'contactTasks', 'todos', 'birthdays'];
  const snapshots = await Promise.all(collections.map(name => db.collection(name).where('owner', 'in', owners).limit(MAX_DOCS_PER_COLLECTION).get()));
  const today = pacificDateString();

  snapshots.forEach((snapshot, index) => {
    const collectionName = collections[index];
    snapshot.forEach(docSnap => {
      const task = docSnap.data();
      const dueDate = taskDueDate(collectionName, task, today);
      if (!dueDate || dueDate > throughDate) return;
      const type = typeForCollection(collectionName);
      const status = dueDate < today ? 'overdue' : dueDate === today ? 'due_today' : 'upcoming';
      const priority = normalizedPriority(collectionName, task);
      const item = {
        type,
        name: taskDisplayName(collectionName, task),
        owner: task.owner,
        dueDate,
        status,
        daysOverdue: status === 'overdue' ? daysBetweenDateStrings(dueDate, today) : 0,
        area: task.area || null,
        missingArea: !task.area
      };

      if (collectionName === 'repeatingTasks') {
        const repeatStyle = repeatStyleFor(task);
        item.repeatStyle = repeatStyle;
        if (repeatStyle === 'interval') item.frequency = Number(task.frequency) || null;
        if (repeatStyle === 'weekdays') item.weekdays = Array.isArray(task.weekdays) ? task.weekdays : [];
        if (repeatStyle === 'monthdays') item.monthDays = Array.isArray(task.monthDays) ? task.monthDays.map(Number) : [];
      } else if (task.frequency) {
        item.frequency = task.frequency;
      }

      if (priority) item.priority = priority;
      if (type === 'repeating' || type === 'todo') {
        item.estimatedMinutes = Number.isFinite(Number(task.estimatedMinutes)) && Number(task.estimatedMinutes) > 0 ? Number(task.estimatedMinutes) : null;
      }
      result.push(item);
    });
  });

  return result.sort((a, b) => a.dueDate !== b.dueDate ? a.dueDate.localeCompare(b.dueDate) : String(a.name || '').localeCompare(String(b.name || '')));
}

async function getTokensByOwner() {
  const subscriptionsSnap = await db.collection('notificationSubscriptions').get();
  const tokensByOwner = new Map();
  subscriptionsSnap.forEach(docSnap => {
    const { owner, token } = docSnap.data();
    if (!['Sebo', 'Alomi'].includes(owner) || !token) return;
    if (!tokensByOwner.has(owner)) tokensByOwner.set(owner, []);
    tokensByOwner.get(owner).push(token);
  });
  return tokensByOwner;
}

async function sendPushReminders(context) {
  const tokensByOwner = await getTokensByOwner();
  if (!tokensByOwner.size) return null;
  const owners = [...tokensByOwner.keys()];
  const queryOwners = [...new Set([...owners, 'All'])];
  const collections = ['repeatingTasks', 'contactTasks', 'todos', 'birthdays'];
  const snapshots = await Promise.all(collections.map(name => db.collection(name).where('owner', 'in', queryOwners).get()));
  const today = pacificDateString();
  const alertsByOwner = new Map(owners.map(owner => [owner, { dueToday: [], overdue: [] }]));

  snapshots.forEach((snapshot, index) => {
    const collectionName = collections[index];
    snapshot.forEach(docSnap => {
      const task = docSnap.data();
      if (!shouldIncludeInRegularReminder(collectionName, task)) return;
      const dueDate = taskDueDate(collectionName, task, today);
      if (!dueDate || dueDate > today) return;
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

async function sendPriorityOverdueReminders() {
  const hour = pacificHour();
  const targetPriority = hour === 12 ? 'important' : 'critical';
  if (![8, 12, 13, 19].includes(hour)) return null;
  const tokensByOwner = await getTokensByOwner();
  if (!tokensByOwner.size) return null;
  const owners = [...tokensByOwner.keys()];
  const queryOwners = [...new Set([...owners, 'All'])];
  const collections = ['repeatingTasks', 'todos'];
  const snapshots = await Promise.all(collections.map(name => db.collection(name).where('owner', 'in', queryOwners).get()));
  const today = pacificDateString();
  const namesByOwner = new Map(owners.map(owner => [owner, []]));

  snapshots.forEach((snapshot, index) => {
    const collectionName = collections[index];
    snapshot.forEach(docSnap => {
      const task = docSnap.data();
      if (normalizedPriority(collectionName, task) !== targetPriority) return;
      const dueDate = taskDueDate(collectionName, task, today);
      // Scheduled routines deliberately never become overdue, so they naturally
      // do not enter this extra overdue-only reminder path.
      if (!dueDate || dueDate >= today) return;
      const recipients = task.owner === 'All' ? owners : [task.owner];
      const name = taskDisplayName(collectionName, task);
      recipients.forEach(owner => {
        if (namesByOwner.has(owner) && name) namesByOwner.get(owner).push(name);
      });
    });
  });

  const sends = [];
  for (const [owner, tokens] of tokensByOwner.entries()) {
    const names = namesByOwner.get(owner) || [];
    if (!names.length) continue;
    const label = targetPriority === 'critical' ? 'critical' : 'important';
    const preview = names.slice(0, 3).join(', ');
    const extra = names.length > 3 ? ` +${names.length - 3} more` : '';
    sends.push(admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: `Lyfe: ${names.length} ${label} overdue task${names.length === 1 ? '' : 's'}`,
        body: `${preview}${extra}`
      },
      webpush: { fcmOptions: { link: `${APP_URL}?user=${encodeURIComponent(owner)}` } }
    }));
  }
  return Promise.all(sends);
}

exports.pushMorning = functions.region('us-west2').pubsub.schedule('0 7 * * *').timeZone('America/Los_Angeles').onRun(() => sendPushReminders('Morning'));
exports.pushNight = functions.region('us-west2').pubsub.schedule('0 20 * * *').timeZone('America/Los_Angeles').onRun(() => sendPushReminders('Night'));
exports.pushPriorityOverdue = functions.region('us-west2').pubsub.schedule('0 8,12,13,19 * * *').timeZone('America/Los_Angeles').onRun(sendPriorityOverdueReminders);

exports.taskReadApi = functions.runWith({ maxInstances: 1 }).region('us-west2').https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Read-only endpoint' });
  const owner = normalizePublicOwner(req.query.owner);
  if (!owner) return res.status(400).json({ error: 'owner is required', acceptedOwners: ['Sebo', 'Sebastian', 'Alomi'], discovery: DISCOVERY_URL });
  if (!allowApiRequest(`public:${owner}`)) return res.status(429).json({ error: 'Too many requests; try again in a minute' });
  const through = req.query.through || pacificDateString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) return res.status(400).json({ error: 'through must be YYYY-MM-DD' });
  try {
    res.set('Cache-Control', 'public, max-age=15, s-maxage=30');
    const tasks = await readDueTasks(owner, through);
    return res.json({ service: 'Lyfe', owner, today: pacificDateString(), through, count: tasks.length, tasks, discovery: DISCOVERY_URL });
  } catch (err) {
    console.error('taskReadApi error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

exports.taskHistoryApi = functions.runWith({ maxInstances: 1 }).region('us-west2').https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Read-only endpoint' });
  const owner = normalizePublicOwner(req.query.owner);
  const type = String(req.query.type || '').trim().toLowerCase();
  const name = String(req.query.name || '').trim();
  if (!owner) return res.status(400).json({ error: 'owner is required' });
  if (!['repeating', 'contact', 'birthday'].includes(type)) return res.status(400).json({ error: 'type must be repeating, contact, or birthday' });
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!allowApiRequest(`history:${owner}`)) return res.status(429).json({ error: 'Too many requests; try again in a minute' });

  try {
    const collectionName = collectionForType(type);
    const snap = await db.collection(collectionName).where('owner', 'in', [owner, 'All']).limit(MAX_DOCS_PER_COLLECTION).get();
    const target = name.toLowerCase();
    const matches = [];
    snap.forEach(docSnap => {
      const task = docSnap.data();
      if (String(taskDisplayName(collectionName, task) || '').trim().toLowerCase() === target) matches.push({ id: docSnap.id, task });
    });
    if (!matches.length) return res.status(404).json({ error: 'No active task matched that exact name' });
    if (matches.length > 1) return res.status(409).json({ error: 'Multiple active tasks matched that exact name', matches: matches.map(x => ({ name: taskDisplayName(collectionName, x.task), owner: x.task.owner, area: x.task.area || null })) });

    const match = matches[0];
    const historySnap = await db.collection('taskCompletionHistory').doc(completionHistoryDocId(type, match.id)).get();
    const raw = historySnap.exists && Array.isArray(historySnap.data().completions) ? historySnap.data().completions.slice(-HISTORY_LIMIT) : [];
    const completions = [...raw].sort((a, b) => b - a).map(timestamp => ({ timestamp, completedAt: new Date(timestamp).toISOString(), datePacific: pacificDateString(new Date(timestamp)) }));
    const intervalsDays = [];
    const chronological = [...raw].sort((a, b) => a - b);
    for (let i = 1; i < chronological.length; i++) intervalsDays.push(Math.round((chronological[i] - chronological[i - 1]) / ONE_DAY * 10) / 10);
    const averageIntervalDays = intervalsDays.length ? Math.round((intervalsDays.reduce((sum, x) => sum + x, 0) / intervalsDays.length) * 10) / 10 : null;

    const response = {
      service: 'Lyfe',
      owner,
      type,
      name: taskDisplayName(collectionName, match.task),
      area: match.task.area || null,
      storedCompletionCount: completions.length,
      maximumStoredCompletions: HISTORY_LIMIT,
      averageIntervalDays,
      completions,
      discovery: DISCOVERY_URL
    };

    if (type === 'repeating') {
      response.repeatStyle = repeatStyleFor(match.task);
      if (response.repeatStyle === 'interval') response.configuredFrequencyDays = Number(match.task.frequency) || null;
      if (response.repeatStyle === 'weekdays') response.weekdays = Array.isArray(match.task.weekdays) ? match.task.weekdays : [];
      if (response.repeatStyle === 'monthdays') response.monthDays = Array.isArray(match.task.monthDays) ? match.task.monthDays.map(Number) : [];
    } else {
      response.configuredFrequencyDays = match.task.frequency || 365;
    }

    res.set('Cache-Control', 'public, max-age=15, s-maxage=30');
    return res.json(response);
  } catch (err) {
    console.error('taskHistoryApi error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
