// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const ONE_DAY = 24 * 60 * 60 * 1000;
const VALID_OWNERS = new Set(['Sebo', 'Alomi', 'All']);
const VALID_TYPES = new Set(['todo', 'repeating', 'contact', 'birthday']);
const HISTORY_TYPES = new Set(['repeating', 'contact', 'birthday']);
const VALID_PRIORITIES = new Set(['critical', 'important', 'routine', 'flexible', 'someday']);
const DEFAULT_PRIORITY = 'routine';
const GENERAL_AREAS = new Set([
  'home', 'health_fitness', 'money_finance', 'work_career', 'family', 'friends_social',
  'personal_admin', 'errands', 'car_transport', 'learning_growth', 'travel', 'other'
]);
const RELATIONSHIP_AREAS = new Set(['family', 'friends', 'colleagues']);
const APP_URL = 'https://ssiatkowski.github.io/lyfe/';
const DISCOVERY_URL = 'https://ssiatkowski.github.io/lyfe/lyfe-ai.json';
const MAX_DOCS_PER_COLLECTION = 200;
const HISTORY_LIMIT = 100;
const API_RATE_WINDOW_MS = 60 * 1000;
const API_RATE_MAX_PER_WINDOW = 30;
const apiRateBuckets = new Map();

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

function dateStringForTimestamp(timestamp) { return pacificDateString(new Date(timestamp)); }
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
function normalizedPriority(collectionName, task) {
  if (collectionName !== 'repeatingTasks' && collectionName !== 'todos') return null;
  return VALID_PRIORITIES.has(task.priority) ? task.priority : DEFAULT_PRIORITY;
}
function validAreaForType(type, area) {
  if (!area) return true;
  if (type === 'repeating' || type === 'todo') return GENERAL_AREAS.has(area);
  if (type === 'contact' || type === 'birthday') return RELATIONSHIP_AREAS.has(area);
  return false;
}
function shouldIncludeInRegularReminder(collectionName, task) {
  const priority = normalizedPriority(collectionName, task);
  if (!priority) return true;
  return priority !== 'flexible' && priority !== 'someday';
}
function completionHistoryDocId(type, taskId) { return `${type}__${taskId}`; }

