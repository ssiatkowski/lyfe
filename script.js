/* script.js */
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  onSnapshot,
  addDoc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  runTransaction
} from "https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC_BtuwYiwwmDpAJQuRt4x30YyPGTYvZ7s",
  authDomain: "lyfe-cacf7.firebaseapp.com",
  projectId: "lyfe-cacf7",
  storageBucket: "lyfe-cacf7.firebasestorage.app",
  messagingSenderId: "119442487958",
  appId: "1:119442487958:web:e218fafb50513ad717e0b7",
  measurementId: "G-WE8CC23QSC"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const ONE_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_PRIORITY = "routine";
const HISTORY_LIMIT = 100;

const AUTH_OWNER_BY_EMAIL = {
  "sebastiansiatkowski@gmail.com": "Sebo",
  "alomip@gmail.com": "Alomi"
};

const GENERAL_AREAS = [
  { value: "", label: "No area" },
  { value: "home", label: "Home" },
  { value: "health_fitness", label: "Health & Fitness" },
  { value: "money_finance", label: "Money & Finance" },
  { value: "work_career", label: "Work & Career" },
  { value: "family", label: "Family" },
  { value: "friends_social", label: "Friends & Social" },
  { value: "personal_admin", label: "Personal Admin" },
  { value: "errands", label: "Errands" },
  { value: "car_transport", label: "Car & Transportation" },
  { value: "learning_growth", label: "Learning & Growth" },
  { value: "travel", label: "Travel" },
  { value: "other", label: "Other" }
];

const RELATIONSHIP_AREAS = [
  { value: "", label: "No area" },
  { value: "family", label: "Family" },
  { value: "friends", label: "Friends" },
  { value: "colleagues", label: "Colleagues" }
];

const PRIORITIES = [
  { value: "critical", label: "Critical — must not slip" },
  { value: "important", label: "Important — should happen soon" },
  { value: "routine", label: "Routine — keep on track" },
  { value: "flexible", label: "Flexible — can wait" },
  { value: "someday", label: "Someday — no pressure" }
];

const EFFORTS = [
  { value: "", label: "Not estimated" },
  { value: "5", label: "5 min" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
  { value: "240", label: "4+ hours" }
];

const AREA_LABELS = Object.fromEntries([...GENERAL_AREAS, ...RELATIONSHIP_AREAS].map(x => [x.value, x.label]));
const PRIORITY_LABELS = Object.fromEntries(PRIORITIES.map(x => [x.value, x.label]));

let repeatingTasksCache = [];
let contactTasksCache = [];
let todosCache = [];
let birthdaysCache = [];
let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();
let appStarted = false;

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, user => {
    if (!user || appStarted) return;
    const owner = AUTH_OWNER_BY_EMAIL[(user.email || "").toLowerCase()];
    if (owner) localStorage.setItem("currentUser", owner);
    appStarted = true;
    startApp();
  });
});

function startApp() {
  if (!localStorage.getItem("users")) localStorage.setItem("users", JSON.stringify(["Sebo", "Alomi"]));
  if (!localStorage.getItem("currentUser")) localStorage.setItem("currentUser", "Alomi");

  updateUserDropdowns();
  updateOwnerDropdowns();
  initializeMetadataControls();

  const userSelect = document.getElementById("user-select");
  userSelect.value = localStorage.getItem("currentUser");
  userSelect.addEventListener("change", function() {
    localStorage.setItem("currentUser", this.value);
    updateOwnerDropdowns();
    refreshView();
  });

  document.querySelectorAll("#nav-bar button").forEach(button => {
    button.addEventListener("click", function() {
      document.querySelectorAll("#nav-bar button").forEach(btn => btn.classList.remove("active"));
      this.classList.add("active");
      reorderColumns(this.getAttribute("data-type"));
    });
  });

  attachTaskListeners();

  document.getElementById("repeating-form").addEventListener("submit", async e => { e.preventDefault(); await addRepeatingTask(); });
  document.getElementById("contacts-form").addEventListener("submit", async e => { e.preventDefault(); await addContactTask(); });
  document.getElementById("todos-form").addEventListener("submit", async e => { e.preventDefault(); await addTodo(); });
  document.getElementById("birthdays-form").addEventListener("submit", async e => { e.preventDefault(); await addBirthday(); });

  document.getElementById("prev-month").addEventListener("click", () => {
    if (calendarMonth === 0) { calendarMonth = 11; calendarYear -= 1; }
    else calendarMonth -= 1;
    renderCalendarView();
  });
  document.getElementById("next-month").addEventListener("click", () => {
    if (calendarMonth === 11) { calendarMonth = 0; calendarYear += 1; }
    else calendarMonth += 1;
    renderCalendarView();
  });
  document.querySelectorAll(".calendar-filter").forEach(checkbox => checkbox.addEventListener("change", renderCalendarView));

  document.getElementById("stats-btn")?.addEventListener("click", () => updateScoreboard().catch(console.error));
  reorderColumns("repeating");
  setInterval(refreshView, 60000);
}

