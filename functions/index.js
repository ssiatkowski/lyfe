// functions/index.js
require('dotenv').config();
const functions = require('firebase-functions');    // v1 API
const admin     = require('firebase-admin');
const twilio    = require('twilio');

admin.initializeApp();
const db = admin.firestore();

// Pull creds from process.env (dotenv loads from local .env)
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

// Helper to collect due‑today & overdue items (includes owner="All")
async function getAlerts(userId) {
  // compute “today midnight” in America/Los_Angeles
  const laNow    = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
  );
  const todayMid = new Date(
    laNow.getFullYear(),
    laNow.getMonth(),
    laNow.getDate()
  ).getTime();

  const oneDay = 24 * 60 * 60 * 1000;
  const lists  = { dueToday: [], overdue: [] };

  async function scan(col, tsFn, label) {
    // include tasks owned by this user OR by "All"
    const snap = await db.collection(col)
      .where('owner', 'in', [userId, 'All'])
      .get();
    snap.forEach(d => {
      const data = d.data();
      const due  = tsFn(data);
      if (due < todayMid)               lists.overdue.push(data[label]);
      else if (due < todayMid + oneDay) lists.dueToday.push(data[label]);
    });
  }

  await scan('repeatingTasks', t => t.lastCompleted + t.frequency * oneDay, 'name');
  await scan('contactTasks',   t => t.lastContact  + t.frequency * oneDay, 'contactName');
  await scan('todos',          t => t.dueDate,                              'name');
  await scan('birthdays',      t => t.dueDate,                              'name');

  return lists;
}

// Send one WhatsApp message with custom opening
async function sendMsg(userDoc, context) {
  const name = userDoc.data().name;

  // SKIP Alomi for now – remove this `if` to re‑enable for Alomi
  if (name === 'Alomi') return;

  const { dueToday, overdue } = await getAlerts(userDoc.id);
  if (!dueToday.length && !overdue.length) return;

  let body = '';
  if (context === 'Morning') {
    body += `*🌅 Good Morning, ${name}!*`;
  } else if (context === 'Night') {
    body += `*🌃 Oops, you forgot to check off some tasks, ${name}!*`;
  }

  if (dueToday.length) body += `\n\n*Due Today:*\n• ${dueToday.join('\n• ')}`;
  if (overdue.length)  body += `\n\n*Overdue:*\n• ${overdue.join('\n• ')}`;

  // link to your app
  body += `\n\n🔗 Open Lyfe: https://ssiatkowski.github.io/lyfe/`;

  await client.messages.create({
    from: `whatsapp:${process.env.TWILIO_WHATSAPP}`,
    to:   `whatsapp:${userDoc.data().whatsapp}`,
    body
  });
}

// Broadcast to all users
async function broadcast(context) {
  const users = await db.collection('users').get();
  await Promise.all(users.docs.map(doc => sendMsg(doc, context)));
}

// Now only two schedules: Morning at 7 AM, Night at 10 PM Pacific
const specs = [
  { name: 'Morning', cron: '0 7 * * *'  },
  { name: 'Night',   cron: '0 22 * * *' }
];

for (const s of specs) {
  exports[`whatsapp${s.name}`] = functions
    .region('us-west2')
    .pubsub
    .schedule(s.cron)
    .timeZone('America/Los_Angeles')
    .onRun(async () => {
      await broadcast(s.name);
    });
}

//////////////////////////////////////////////////
// Minimal ChatGPT API
//
// Deliberately isolated from the web app. It performs Firestore work only
// when called: no listeners, polling, scheduled work, or background reads.
//////////////////////////////////////////////////
const ONE_DAY = 24 * 60 * 60 * 1000;
const VALID_OWNERS = new Set(['Sebo', 'Alomi', 'All']);
const VALID_TYPES = new Set(['todo', 'repeating', 'contact', 'birthday']);