async function getTokensByOwner() {
  const subscriptionsSnap = await db.collection('notificationSubscriptions').get();
  const tokensByOwner = new Map();
  subscriptionsSnap.forEach(docSnap => {
    const { owner, token } = docSnap.data();
    if (!VALID_OWNERS.has(owner) || owner === 'All' || !token) return;
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

for (const spec of [{ name: 'Morning', cron: '0 7 * * *' }, { name: 'Night', cron: '0 20 * * *' }]) {
  exports[`push${spec.name}`] = functions.region('us-west2').pubsub.schedule(spec.cron).timeZone('America/Los_Angeles').onRun(() => sendPushReminders(spec.name));
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
      const dueTimestamp = taskDueTimestamp(collectionName, task);
      if (!Number.isFinite(dueTimestamp) || dateStringForTimestamp(dueTimestamp) >= today) return;
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

exports.pushPriorityOverdue = functions.region('us-west2').pubsub.schedule('0 8,12,13,19 * * *').timeZone('America/Los_Angeles').onRun(sendPriorityOverdueReminders);

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
  const snapshots = await Promise.all(collections.map(name => db.collection(name).where('owner', 'in', owners).limit(MAX_DOCS_PER_COLLECTION).get()));
  const today = pacificDateString();
  snapshots.forEach((snapshot, index) => {
    const collectionName = collections[index];
    snapshot.forEach(docSnap => {
      const task = docSnap.data();
      const dueTimestamp = taskDueTimestamp(collectionName, task);
      if (!Number.isFinite(dueTimestamp)) return;
      const dueDate = dateStringForTimestamp(dueTimestamp);
      if (dueDate > throughDate) return;
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
      if (task.frequency) item.frequency = task.frequency;
      if (priority) item.priority = priority;
      if (type === 'repeating' || type === 'todo') {
        item.estimatedMinutes = Number.isFinite(Number(task.estimatedMinutes)) && Number(task.estimatedMinutes) > 0 ? Number(task.estimatedMinutes) : null;
      }
      if (includeIds) item.id = docSnap.id;
      result.push(item);
    });
  });
  return result.sort((a, b) => a.dueDate !== b.dueDate ? a.dueDate.localeCompare(b.dueDate) : String(a.name || '').localeCompare(String(b.name || '')));
}

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
    const tasks = await readDueTasks(owner, through, false);
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
  if (!HISTORY_TYPES.has(type)) return res.status(400).json({ error: 'type must be repeating, contact, or birthday' });
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
    res.set('Cache-Control', 'public, max-age=15, s-maxage=30');
    return res.json({
      service: 'Lyfe', owner, type, name: taskDisplayName(collectionName, match.task), area: match.task.area || null,
      configuredFrequencyDays: match.task.frequency || 365, storedCompletionCount: completions.length,
      maximumStoredCompletions: HISTORY_LIMIT, averageIntervalDays, completions, discovery: DISCOVERY_URL
    });
  } catch (err) {
    console.error('taskHistoryApi error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

function buildNewTask(type, name, owner, dueDate, frequency, area, priority, estimatedMinutes) {
  const todayTimestamp = dateStringToSafeTimestamp(pacificDateString());
  if (!validAreaForType(type, area)) return { error: 'Invalid area for task type' };
  if (type === 'todo' || type === 'birthday') {
    const due = dateStringToSafeTimestamp(dueDate);
    if (!Number.isFinite(due)) return { error: 'dueDate must be YYYY-MM-DD' };
    const data = { owner, name: name.trim(), dueDate: due, type };
    if (area) data.area = area;
    if (type === 'todo') {
      data.priority = VALID_PRIORITIES.has(priority) ? priority : DEFAULT_PRIORITY;
      const effort = Number(estimatedMinutes);
      if (Number.isFinite(effort) && effort > 0) data.estimatedMinutes = Math.round(effort);
    }
    return { collectionName: collectionForType(type), data };
  }
  const freq = Number(frequency);
  if (!Number.isInteger(freq) || freq < 1) return { error: 'frequency must be a positive integer' };
  if (type === 'repeating') {
    const data = { owner, name: name.trim(), frequency: freq, lastCompleted: todayTimestamp, streak: 0, type: 'repeating', priority: VALID_PRIORITIES.has(priority) ? priority : DEFAULT_PRIORITY };
    if (area) data.area = area;
    const effort = Number(estimatedMinutes);
    if (Number.isFinite(effort) && effort > 0) data.estimatedMinutes = Math.round(effort);
    return { collectionName: 'repeatingTasks', data };
  }
  const data = { owner, contactName: name.trim(), name: name.trim(), frequency: freq, lastContact: todayTimestamp, streak: 0, type: 'contact' };
  if (area) data.area = area;
  return { collectionName: 'contactTasks', data };
}

function buildTaskUpdates(type, body) {
  const updates = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return { error: 'name must be a non-empty string' };
    if (type === 'contact') { updates.contactName = body.name.trim(); updates.name = body.name.trim(); }
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
  if (body.area !== undefined) {
    const area = body.area || null;
    if (!validAreaForType(type, area)) return { error: 'Invalid area for task type' };
    updates.area = area;
  }
  if (body.priority !== undefined) {
    if (type !== 'repeating' && type !== 'todo') return { error: 'priority only applies to repeating/todo tasks' };
    if (!VALID_PRIORITIES.has(body.priority)) return { error: 'Invalid priority' };
    updates.priority = body.priority;
  }
  if (body.estimatedMinutes !== undefined) {
    if (type !== 'repeating' && type !== 'todo') return { error: 'estimatedMinutes only applies to repeating/todo tasks' };
    if (body.estimatedMinutes === null || body.estimatedMinutes === '') updates.estimatedMinutes = null;
    else {
      const effort = Number(body.estimatedMinutes);
      if (!Number.isFinite(effort) || effort <= 0) return { error: 'estimatedMinutes must be a positive number or null' };
      updates.estimatedMinutes = Math.round(effort);
    }
  }
  if (!Object.keys(updates).length) return { error: 'No supported fields supplied to modify' };
  return { updates };
}

exports.taskApi = functions.runWith({ secrets: ['LYFE_SEBO_API_KEY', 'LYFE_ALOMI_API_KEY'], maxInstances: 1 }).region('us-west2').https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Lyfe-Key');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  const callerOwner = getCallerOwner(req);
  if (!callerOwner) return res.status(401).json({ error: 'Unauthorized' });
  if (!allowApiRequest(`private:${callerOwner}`)) return res.status(429).json({ error: 'Too many requests; try again in a minute' });
  try {
    if (req.method === 'GET') {
      const through = req.query.through || pacificDateString();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) return res.status(400).json({ error: 'through must be YYYY-MM-DD' });
      res.set('Cache-Control', 'private, no-store');
      const tasks = await readDueTasks(callerOwner, through, true);
      return res.json({ owner: callerOwner, through, count: tasks.length, tasks });
    }
    if (req.method === 'POST') {
      const { type, name, owner = 'self', dueDate, frequency, area, priority, estimatedMinutes } = req.body || {};
      if (!VALID_TYPES.has(type)) return res.status(400).json({ error: 'Invalid type' });
      if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name is required' });
      if (owner !== 'self' && owner !== 'All') return res.status(400).json({ error: 'owner must be self or All' });
      const actualOwner = owner === 'All' ? 'All' : callerOwner;
      const built = buildNewTask(type, name, actualOwner, dueDate, frequency, area, priority, estimatedMinutes);
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
      if (existing.owner !== callerOwner && existing.owner !== 'All') return res.status(403).json({ error: 'Task belongs to another user' });
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