function attachTaskListeners() {
  const specs = [
    ["repeatingTasks", value => { repeatingTasksCache = value; renderRepeatingTasks(); }],
    ["contactTasks", value => { contactTasksCache = value; renderContactTasks(); }],
    ["todos", value => { todosCache = value; renderTodos(); }],
    ["birthdays", value => { birthdaysCache = value; renderBirthdays(); }]
  ];
  specs.forEach(([name, setter]) => {
    onSnapshot(collection(db, name), snapshot => {
      const items = [];
      snapshot.forEach(docSnap => items.push({ ...docSnap.data(), docId: docSnap.id }));
      setter(items);
    }, err => console.error(`Lyfe listener failed for ${name}`, err));
  });
}

function populateSelect(id, options, value) {
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML = "";
  options.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.label;
    select.appendChild(opt);
  });
  if (value !== undefined && options.some(x => x.value === String(value))) select.value = String(value);
}

function initializeMetadataControls() {
  populateSelect("r-area", GENERAL_AREAS, "");
  populateSelect("t-area", GENERAL_AREAS, "");
  populateSelect("c-area", RELATIONSHIP_AREAS, "");
  populateSelect("b-area", RELATIONSHIP_AREAS, "");
  populateSelect("r-priority", PRIORITIES, DEFAULT_PRIORITY);
  populateSelect("t-priority", PRIORITIES, DEFAULT_PRIORITY);
  populateSelect("r-effort", EFFORTS, "");
  populateSelect("t-effort", EFFORTS, "");
}

function resetAddFormMetadata(type) {
  if (type === "repeating") {
    populateSelect("r-area", GENERAL_AREAS, "");
    populateSelect("r-priority", PRIORITIES, DEFAULT_PRIORITY);
    populateSelect("r-effort", EFFORTS, "");
  } else if (type === "todo") {
    populateSelect("t-area", GENERAL_AREAS, "");
    populateSelect("t-priority", PRIORITIES, DEFAULT_PRIORITY);
    populateSelect("t-effort", EFFORTS, "");
  } else if (type === "contact") populateSelect("c-area", RELATIONSHIP_AREAS, "");
  else if (type === "birthday") populateSelect("b-area", RELATIONSHIP_AREAS, "");
}

async function getRepeatingTasks() { return repeatingTasksCache; }
async function getContactTasks() { return contactTasksCache; }
async function getTodos() { return todosCache; }
async function getBirthdays() { return birthdaysCache; }

async function isCleanDayForUser(user) {
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const repeating = (await getRepeatingTasks()).filter(task => task.owner === user);
  const contact = (await getContactTasks()).filter(task => task.owner === user);
  const todos = (await getTodos()).filter(task => task.owner === user);
  const birthdays = (await getBirthdays()).filter(task => task.owner === user);
  if (repeating.some(task => task.lastCompleted + task.frequency * ONE_DAY < todayMidnight)) return false;
  if (contact.some(task => task.lastContact + task.frequency * ONE_DAY < todayMidnight)) return false;
  if (todos.some(task => task.dueDate < todayMidnight)) return false;
  if (birthdays.some(task => task.dueDate < todayMidnight)) return false;
  return true;
}

async function updateScoreboard() {
  const users = JSON.parse(localStorage.getItem("users") || "[]");
  const scoreboard = JSON.parse(localStorage.getItem("scoreboard") || "{}");
  const today = new Date();
  const todayTimestamp = parseLocalDate(today.toISOString().split("T")[0]).getTime();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayTimestamp = parseLocalDate(yesterday.toISOString().split("T")[0]).getTime();

  for (const user of users) {
    const ref = doc(db, "scoreboards", user);
    let data = {};
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) data = snap.data();
    } catch (err) { console.error(err); }
    data.overallCleanDays = data.overallCleanDays || 0;
    data.overallStreak = data.overallStreak || 0;
    data.lastOverallUpdate = data.lastOverallUpdate || 0;
    if (data.lastOverallUpdate !== todayTimestamp) {
      const clean = await isCleanDayForUser(user);
      if (clean) {
        data.overallCleanDays += 1;
        data.overallStreak = data.lastOverallUpdate === yesterdayTimestamp ? data.overallStreak + 1 : 1;
      } else data.overallStreak = 0;
      data.lastOverallUpdate = todayTimestamp;
      await setDoc(ref, data, { merge: true });
    }
    scoreboard[user] = data;
  }
  localStorage.setItem("scoreboard", JSON.stringify(scoreboard));
  displayScoreboard(scoreboard);
}