function localMidnight(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  if (!year || !month || !day) return NaN;
  return new Date(year, month - 1, day).getTime();
}

function pacificDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function readDueTasks(owner, throughMidnight) {
  const owners = owner === 'All' ? ['Sebo', 'Alomi', 'All'] : [owner, 'All'];
  const result = [];

  // Repeating/contact due dates are computed fields, so these two small
  // collections must be read for the requested owner. No extra writes occur.
  const [repeatingSnap, contactSnap] = await Promise.all([
    db.collection('repeatingTasks').where('owner', 'in', owners).get(),
    db.collection('contactTasks').where('owner', 'in', owners).get()
  ]);

  repeatingSnap.forEach(d => {
    const t = d.data();
    const dueDate = t.lastCompleted + t.frequency * ONE_DAY;
    if (dueDate <= throughMidnight) {
      result.push({ id: d.id, type: 'repeating', name: t.name, owner: t.owner, dueDate, frequency: t.frequency });
    }
  });

  contactSnap.forEach(d => {
    const t = d.data();
    const dueDate = t.lastContact + t.frequency * ONE_DAY;
    if (dueDate <= throughMidnight) {
      result.push({ id: d.id, type: 'contact', name: t.contactName || t.name, owner: t.owner, dueDate, frequency: t.frequency });
    }
  });

  // These collections store dueDate directly, allowing Firestore to filter
  // before documents are returned/billed as reads.
  const [todosSnap, birthdaysSnap] = await Promise.all([
    db.collection('todos').where('owner', 'in', owners).where('dueDate', '<=', throughMidnight).get(),
    db.collection('birthdays').where('owner', 'in', owners).where('dueDate', '<=', throughMidnight).get()
  ]);

  todosSnap.forEach(d => {
    const t = d.data();
    result.push({ id: d.id, type: 'todo', name: t.name, owner: t.owner, dueDate: t.dueDate });
  });
  birthdaysSnap.forEach(d => {
    const t = d.data();
    result.push({ id: d.id, type: 'birthday', name: t.name, owner: t.owner, dueDate: t.dueDate });
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
      const throughMidnight = localMidnight(through);
      if (!Number.isFinite(throughMidnight)) return res.status(400).json({ error: 'through must be YYYY-MM-DD' });

      const tasks = await readDueTasks(owner, throughMidnight);
      return res.json({ owner, through, count: tasks.length, tasks });
    }

    if (req.method === 'POST') {
      const { type, name, owner = 'Sebo', dueDate, frequency } = req.body || {};
      if (!VALID_TYPES.has(type)) return res.status(400).json({ error: 'Invalid type' });
      if (!VALID_OWNERS.has(owner)) return res.status(400).json({ error: 'Invalid owner' });
      if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name is required' });

      let collectionName;
      let data;
      const todayMidnight = localMidnight(pacificDateString());

      if (type === 'todo' || type === 'birthday') {
        const due = localMidnight(dueDate);
        if (!Number.isFinite(due)) return res.status(400).json({ error: 'dueDate must be YYYY-MM-DD' });
        collectionName = type === 'todo' ? 'todos' : 'birthdays';
        data = { owner, name: name.trim(), dueDate: due, type };
      } else {
        const freq = Number(frequency);
        if (!Number.isInteger(freq) || freq < 1) return res.status(400).json({ error: 'frequency must be a positive integer' });
        if (type === 'repeating') {
          collectionName = 'repeatingTasks';
          data = { owner, name: name.trim(), frequency: freq, lastCompleted: todayMidnight, streak: 0, type: 'repeating' };
        } else {
          collectionName = 'contactTasks';
          data = { owner, contactName: name.trim(), frequency: freq, lastContact: todayMidnight, streak: 0, type: 'contact' };
        }
      }

      // Exactly one Firestore write per successful add request.
      const ref = await db.collection(collectionName).add(data);
      return res.status(201).json({ id: ref.id, ...data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('taskApi error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
