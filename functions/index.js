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
    from: `whatsapp:${process.env.TWILIO_WHATSAPP}`,  // e.g. 'whatsapp:+123456789'
    to:   `whatsapp:${userDoc.data().whatsapp}`,
    body
  });
}

// Broadcast to all users
async function broadcast(context) {
  const users = await db.collection('users').get();
  await Promise.all(users.docs.map(doc => sendMsg(doc, context)));
}

// Now only two schedules: Morning at 7 AM, Night at 10 PM Pacific
const specs = [
  { name: 'Morning', cron: '0 7 * * *'  },  // 7AM PT
  { name: 'Night',   cron: '0 22 * * *' }   // 10PM PT
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