function displayScoreboard(scoreboard) {
  const el = document.getElementById("scoreboard");
  if (!el) return;
  const users = JSON.parse(localStorage.getItem("users") || "[]");
  let clean = "Total Clean Days:<br>";
  let streak = "Current Streak:<br>";
  users.forEach(user => {
    const data = scoreboard[user] || {};
    clean += `<strong>${escapeHtml(user)}:</strong> ${data.overallCleanDays || 0}<br>`;
    streak += `<strong>${escapeHtml(user)}:</strong> ${getStreakVisualForScore(data.overallStreak || 0, 100)}<br>`;
  });
  el.innerHTML = `<div class="cell overall-clean">${clean}</div><div class="cell overall-streak">${streak}</div>`;
}

function getStreakVisualForScore(streak, cap) {
  const effective = Math.min(streak, cap);
  const stars = Math.floor(effective / 10);
  const checks = effective % 10;
  return `${"⭐".repeat(stars)}${stars && checks ? "<br>" : ""}${"✅".repeat(checks)}`;
}
function getStreakVisual(streak) { return getStreakVisualForScore(streak || 0, 100); }

function reorderColumns(selectedType) {
  const columnsContainer = document.getElementById("columns-container");
  const calendarView = document.getElementById("calendar-view");
  columnsContainer.style.display = "none";
  calendarView.style.display = "none";
  if (selectedType === "calendar") { calendarView.style.display = "block"; renderCalendarView(); return; }
  columnsContainer.style.display = "flex";
  const repeating = document.getElementById("repeating-column");
  const contacts = document.getElementById("contacts-column");
  const todos = document.getElementById("todos-column");
  const birthdays = document.getElementById("birthdays-column");
  const orders = {
    repeating: [repeating, contacts, todos, birthdays],
    contact: [contacts, repeating, todos, birthdays],
    todos: [todos, repeating, contacts, birthdays],
    birthdays: [birthdays, repeating, contacts, todos]
  };
  const container = document.querySelector(".columns");
  container.innerHTML = "";
  (orders[selectedType] || orders.repeating).forEach(col => container.appendChild(col));
}

function refreshView() {
  if (document.getElementById("calendar-view").style.display !== "none") renderCalendarView();
  else { renderRepeatingTasks(); renderContactTasks(); renderTodos(); renderBirthdays(); }
}

function updateUserDropdowns() {
  const users = JSON.parse(localStorage.getItem("users") || "[]");
  const select = document.getElementById("user-select");
  select.innerHTML = "";
  ["All", ...users].forEach(user => {
    const opt = document.createElement("option");
    opt.value = user;
    opt.textContent = user;
    select.appendChild(opt);
  });
}

function updateOwnerDropdowns() {
  const users = JSON.parse(localStorage.getItem("users") || "[]");
  ["r-owner", "c-owner", "t-owner", "b-owner"].forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = "";
    ["All", ...users].forEach(user => {
      const opt = document.createElement("option");
      opt.value = user;
      opt.textContent = user;
      select.appendChild(opt);
    });
    select.value = localStorage.getItem("currentUser");
  });
}

function filterTasksByUser(tasks) {
  const currentUser = localStorage.getItem("currentUser");
  if (currentUser === "All") return tasks;
  return tasks.filter(task => task.owner === currentUser || task.owner === "All");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]);
}
function sortByDue(tasks, getDueDateFn) { return [...tasks].sort((a, b) => getDueDateFn(a) - getDueDateFn(b)); }
function parseLocalDate(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  return new Date(year, month - 1, day);
}
function formatDateForInput(timestamp) {
  const d = new Date(timestamp);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split("T")[0];
}
function dayDifferenceFromToday(dueTime) {
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const due = new Date(dueTime);
  const dueMidnight = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  return Math.round((dueMidnight - todayMidnight) / ONE_DAY);
}
function normalizedPriority(task) { return PRIORITY_LABELS[task.priority] ? task.priority : DEFAULT_PRIORITY; }

function taskVisualClasses(task, type, dueTime, repeatingFrequency = null) {
  const classes = ["task-item"];
  const diff = dayDifferenceFromToday(dueTime);
  const priorityEnabled = type === "repeating" || type === "todo";
  const priority = priorityEnabled ? normalizedPriority(task) : null;
  if (priority) classes.push(`priority-${priority}`);
  if (diff < 0) {
    const daysOverdue = Math.abs(diff);
    if (priority === "someday" && daysOverdue < 30) classes.push("overdue-someday");
    else if (priority === "flexible" && daysOverdue < 7) classes.push("overdue-flexible");
    else classes.push("overdue");
    if (daysOverdue >= 30) classes.push("very-overdue");
    if (daysOverdue >= 90) classes.push("extremely-overdue");
  } else if (diff === 0) classes.push("due-today");
  else if (type === "repeating") {
    if ((repeatingFrequency === 2 || repeatingFrequency === 3) && diff === 1) classes.push("due-soon");
  } else if (diff <= 2) classes.push("almost-due");
  else if (diff <= 4) classes.push("due-soon");
  return classes.join(" ");
}

function effortLabel(minutes) {
  if (!minutes) return null;
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 60) return `${n} min`;
  if (n === 60) return "1 hr";
  if (n % 60 === 0) return `${n / 60} hrs`;
  return `${Math.floor(n / 60)}h ${n % 60}m`;
}

function metadataHtml(task, type) {
  const chips = [];
  if (task.area) chips.push(`<span class="meta-chip area-chip">${escapeHtml(AREA_LABELS[task.area] || task.area)}</span>`);
  else chips.push(`<span class="meta-chip area-chip missing-area">No area</span>`);
  if (type === "repeating" || type === "todo") {
    const priority = normalizedPriority(task);
    chips.push(`<span class="meta-chip priority-chip priority-chip-${priority}">${escapeHtml(PRIORITY_LABELS[priority])}</span>`);
    const effort = effortLabel(task.estimatedMinutes);
    if (effort) chips.push(`<span class="meta-chip effort-chip">${escapeHtml(effort)}</span>`);
  }
  return `<div class="task-meta">${chips.join("")}</div>`;
}

function createInputField(labelText, inputType, value, inputId) {
  const container = document.createElement("div");
  container.className = "edit-field";
  const label = document.createElement("label");
  label.textContent = labelText;
  label.htmlFor = inputId;
  const input = document.createElement("input");
  input.type = inputType;
  input.value = value ?? "";
  input.id = inputId;
  container.append(label, input);
  return container;
}

function createSelectField(labelText, options, value, inputId) {
  const container = document.createElement("div");
  container.className = "edit-field";
  const label = document.createElement("label");
  label.textContent = labelText;
  label.htmlFor = inputId;
  const select = document.createElement("select");
  select.id = inputId;
  options.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.label;
    select.appendChild(opt);
  });
  select.value = value ?? "";
  container.append(label, select);
  return container;
}

function completionHistoryDocId(type, taskId) { return `${type}__${taskId}`; }

async function loadCompletionHistory(task, type, output, button) {
  button.disabled = true;
  button.textContent = "Loading…";
  output.innerHTML = "";
  try {
    const snap = await getDoc(doc(db, "taskCompletionHistory", completionHistoryDocId(type, task.docId)));
    const entries = snap.exists() && Array.isArray(snap.data().completions) ? snap.data().completions : [];
    if (!entries.length) { output.innerHTML = `<p class="history-empty">No completion history recorded yet.</p>`; return; }
    const newestFirst = [...entries].sort((a, b) => b - a);
    output.innerHTML = `<div class="history-summary">Showing ${newestFirst.length} completion${newestFirst.length === 1 ? "" : "s"} (maximum ${HISTORY_LIMIT}).</div><ol class="history-list">${newestFirst.map(ts => `<li>${escapeHtml(new Date(ts).toLocaleString())}</li>`).join("")}</ol>`;
  } catch (err) {
    console.error("Unable to load completion history", err);
    output.textContent = "Could not load completion history.";
  } finally {
    button.disabled = false;
    button.textContent = "Reload completion history";
  }
}

function addHistoryLoader(fieldsDiv, task, type) {
  if (!task.docId || !["repeating", "contact", "birthday"].includes(type)) return;
  const section = document.createElement("div");
  section.className = "history-section";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "history-load-btn";
  button.textContent = "Load completion history";
  const output = document.createElement("div");
  output.className = "history-output";
  button.addEventListener("click", () => loadCompletionHistory(task, type, output, button));
  section.append(button, output);
  fieldsDiv.appendChild(section);
}

function showEditModal(task, type, onSave) {
  const modal = document.getElementById("edit-modal");
  const titleEl = document.getElementById("edit-modal-title");
  const fieldsDiv = document.getElementById("edit-fields");
  fieldsDiv.innerHTML = "";
  const currentName = type === "contact" ? (task.contactName || task.name) : task.name;
  fieldsDiv.appendChild(createInputField("Name", "text", currentName, "edit-name"));

  if (type === "repeating") {
    titleEl.textContent = "Edit Repeating Task";
    fieldsDiv.appendChild(createInputField("Last completed date", "date", formatDateForInput(task.lastCompleted), "edit-date"));
    fieldsDiv.appendChild(createInputField("Frequency (days)", "number", task.frequency, "edit-frequency"));
    fieldsDiv.appendChild(createSelectField("Area", GENERAL_AREAS, task.area || "", "edit-area"));
    fieldsDiv.appendChild(createSelectField("Priority", PRIORITIES, normalizedPriority(task), "edit-priority"));
    fieldsDiv.appendChild(createSelectField("Estimated effort", EFFORTS, task.estimatedMinutes ? String(task.estimatedMinutes) : "", "edit-effort"));
  } else if (type === "contact") {
    titleEl.textContent = "Edit Keep in Touch Task";
    fieldsDiv.appendChild(createInputField("Last contact date", "date", formatDateForInput(task.lastContact), "edit-date"));
    fieldsDiv.appendChild(createInputField("Frequency (days)", "number", task.frequency, "edit-frequency"));
    fieldsDiv.appendChild(createSelectField("Area", RELATIONSHIP_AREAS, task.area || "", "edit-area"));
  } else if (type === "todo") {
    titleEl.textContent = "Edit One-off Todo";
    fieldsDiv.appendChild(createInputField("Due date", "date", formatDateForInput(task.dueDate), "edit-date"));
    fieldsDiv.appendChild(createSelectField("Area", GENERAL_AREAS, task.area || "", "edit-area"));
    fieldsDiv.appendChild(createSelectField("Priority", PRIORITIES, normalizedPriority(task), "edit-priority"));
    fieldsDiv.appendChild(createSelectField("Estimated effort", EFFORTS, task.estimatedMinutes ? String(task.estimatedMinutes) : "", "edit-effort"));
  } else if (type === "birthday") {
    titleEl.textContent = "Edit Birthday/Occasion";
    fieldsDiv.appendChild(createInputField("Occasion date", "date", formatDateForInput(task.dueDate), "edit-date"));
    fieldsDiv.appendChild(createSelectField("Area", RELATIONSHIP_AREAS, task.area || "", "edit-area"));
  }

  addHistoryLoader(fieldsDiv, task, type);
  modal.style.display = "flex";
  const form = document.getElementById("edit-form");
  form.onsubmit = async e => {
    e.preventDefault();
    const values = {
      name: document.getElementById("edit-name")?.value.trim(),
      date: document.getElementById("edit-date")?.value,
      frequency: document.getElementById("edit-frequency")?.value,
      area: document.getElementById("edit-area")?.value || "",
      priority: document.getElementById("edit-priority")?.value,
      estimatedMinutes: document.getElementById("edit-effort")?.value || ""
    };
    await onSave(values);
    hideEditModal();
  };
  document.getElementById("edit-cancel-btn").onclick = hideEditModal;
}

function hideEditModal() { document.getElementById("edit-modal").style.display = "none"; }
function applyOptionalArea(target, area) { target.area = area || null; }
function applyOptionalEffort(target, value) {
  const n = Number(value);
  target.estimatedMinutes = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

async function completeWithHistory(collectionName, type, docId, task, taskUpdates, completedAt = Date.now()) {
  const taskRef = doc(db, collectionName, docId);
  const historyRef = doc(db, "taskCompletionHistory", completionHistoryDocId(type, docId));
  await runTransaction(db, async transaction => {
    const historySnap = await transaction.get(historyRef);
    const existing = historySnap.exists() && Array.isArray(historySnap.data().completions) ? historySnap.data().completions : [];
    const completions = [...existing, completedAt].slice(-HISTORY_LIMIT);
    transaction.update(taskRef, taskUpdates);
    transaction.set(historyRef, {
      owner: task.owner,
      type,
      taskId: docId,
      taskName: type === "contact" ? (task.contactName || task.name) : task.name,
      completions,
      updatedAt: completedAt
    }, { merge: true });
  });
}

async function addRepeatingTask() {
  const owner = document.getElementById("r-owner").value;
  const name = document.getElementById("r-task-name").value.trim();
  const frequency = parseInt(document.getElementById("r-frequency").value, 10);
  const area = document.getElementById("r-area").value;
  const priority = document.getElementById("r-priority").value || DEFAULT_PRIORITY;
  const effort = document.getElementById("r-effort").value;
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const task = { owner, name, frequency, lastCompleted: todayMidnight, streak: 0, type: "repeating", priority };
  if (area) task.area = area;
  if (effort) task.estimatedMinutes = Number(effort);
  await addDoc(collection(db, "repeatingTasks"), task);
  document.getElementById("repeating-form").reset();
  updateOwnerDropdowns();
  resetAddFormMetadata("repeating");
}

async function renderRepeatingTasks() {
  let filtered = filterTasksByUser(await getRepeatingTasks()).map(task => ({ ...task, nextDue: task.lastCompleted + task.frequency * ONE_DAY }));
  filtered = sortByDue(filtered, task => task.nextDue);
  const list = document.getElementById("repeating-list");
  list.innerHTML = "";
  filtered.forEach(task => {
    const taskDiv = document.createElement("div");
    taskDiv.className = taskVisualClasses(task, "repeating", task.nextDue, task.frequency);
    taskDiv.innerHTML = `<span><strong>${escapeHtml(task.name)}</strong> (Every ${task.frequency} day${task.frequency > 1 ? "s" : ""})</span><small>Next due: ${escapeHtml(new Date(task.nextDue).toLocaleDateString())}</small>${metadataHtml(task, "repeating")}<div class="streak-visual">${getStreakVisual(task.streak)}</div><small>Owner: ${escapeHtml(task.owner)}</small>`;
    taskDiv.appendChild(buildActions([
      ["Completed Today", "complete-btn", () => markRepeatingTaskCompleted(task.docId, task)],
      ["Edit", "edit-btn", () => editRepeatingTask(task.docId, task)],
      ["Delete", "delete-btn", () => deleteRepeatingTask(task.docId)]
    ]));
    list.appendChild(taskDiv);
  });
}

async function markRepeatingTaskCompleted(docId, task) {
  const now = Date.now();
  const prevDue = task.lastCompleted + task.frequency * ONE_DAY;
  const streak = now - prevDue <= ONE_DAY ? (task.streak || 0) + 1 : 0;
  await completeWithHistory("repeatingTasks", "repeating", docId, task, { lastCompleted: now, streak }, now);
}
async function deleteRepeatingTask(docId) {
  await Promise.all([deleteDoc(doc(db, "repeatingTasks", docId)), deleteDoc(doc(db, "taskCompletionHistory", completionHistoryDocId("repeating", docId)))]);
}
function editRepeatingTask(docId, task) {
  showEditModal(task, "repeating", async values => {
    const updates = {};
    if (values.name) updates.name = values.name;
    const ts = parseLocalDate(values.date).getTime();
    if (!Number.isNaN(ts)) updates.lastCompleted = ts;
    const freq = parseInt(values.frequency, 10);
    if (Number.isFinite(freq) && freq > 0) updates.frequency = freq;
    applyOptionalArea(updates, values.area);
    updates.priority = PRIORITY_LABELS[values.priority] ? values.priority : DEFAULT_PRIORITY;
    applyOptionalEffort(updates, values.estimatedMinutes);
    await updateDoc(doc(db, "repeatingTasks", docId), updates);
  });
}

async function addContactTask() {
  const owner = document.getElementById("c-owner").value;
  const name = document.getElementById("c-contact-name").value.trim();
  const frequency = parseInt(document.getElementById("c-frequency").value, 10);
  const area = document.getElementById("c-area").value;
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const task = { owner, name, contactName: name, frequency, lastContact: todayMidnight, streak: 0, type: "contact" };
  if (area) task.area = area;
  await addDoc(collection(db, "contactTasks"), task);
  document.getElementById("contacts-form").reset();
  updateOwnerDropdowns();
  resetAddFormMetadata("contact");
}

async function renderContactTasks() {
  let filtered = filterTasksByUser(await getContactTasks()).map(task => ({ ...task, nextDue: task.lastContact + task.frequency * ONE_DAY }));
  filtered = sortByDue(filtered, task => task.nextDue);
  const list = document.getElementById("contacts-list");
  list.innerHTML = "";
  filtered.forEach(task => {
    const taskDiv = document.createElement("div");
    taskDiv.className = taskVisualClasses(task, "contact", task.nextDue);
    taskDiv.innerHTML = `<span><strong>${escapeHtml(task.contactName || task.name)}</strong> (Every ${task.frequency} day${task.frequency > 1 ? "s" : ""})</span><small>Next contact: ${escapeHtml(new Date(task.nextDue).toLocaleDateString())}</small>${metadataHtml(task, "contact")}<div class="streak-visual">${getStreakVisual(task.streak)}</div><small>Owner: ${escapeHtml(task.owner)}</small>`;
    taskDiv.appendChild(buildActions([
      ["Completed Today", "complete-btn", () => markContactTask(task.docId, task)],
      ["Edit", "edit-btn", () => editContactTask(task.docId, task)],
      ["Delete", "delete-btn", () => deleteContactTask(task.docId)]
    ]));
    list.appendChild(taskDiv);
  });
}
async function markContactTask(docId, task) {
  const now = Date.now();
  const prevDue = task.lastContact + task.frequency * ONE_DAY;
  const streak = now - prevDue <= ONE_DAY ? (task.streak || 0) + 1 : 0;
  await completeWithHistory("contactTasks", "contact", docId, task, { lastContact: now, streak }, now);
}
async function deleteContactTask(docId) {
  await Promise.all([deleteDoc(doc(db, "contactTasks", docId)), deleteDoc(doc(db, "taskCompletionHistory", completionHistoryDocId("contact", docId)))]);
}
function editContactTask(docId, task) {
  showEditModal(task, "contact", async values => {
    const updates = {};
    if (values.name) { updates.name = values.name; updates.contactName = values.name; }
    const ts = parseLocalDate(values.date).getTime();
    if (!Number.isNaN(ts)) updates.lastContact = ts;
    const freq = parseInt(values.frequency, 10);
    if (Number.isFinite(freq) && freq > 0) updates.frequency = freq;
    applyOptionalArea(updates, values.area);
    await updateDoc(doc(db, "contactTasks", docId), updates);
  });
}

async function addTodo() {
  const owner = document.getElementById("t-owner").value;
  const name = document.getElementById("t-task-name").value.trim();
  const dueDate = parseLocalDate(document.getElementById("t-due-date").value).getTime();
  const area = document.getElementById("t-area").value;
  const priority = document.getElementById("t-priority").value || DEFAULT_PRIORITY;
  const effort = document.getElementById("t-effort").value;
  const task = { owner, name, dueDate, created: Date.now(), type: "todo", priority };
  if (area) task.area = area;
  if (effort) task.estimatedMinutes = Number(effort);
  await addDoc(collection(db, "todos"), task);
  document.getElementById("todos-form").reset();
  updateOwnerDropdowns();
  resetAddFormMetadata("todo");
}

async function renderTodos() {
  const filtered = sortByDue(filterTasksByUser(await getTodos()), task => task.dueDate);
  const list = document.getElementById("todos-list");
  list.innerHTML = "";
  filtered.forEach(task => {
    const taskDiv = document.createElement("div");
    taskDiv.className = taskVisualClasses(task, "todo", task.dueDate);
    taskDiv.innerHTML = `<span><strong>${escapeHtml(task.name)}</strong></span><small>Due: ${escapeHtml(new Date(task.dueDate).toLocaleDateString())}</small>${metadataHtml(task, "todo")}<small>Owner: ${escapeHtml(task.owner)}</small>`;
    taskDiv.appendChild(buildActions([
      ["Mark Completed & Delete", "complete-btn", () => deleteTodo(task.docId)],
      ["Edit", "edit-btn", () => editTodo(task.docId, task)],
      ["Delete", "delete-btn", () => deleteTodo(task.docId)]
    ]));
    list.appendChild(taskDiv);
  });
}
async function deleteTodo(docId) { await deleteDoc(doc(db, "todos", docId)); }
function editTodo(docId, task) {
  showEditModal(task, "todo", async values => {
    const updates = {};
    if (values.name) updates.name = values.name;
    const ts = parseLocalDate(values.date).getTime();
    if (!Number.isNaN(ts)) updates.dueDate = ts;
    applyOptionalArea(updates, values.area);
    updates.priority = PRIORITY_LABELS[values.priority] ? values.priority : DEFAULT_PRIORITY;
    applyOptionalEffort(updates, values.estimatedMinutes);
    await updateDoc(doc(db, "todos", docId), updates);
  });
}

async function addBirthday() {
  const owner = document.getElementById("b-owner").value;
  const name = document.getElementById("b-task-name").value.trim();
  const dueDate = parseLocalDate(document.getElementById("b-date").value).getTime();
  const area = document.getElementById("b-area").value;
  const task = { owner, name, dueDate, completed: false, created: Date.now(), type: "birthday", streak: 0 };
  if (area) task.area = area;
  await addDoc(collection(db, "birthdays"), task);
  document.getElementById("birthdays-form").reset();
  updateOwnerDropdowns();
  resetAddFormMetadata("birthday");
}

async function renderBirthdays() {
  const filtered = sortByDue(filterTasksByUser(await getBirthdays()), task => task.dueDate);
  const list = document.getElementById("birthdays-list");
  list.innerHTML = "";
  filtered.forEach(task => {
    const taskDiv = document.createElement("div");
    taskDiv.className = taskVisualClasses(task, "birthday", task.dueDate);
    taskDiv.innerHTML = `<span><strong>${escapeHtml(task.name)}</strong></span><small>Next occurrence: ${escapeHtml(new Date(task.dueDate).toLocaleDateString())}</small>${metadataHtml(task, "birthday")}<div class="streak-visual">${getStreakVisualForScore(task.streak || 0, 1000)}</div><small>Owner: ${escapeHtml(task.owner)}</small>`;
    taskDiv.appendChild(buildActions([
      ["Completed", "complete-btn", () => markBirthdayCompleted(task.docId, task)],
      ["Edit", "edit-btn", () => editBirthday(task.docId, task)],
      ["Delete", "delete-btn", () => deleteBirthday(task.docId)]
    ]));
    list.appendChild(taskDiv);
  });
}
async function markBirthdayCompleted(docId, task) {
  const completedAt = Date.now();
  const dueDate = new Date(task.dueDate);
  const newDue = new Date(dueDate.getFullYear() + 1, dueDate.getMonth(), dueDate.getDate()).getTime();
  const streak = (task.streak || 0) + 1;
  await completeWithHistory("birthdays", "birthday", docId, task, { dueDate: newDue, streak }, completedAt);
}
async function deleteBirthday(docId) {
  await Promise.all([deleteDoc(doc(db, "birthdays", docId)), deleteDoc(doc(db, "taskCompletionHistory", completionHistoryDocId("birthday", docId)))]);
}
function editBirthday(docId, task) {
  showEditModal(task, "birthday", async values => {
    const updates = {};
    if (values.name) updates.name = values.name;
    const ts = parseLocalDate(values.date).getTime();
    if (!Number.isNaN(ts)) updates.dueDate = ts;
    applyOptionalArea(updates, values.area);
    await updateDoc(doc(db, "birthdays", docId), updates);
  });
}

function buildActions(specs) {
  const actions = document.createElement("div");
  actions.className = "task-actions";
  specs.forEach(([label, className, handler]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await handler(); }
      catch (err) { console.error(`Lyfe action failed: ${label}`, err); alert("That action failed. Please try again."); }
      finally { button.disabled = false; }
    });
    actions.appendChild(button);
  });
  return actions;
}

function renderCalendarView() {
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  document.getElementById("current-month-label").textContent = `${monthNames[calendarMonth]} ${calendarYear}`;
  const activeFilters = Array.from(document.querySelectorAll(".calendar-filter:checked")).map(cb => cb.value);
  let tasks = [];
  repeatingTasksCache.forEach(task => tasks.push({ ...task, displayDate: new Date(task.lastCompleted + task.frequency * ONE_DAY), taskType: "repeating", displayName: task.name || "No Name" }));
  contactTasksCache.forEach(task => tasks.push({ ...task, displayDate: new Date(task.lastContact + task.frequency * ONE_DAY), taskType: "contact", displayName: task.contactName || task.name || "No Name" }));
  todosCache.forEach(task => tasks.push({ ...task, displayDate: new Date(task.dueDate), taskType: "todo", displayName: task.name || "No Name" }));
  birthdaysCache.forEach(task => tasks.push({ ...task, displayDate: new Date(task.dueDate), taskType: "birthday", displayName: task.name || "No Name" }));
  tasks = filterTasksByUser(tasks.filter(task => activeFilters.includes(task.taskType)));

  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "";
  const table = document.createElement("table");
  const headerRow = document.createElement("tr");
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach(day => {
    const th = document.createElement("th"); th.textContent = day; headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let date = 1;
  for (let week = 0; week < 6; week++) {
    const row = document.createElement("tr");
    for (let dow = 0; dow < 7; dow++) {
      const cell = document.createElement("td");
      if (!(week === 0 && dow < firstDay) && date <= daysInMonth) {
        cell.textContent = date;
        const cellDate = new Date(calendarYear, calendarMonth, date);
        if (today.getFullYear() === cellDate.getFullYear() && today.getMonth() === cellDate.getMonth() && today.getDate() === cellDate.getDate()) cell.classList.add("today");
        const tasksForCell = tasks.filter(task => {
          const d = task.displayDate;
          return d.getFullYear() === cellDate.getFullYear() && d.getMonth() === cellDate.getMonth() && d.getDate() === cellDate.getDate();
        });
        if (cellDate < todayMid && tasksForCell.length) cell.classList.add("overdue-day");
        tasksForCell.forEach(task => {
          const taskDiv = document.createElement("div");
          taskDiv.textContent = task.displayName;
          taskDiv.className = `calendar-task calendar-${task.taskType}`;
          cell.appendChild(taskDiv);
        });
        date++;
      }
      row.appendChild(cell);
    }
    table.appendChild(row);
    if (date > daysInMonth) break;
  }
  grid.appendChild(table);
}

window.markRepeatingTaskCompleted = markRepeatingTaskCompleted;
window.editRepeatingTask = editRepeatingTask;
window.deleteRepeatingTask = deleteRepeatingTask;
window.markContactTask = markContactTask;
window.editContactTask = editContactTask;
window.deleteContactTask = deleteContactTask;
window.editTodo = editTodo;
window.deleteTodo = deleteTodo;
window.markBirthdayCompleted = markBirthdayCompleted;
window.editBirthday = editBirthday;
window.deleteBirthday = deleteBirthday;
window.lyfeUpdateStats = updateScoreboard;
