/* script.js */
import { 
  initializeApp 
} from "https://www.gstatic.com/firebasejs/11.3.0/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  onSnapshot,
  addDoc, 
  getDoc,
  setDoc,
  updateDoc, 
  deleteDoc, 
  doc 
} from "https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC_BtuwYiwwmDpAJQuRt4x30YyPGTYvZ7s",
  authDomain: "lyfe-cacf7.firebaseapp.com",
  projectId: "lyfe-cacf7",
  storageBucket: "lyfe-cacf7.firebasestorage.app",
  messagingSenderId: "119442487958",
  appId: "1:119442487958:web:e218fafb50513ad717e0b7",
  measurementId: "G-WE8CC23QSC"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Global caches for real-time data
let repeatingTasksCache = [];
let contactTasksCache = [];
let todosCache = [];
let birthdaysCache = [];

// Calendar state remains for Calendar View
let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();

//////////////////////////////////////////////////
// DOM Ready
//////////////////////////////////////////////////
document.addEventListener("DOMContentLoaded", () => {
  // Initialize users (default to Alomi)
  if (!localStorage.getItem("users")) {
    localStorage.setItem("users", JSON.stringify(["Sebo", "Alomi"]));
  }
  if (!localStorage.getItem("currentUser")) {
    localStorage.setItem("currentUser", "Alomi");
  }
  updateUserDropdowns();
  updateOwnerDropdowns();
  document.getElementById("user-select").value = localStorage.getItem("currentUser");
  document.getElementById("user-select").addEventListener("change", function() {
    localStorage.setItem("currentUser", this.value);
    updateOwnerDropdowns();
    refreshView();
  });

  // Navigation Bar Handlers
  document.querySelectorAll("#nav-bar button").forEach(button => {
    button.addEventListener("click", function() {
      document.querySelectorAll("#nav-bar button").forEach(btn => btn.classList.remove("active"));
      this.classList.add("active");
      const selectedType = this.getAttribute("data-type");
      reorderColumns(selectedType);
    });
  });

  // Set up real-time listeners

  // Repeating Tasks Listener
  const repeatingColRef = collection(db, "repeatingTasks");
  onSnapshot(repeatingColRef, (snapshot) => {
    repeatingTasksCache = [];
    snapshot.forEach(docSnap => {
      let data = docSnap.data();
      data.docId = docSnap.id;
      repeatingTasksCache.push(data);
    });
    renderRepeatingTasks();
  });

  // Contact Tasks Listener
  const contactColRef = collection(db, "contactTasks");
  onSnapshot(contactColRef, (snapshot) => {
    contactTasksCache = [];
    snapshot.forEach(docSnap => {
      let data = docSnap.data();
      data.docId = docSnap.id;
      contactTasksCache.push(data);
    });
    renderContactTasks();
  });

  // Todos Listener
  const todosColRef = collection(db, "todos");
  onSnapshot(todosColRef, (snapshot) => {
    todosCache = [];
    snapshot.forEach(docSnap => {
      let data = docSnap.data();
      data.docId = docSnap.id;
      todosCache.push(data);
    });
    renderTodos();
  });

  // Birthdays Listener
  const birthdaysColRef = collection(db, "birthdays");
  onSnapshot(birthdaysColRef, (snapshot) => {
    birthdaysCache = [];
    snapshot.forEach(docSnap => {
      let data = docSnap.data();
      data.docId = docSnap.id;
      birthdaysCache.push(data);
    });
    renderBirthdays();
  });

  // Form Handlers
  document.getElementById("repeating-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await addRepeatingTask();
  });
  document.getElementById("contacts-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await addContactTask();
  });
  document.getElementById("todos-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await addTodo();
  });
  document.getElementById("birthdays-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await addBirthday();
  });

  // Calendar controls setup
  document.getElementById("prev-month").addEventListener("click", function() {
    if (calendarMonth === 0) {
      calendarMonth = 11;
      calendarYear -= 1;
    } else {
      calendarMonth -= 1;
    }
    renderCalendarView();
  });
  document.getElementById("next-month").addEventListener("click", function() {
    if (calendarMonth === 11) {
      calendarMonth = 0;
      calendarYear += 1;
    } else {
      calendarMonth += 1;
    }
    renderCalendarView();
  });
  document.querySelectorAll(".calendar-filter").forEach(checkbox => {
    checkbox.addEventListener("change", renderCalendarView);
  });

  // Initially display one of the views; for example, start with the Repeating Tasks view:
  reorderColumns("repeating");
  updateScoreboard();
  setInterval(refreshView, 60000);
});

//////////////////////////////////////////////////
// Data Access Functions (using caches)
//////////////////////////////////////////////////
async function getRepeatingTasks() {
  return repeatingTasksCache;
}
async function getContactTasks() {
  return contactTasksCache;
}
async function getTodos() {
  return todosCache;
}
async function getBirthdays() {
  return birthdaysCache;
}

//////////////////////////////////////////////////
// SCOREBOARD & CLEAN CHECK FUNCTIONS
//////////////////////////////////////////////////
async function isCleanDayForUser(user) {
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  
  let repeating = (await getRepeatingTasks()).filter(task => task.owner === user);
  let contact = (await getContactTasks()).filter(task => task.owner === user);
  let todos = (await getTodos()).filter(task => task.owner === user);
  let birthdays = (await getBirthdays()).filter(task => task.owner === user);
  
  repeating.forEach(task => {
    task.nextDue = task.lastCompleted + task.frequency * 24 * 60 * 60 * 1000;
  });
  contact.forEach(task => {
    task.nextDue = task.lastContact + task.frequency * 24 * 60 * 60 * 1000;
  });
  
  if (repeating.some(task => task.nextDue < todayMidnight)) return false;
  if (contact.some(task => task.nextDue < todayMidnight)) return false;
  if (todos.some(task => task.dueDate < todayMidnight)) return false;
  if (birthdays.some(task => task.dueDate < todayMidnight)) return false;
  
  return true;
}

async function isRepeatingCleanForUser(user) {
  let tasks = (await getRepeatingTasks()).filter(task => task.owner === user);
  let today = new Date();
  let todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  tasks.forEach(task => {
    task.nextDue = task.lastCompleted + task.frequency * 24 * 60 * 60 * 1000;
  });
  return tasks.every(task => task.nextDue >= todayMidnight);
}

async function isContactCleanForUser(user) {
  let tasks = (await getContactTasks()).filter(task => task.owner === user);
  let today = new Date();
  let todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  tasks.forEach(task => {
    task.nextDue = task.lastContact + task.frequency * 24 * 60 * 60 * 1000;
  });
  return tasks.every(task => task.nextDue >= todayMidnight);
}

async function isTodoCleanForUser(user) {
  let tasks = (await getTodos()).filter(task => task.owner === user);
  let today = new Date();
  let todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return tasks.every(task => task.dueDate >= todayMidnight);
}

async function isBirthdayCleanForUser(user) {
  let tasks = (await getBirthdays()).filter(task => task.owner === user);
  let today = new Date();
  let todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return tasks.every(task => task.dueDate >= todayMidnight);
}

//////////////////////////////////////////////////
// SCOREBOARD UPDATE (Stored in Firestore)
//////////////////////////////////////////////////
async function updateScoreboard() {
  const users = JSON.parse(localStorage.getItem("users"));
  let scoreboard = JSON.parse(localStorage.getItem("scoreboard") || "{}");
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const todayTimestamp = parseLocalDate(todayStr).getTime();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const yesterdayTimestamp = parseLocalDate(yesterdayStr).getTime();

  for (const user of users) {
    const docRef = doc(db, "scoreboards", user);
    let userScoreboard = {};
    try {
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        userScoreboard = docSnap.data();
      }
    } catch (err) {
      console.error(err);
    }
    userScoreboard.overallCleanDays = userScoreboard.overallCleanDays || 0;
    userScoreboard.overallStreak = userScoreboard.overallStreak || 0;
    userScoreboard.lastOverallUpdate = userScoreboard.lastOverallUpdate || 0;
   
    if (userScoreboard.lastOverallUpdate !== todayTimestamp) {
      let overallClean = await isCleanDayForUser(user);
      if (overallClean) {
        userScoreboard.overallCleanDays += 1;
        userScoreboard.overallStreak = (userScoreboard.lastOverallUpdate === yesterdayTimestamp)
          ? userScoreboard.overallStreak + 1
          : 1;
      } else {
        userScoreboard.overallStreak = 0;
      }
      userScoreboard.lastOverallUpdate = todayTimestamp;
    }

    await setDoc(docRef, userScoreboard, { merge: true });
    scoreboard[user] = userScoreboard;
  }
  displayScoreboard(scoreboard);
}

//////////////////////////////////////////////////
// DISPLAY SCOREBOARD (Grid Layout via CSS)
//////////////////////////////////////////////////
function displayScoreboard(scoreboard) {
  const scoreboardEl = document.getElementById("scoreboard");
  if (!scoreboardEl) return;
  
  const users = JSON.parse(localStorage.getItem("users"));
  
  let overallCleanHTML = "Total Clean Days:<br>";
  users.forEach(user => {
    let data = scoreboard[user] || {};
    overallCleanHTML += `<strong>${user}:</strong> ${data.overallCleanDays || 0}<br>`;
  });
  
  let overallStreakHTML = "Current Streak:<br>";
  users.forEach(user => {
    let data = scoreboard[user] || {};
    overallStreakHTML += `<strong>${user}:</strong> ${getStreakVisualForScore(data.overallStreak || 0, 100)}<br>`;
  });
  
  scoreboardEl.innerHTML = `
    <div class="cell overall-clean">${overallCleanHTML}</div>
    <div class="cell overall-streak">${overallStreakHTML}</div>
  `;
}

function getStreakVisualForScore(streak, cap) {
  const effective = Math.min(streak, cap);
  let stars = Math.floor(effective / 10);
  let checks = effective % 10;
  let visual = "";
  if (stars > 0) {
    for (let i = 0; i < stars; i++) {
      visual += "⭐";
    }
    visual += "<br>";
  }
  if (checks > 0) {
    for (let i = 0; i < checks; i++) {
      visual += "✅";
    }
  }
  return visual;
}

//////////////////////////////////////////////////
// Navigation / Reorder Columns / Calendar View
//////////////////////////////////////////////////
function reorderColumns(selectedType) {
  // Get references to view containers
  const columnsContainer = document.getElementById("columns-container");
  const calendarView = document.getElementById("calendar-view");
  
  // Hide both containers initially
  columnsContainer.style.display = "none";
  calendarView.style.display = "none";
  
  if (selectedType === "calendar") {
    calendarView.style.display = "block";
    renderCalendarView();
  } else {
    // For regular task views: repeating, contact, todos, birthdays  
    columnsContainer.style.display = "flex";
    // Reorder the columns as needed
    const repeating = document.getElementById("repeating-column");
    const contacts = document.getElementById("contacts-column");
    const todos = document.getElementById("todos-column");
    const birthdays = document.getElementById("birthdays-column");
    let order = [];
  
    if (selectedType === "repeating") {
      order = [repeating, contacts, todos, birthdays];
    } else if (selectedType === "contact") {
      order = [contacts, repeating, todos, birthdays];
    } else if (selectedType === "todos") {
      order = [todos, repeating, contacts, birthdays];
    } else if (selectedType === "birthdays") {
      order = [birthdays, repeating, contacts, todos];
    } else {
      order = [repeating, contacts, todos, birthdays];
    }
    const container = document.querySelector(".columns");
    container.innerHTML = "";
    order.forEach(col => container.appendChild(col));
  }
}

//////////////////////////////////////////////////
// Helper: Re-render the current view
//////////////////////////////////////////////////
function refreshView() {
  if (document.getElementById("calendar-view").style.display !== "none") {
    renderCalendarView();
  } else {
    renderRepeatingTasks();
    renderContactTasks();
    renderTodos();
    renderBirthdays();
  }
}

//////////////////////////////////////////////////
// User Management
//////////////////////////////////////////////////
function updateUserDropdowns() {
  let users = JSON.parse(localStorage.getItem("users"));
  const options = ["All", ...users];
  const headerSelect = document.getElementById("user-select");
  headerSelect.innerHTML = "";
  options.forEach(user => {
    const opt = document.createElement("option");
    opt.value = user;
    opt.textContent = user;
    headerSelect.appendChild(opt);
  });
}
function updateOwnerDropdowns() {
  let users = JSON.parse(localStorage.getItem("users"));
  const options = ["All", ...users];
  ["r-owner", "c-owner", "t-owner", "b-owner"].forEach(id => {
    const select = document.getElementById(id);
    if (select) {
      select.innerHTML = "";
      options.forEach(user => {
        const opt = document.createElement("option");
        opt.value = user;
        opt.textContent = user;
        select.appendChild(opt);
      });
      select.value = localStorage.getItem("currentUser");
    }
  });
}

//////////////////////////////////////////////////
// Utility Functions
//////////////////////////////////////////////////
function sortByDue(tasks, getDueDateFn) {
  return tasks.sort((a, b) => getDueDateFn(a) - getDueDateFn(b));
}
function getDueClass(dueTime) {
  // This general function can be used by non-repeating tasks.
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dueDate = new Date(dueTime);
  const dueMidnight = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  const diffDays = (dueMidnight - todayMidnight) / (24 * 60 * 60 * 1000);
  if (diffDays < 0) return " overdue";
  else if (diffDays === 0) return " due-today";
  else if (diffDays <= 2) return " almost-due";
  else if (diffDays <= 4) return " due-soon";
  else return "";
}
  
// New function: Custom due class for repeating tasks based on frequency.
function getRepeatingDueClass(task) {
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diffDays = Math.floor((task.nextDue - todayMidnight) / (24 * 60 * 60 * 1000));
  
  if (diffDays < 0) return " overdue";         // Overdue (same for all)
  if (diffDays === 0) return " due-today";       // Due today (same for all)
  
  // For frequency=1: if due in 1 day then no special coloring.
  if (task.frequency === 1) {
    if (diffDays === 1) return "";
  }
  
  // For frequency 2 or 3: if due in 1 day return a green indicator.
  if (task.frequency === 2 || task.frequency === 3) {
    if (diffDays === 1) return " due-soon";
  }
  
  // Otherwise, no special class.
  return "";
}

function filterTasksByUser(tasks) {
  const currentUser = localStorage.getItem("currentUser");
  // If viewing “All”, show everything
  if (currentUser === "All") return tasks;
  // Otherwise show tasks either owned by this user or marked “All”
  return tasks.filter(task =>
    task.owner === currentUser ||
    task.owner === "All"
  );
}
function formatDateForInput(timestamp) {
  const d = new Date(timestamp);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split("T")[0];
}
function parseLocalDate(dateString) {
  const parts = dateString.split("-");
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

//////////////////////////////////////////////////
// Streak Visual Function (for individual tasks)
//////////////////////////////////////////////////
function getStreakVisual(streak) {
  const effective = Math.min(streak, 100);
  let stars = Math.floor(effective / 10);
  let checks = effective % 10;
  stars = Math.min(stars, 10);
  let visual = "";
  if (stars > 0) {
    for (let i = 0; i < stars; i++) {
      visual += "⭐";
    }
    visual += "<br>";
  }
  if (checks > 0) {
    for (let i = 0; i < checks; i++) {
      visual += "✅";
    }
  }
  return visual;
}

//////////////////////////////////////////////////
// Edit Modal Functions
//////////////////////////////////////////////////
function showEditModal(task, type, callback) {
  const modal     = document.getElementById("edit-modal");
  const titleEl   = document.getElementById("edit-modal-title");
  const fieldsDiv = document.getElementById("edit-fields");
  fieldsDiv.innerHTML = "";

  function createField(labelText, inputType, value, inputId) {
    const container = document.createElement("div");
    container.className = "edit-field";
    const label = document.createElement("label");
    label.textContent = labelText;
    label.style.display = "block";
    const input = document.createElement("input");
    input.type = inputType;
    input.value = value;
    input.id = inputId;
    input.style.marginTop = "4px";
    container.appendChild(label);
    container.appendChild(input);
    return container;
  }

  // 1) Name field (for all types)
  let currentName = task.name;
  if (type === "contact") currentName = task.contactName || task.name;
  fieldsDiv.appendChild(createField("Name:", "text", currentName, "edit-name"));

  // 2) Date / Frequency fields as before
  if (type === "repeating") {
    titleEl.textContent = "Edit Repeating Task";
    fieldsDiv.appendChild(
      createField(
        "Last Completed Date:",
        "date",
        formatDateForInput(task.lastCompleted),
        "edit-date"
      )
    );
    fieldsDiv.appendChild(
      createField("Frequency (days):", "number", task.frequency, "edit-frequency")
    );
  } else if (type === "contact") {
    titleEl.textContent = "Edit Keep in Touch Task";
    fieldsDiv.appendChild(
      createField(
        "Last Contact Date:",
        "date",
        formatDateForInput(task.lastContact),
        "edit-date"
      )
    );
    fieldsDiv.appendChild(
      createField("Frequency (days):", "number", task.frequency, "edit-frequency")
    );
  } else if (type === "todo") {
    titleEl.textContent = "Edit One-off Todo";
    fieldsDiv.appendChild(
      createField("Due Date:", "date", formatDateForInput(task.dueDate), "edit-date")
    );
  } else if (type === "birthday") {
    titleEl.textContent = "Edit Birthday/Occasion";
    fieldsDiv.appendChild(
      createField("Occasion Date:", "date", formatDateForInput(task.dueDate), "edit-date")
    );
  }

  modal.style.display = "flex";
  const form = document.getElementById("edit-form");
  form.onsubmit = function (e) {
    e.preventDefault();

    // pull out all the new values
    const newName = document.getElementById("edit-name").value;
    const newDate = document.getElementById("edit-date")?.value;
    const newFreq = document.getElementById("edit-frequency")?.value;

    callback(newName, newDate, newFreq);
    hideEditModal();
  };
  document.getElementById("edit-cancel-btn").onclick = hideEditModal;
}

function hideEditModal() {
  document.getElementById("edit-modal").style.display = "none";
}

//////////////////////////////////////////////////
// Repeating Tasks Functions (Updated Color Coding)
//////////////////////////////////////////////////
async function addRepeatingTask() {
  const owner = document.getElementById("r-owner").value;
  const name = document.getElementById("r-task-name").value;
  const frequency = parseInt(document.getElementById("r-frequency").value);
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const newTask = {
    owner,
    name,
    frequency,
    lastCompleted: todayMidnight,
    streak: 0,
    type: "repeating"
  };
  await addDoc(collection(db, "repeatingTasks"), newTask);
  document.getElementById("repeating-form").reset();
  updateOwnerDropdowns();
}
async function renderRepeatingTasks() {
  let tasks = await getRepeatingTasks();
  let filtered = filterTasksByUser(tasks);
  filtered.forEach(task => {
    task.nextDue = task.lastCompleted + task.frequency * 24 * 60 * 60 * 1000;
  });
  filtered = sortByDue(filtered, task => task.nextDue);
  const list = document.getElementById("repeating-list");
  list.innerHTML = "";
  filtered.forEach(task => {
    // Use the custom function for repeating tasks
    const dueClass = getRepeatingDueClass(task);
    const taskDiv = document.createElement("div");
    taskDiv.className = "task-item" + dueClass;
    taskDiv.innerHTML = `
      <span><strong>${task.name}</strong> (Every ${task.frequency} day${task.frequency>1?"s":""})</span>
      <small>Next due: ${new Date(task.nextDue).toLocaleDateString()}</small>
      <div class="streak-visual">${getStreakVisual(task.streak)}</div>
      <small>Owner: ${task.owner}</small>`;
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "task-actions";
    const completeBtn = document.createElement("button");
    completeBtn.className = "complete-btn";
    completeBtn.innerText = "Completed Today";
    completeBtn.addEventListener("click", async function () {
      await markRepeatingTaskCompleted(task.docId, task);
    });
    actionsDiv.appendChild(completeBtn);
    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.innerText = "Edit";
    editBtn.addEventListener("click", function () {
      editRepeatingTask(task.docId, task);
    });
    actionsDiv.appendChild(editBtn);
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerText = "Delete";
    deleteBtn.addEventListener("click", async function () {
      await deleteRepeatingTask(task.docId);
    });
    actionsDiv.appendChild(deleteBtn);
    taskDiv.appendChild(actionsDiv);
    list.appendChild(taskDiv);
  });
}
async function markRepeatingTaskCompleted(docId, task) {
  let now = Date.now();
  const prevDue = task.lastCompleted + task.frequency * 24 * 60 * 60 * 1000;
  const gracePeriod = 24 * 60 * 60 * 1000;
  if (now - prevDue <= gracePeriod) {
    task.streak = (task.streak || 0) + 1;
  } else {
    task.streak = 0;
  }
  task.lastCompleted = now;
  await updateDoc(doc(db, "repeatingTasks", docId), task);
  refreshView();
}
async function deleteRepeatingTask(docId) {
  await deleteDoc(doc(db, "repeatingTasks", docId));
  refreshView();
}
function editRepeatingTask(docId, task) {
  showEditModal(task, "repeating", async (newName, newDate, newFreq) => {
    if (newName) task.name = newName;

    // parseLocalDate returns a Date at local midnight
    const ts = parseLocalDate(newDate).getTime();
    if (!isNaN(ts)) task.lastCompleted = ts;

    const f = parseInt(newFreq);
    if (!isNaN(f) && f > 0) task.frequency = f;

    await updateDoc(doc(db, "repeatingTasks", docId), task);
    renderRepeatingTasks();
  });
}

//////////////////////////////////////////////////
// Keep in Touch Tasks Functions
//////////////////////////////////////////////////
async function addContactTask() {
  const owner = document.getElementById("c-owner").value;
  const name = document.getElementById("c-contact-name").value;
  const frequency = parseInt(document.getElementById("c-frequency").value);
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const newTask = {
    owner,
    name,
    contactName: name,
    frequency,
    lastContact: todayMidnight,
    streak: 0,
    type: "contact"
  };
  await addDoc(collection(db, "contactTasks"), newTask);
  document.getElementById("contacts-form").reset();
  updateOwnerDropdowns();
}
async function renderContactTasks() {
  let tasks = await getContactTasks();
  let filtered = filterTasksByUser(tasks);
  filtered.forEach(task => {
    task.nextDue = task.lastContact + task.frequency * 24 * 60 * 60 * 1000;
  });
  filtered = sortByDue(filtered, task => task.nextDue);
  const list = document.getElementById("contacts-list");
  list.innerHTML = "";
  filtered.forEach(task => {
    const dueClass = getDueClass(task.nextDue);
    const taskDiv = document.createElement("div");
    taskDiv.className = "task-item" + dueClass;
    taskDiv.innerHTML = `
      <span><strong>${task.contactName}</strong> (Every ${task.frequency} day${task.frequency>1?"s":""})</span>
      <small>Next contact: ${new Date(task.nextDue).toLocaleDateString()}</small>
      <div class="streak-visual">${getStreakVisual(task.streak)}</div>
      <small>Owner: ${task.owner}</small>`;
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "task-actions";
    const completeBtn = document.createElement("button");
    completeBtn.className = "complete-btn";
    completeBtn.innerText = "Completed Today";
    completeBtn.addEventListener("click", async function () {
      await markContactTask(task.docId, task);
    });
    actionsDiv.appendChild(completeBtn);
    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.innerText = "Edit";
    editBtn.addEventListener("click", function () {
      editContactTask(task.docId, task);
    });
    actionsDiv.appendChild(editBtn);
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerText = "Delete";
    deleteBtn.addEventListener("click", async function () {
      await deleteContactTask(task.docId);
    });
    actionsDiv.appendChild(deleteBtn);
    taskDiv.appendChild(actionsDiv);
    list.appendChild(taskDiv);
  });
}
async function markContactTask(docId, task) {
  let now = Date.now();
  const prevDue = task.lastContact + task.frequency * 24 * 60 * 60 * 1000;
  const gracePeriod = 24 * 60 * 60 * 1000;
  if (now - prevDue <= gracePeriod) {
    task.streak = (task.streak || 0) + 1;
  } else {
    task.streak = 0;
  }
  task.lastContact = now;
  await updateDoc(doc(db, "contactTasks", docId), task);
  refreshView();
}
async function deleteContactTask(docId) {
  await deleteDoc(doc(db, "contactTasks", docId));
  refreshView();
}
function editContactTask(docId, task) {
  showEditModal(task, "contact", async (newName, newDate, newFreq) => {
    if (newName) {
      task.contactName = newName;
      task.name = newName; 
    }
    const ts = parseLocalDate(newDate).getTime();
    if (!isNaN(ts)) task.lastContact = ts;

    const f = parseInt(newFreq);
    if (!isNaN(f) && f > 0) task.frequency = f;

    await updateDoc(doc(db, "contactTasks", docId), task);
    renderContactTasks();
  });
}

//////////////////////////////////////////////////
// One-off Todos Functions (Delete on Complete)
//////////////////////////////////////////////////
async function addTodo() {
  const owner = document.getElementById("t-owner").value;
  const name = document.getElementById("t-task-name").value;
  const dueDateStr = document.getElementById("t-due-date").value;
  const dueDate = parseLocalDate(dueDateStr).getTime();
  const newTodo = {
    owner,
    name,
    dueDate,
    created: Date.now(),
    type: "todo"
  };
  await addDoc(collection(db, "todos"), newTodo);
  document.getElementById("todos-form").reset();
  updateOwnerDropdowns();
}
async function renderTodos() {
  let tasks = await getTodos();
  let filtered = filterTasksByUser(tasks);
  filtered = sortByDue(filtered, t => t.dueDate);
  const list = document.getElementById("todos-list");
  list.innerHTML = "";
  filtered.forEach(todo => {
    const dueClass = getDueClass(todo.dueDate);
    const taskDiv = document.createElement("div");
    taskDiv.className = "task-item" + dueClass;
    taskDiv.innerHTML = `
      <span><strong>${todo.name}</strong></span>
      <small>Due: ${new Date(todo.dueDate).toLocaleDateString()}</small>
      <br>
      <small>Owner: ${todo.owner}</small>`;
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "task-actions";
    const completeBtn = document.createElement("button");
    completeBtn.className = "complete-btn";
    completeBtn.innerText = "Mark Completed & Delete";
    completeBtn.addEventListener("click", async function () {
      await deleteTodo(todo.docId);
    });
    actionsDiv.appendChild(completeBtn);
    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.innerText = "Edit";
    editBtn.addEventListener("click", function () {
      editTodo(todo.docId, todo);
    });
    actionsDiv.appendChild(editBtn);
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerText = "Delete";
    deleteBtn.addEventListener("click", async function () {
      await deleteTodo(todo.docId);
    });
    actionsDiv.appendChild(deleteBtn);
    taskDiv.appendChild(actionsDiv);
    list.appendChild(taskDiv);
  });
}
async function deleteTodo(docId) {
  await deleteDoc(doc(db, "todos", docId));
  refreshView();
}
function editTodo(docId, task) {
  showEditModal(task, "todo", async (newName, newDate) => {
    if (newName) task.name = newName;

    const ts = parseLocalDate(newDate).getTime();
    if (!isNaN(ts)) task.dueDate = ts;

    await updateDoc(doc(db, "todos", docId), task);
    renderTodos();
  });
}

//////////////////////////////////////////////////
// Birthdays/Occasions Functions
//////////////////////////////////////////////////
async function addBirthday() {
  const owner = document.getElementById("b-owner").value;
  const name = document.getElementById("b-task-name").value;
  const dateStr = document.getElementById("b-date").value;
  const dueDate = parseLocalDate(dateStr).getTime();
  const newTask = {
    owner,
    name,
    dueDate,
    completed: false,
    created: Date.now(),
    type: "birthday",
    streak: 0
  };
  await addDoc(collection(db, "birthdays"), newTask);
  document.getElementById("birthdays-form").reset();
  updateOwnerDropdowns();
}
async function renderBirthdays() {
  let tasks = await getBirthdays();
  let filtered = filterTasksByUser(tasks);
  filtered = sortByDue(filtered, task => task.dueDate);
  const list = document.getElementById("birthdays-list");
  list.innerHTML = "";
  filtered.forEach(task => {
    const dueClass = getDueClass(task.dueDate);
    const taskDiv = document.createElement("div");
    taskDiv.className = "task-item" + dueClass;
    taskDiv.innerHTML = `
      <span><strong>${task.name}</strong></span>
      <small>Next Occurrence: ${new Date(task.dueDate).toLocaleDateString()}</small>
      <div class="streak-visual">${getStreakVisualForScore(task.streak || 0, 1000)}</div>
      <br>
      <small>Owner: ${task.owner}</small>`;
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "task-actions";
    const completeBtn = document.createElement("button");
    completeBtn.className = "complete-btn";
    completeBtn.innerText = "Completed";
    completeBtn.addEventListener("click", async function () {
      await markBirthdayCompleted(task.docId, task);
    });
    actionsDiv.appendChild(completeBtn);
    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.innerText = "Edit";
    editBtn.addEventListener("click", function () {
      editBirthday(task.docId, task);
    });
    actionsDiv.appendChild(editBtn);
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerText = "Delete";
    deleteBtn.addEventListener("click", async function () {
      await deleteBirthday(task.docId);
    });
    actionsDiv.appendChild(deleteBtn);
    taskDiv.appendChild(actionsDiv);
    list.appendChild(taskDiv);
  });
}
async function markBirthdayCompleted(docId, task) {
  const dueDate = new Date(task.dueDate);
  task.streak = (task.streak || 0) + 1;
  const nextYear = dueDate.getFullYear() + 1;
  const newDue = new Date(nextYear, dueDate.getMonth(), dueDate.getDate()).getTime();
  task.dueDate = newDue;
  await updateDoc(doc(db, "birthdays", docId), task);
  refreshView();
}
async function deleteBirthday(docId) {
  await deleteDoc(doc(db, "birthdays", docId));
  refreshView();
}
function editBirthday(docId, task) {
  showEditModal(task, "birthday", async (newName, newDate) => {
    if (newName) task.name = newName;

    const ts = parseLocalDate(newDate).getTime();
    if (!isNaN(ts)) task.dueDate = ts;

    await updateDoc(doc(db, "birthdays", docId), task);
    renderBirthdays();
  });
}

//////////////////////////////////////////////////
// Calendar View Functions
//////////////////////////////////////////////////
function renderCalendarView() {
  const monthNames = ["January", "February", "March", "April", "May", "June",
                      "July", "August", "September", "October", "November", "December"];
  document.getElementById("current-month-label").textContent =
    monthNames[calendarMonth] + " " + calendarYear;

  // which types to show
  let activeFilters = Array.from(
    document.querySelectorAll(".calendar-filter:checked")
  ).map(cb => cb.value);

  // build a flat task list with displayDate + displayName
  let tasks = [];
  repeatingTasksCache.forEach(task => {
    task.displayDate = new Date(task.lastCompleted + task.frequency * 86400000);
    task.taskType    = "repeating";
    task.displayName = task.name || "No Name";
    tasks.push(task);
  });
  contactTasksCache.forEach(task => {
    task.displayDate = new Date(task.lastContact + task.frequency * 86400000);
    task.taskType    = "contact";
    task.displayName = task.contactName || task.name || "No Name";
    tasks.push(task);
  });
  todosCache.forEach(task => {
    task.displayDate = new Date(task.dueDate);
    task.taskType    = "todo";
    task.displayName = task.name || "No Name";
    tasks.push(task);
  });
  birthdaysCache.forEach(task => {
    task.displayDate = new Date(task.dueDate);
    task.taskType    = "birthday";
    task.displayName = task.name || "No Name";
    tasks.push(task);
  });

  // apply filters and ownership
  tasks = tasks.filter(t => activeFilters.includes(t.taskType));
  tasks = filterTasksByUser(tasks);

  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "";

  let table    = document.createElement("table");
  let headerRow = document.createElement("tr");
  ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach(day => {
    let th = document.createElement("th");
    th.textContent = day;
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  const firstDay   = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth+1, 0).getDate();
  let date        = 1;
  const today     = new Date();
  const todayMid  = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  for (let week = 0; week < 6; week++) {
    let row = document.createElement("tr");

    for (let dow = 0; dow < 7; dow++) {
      let cell = document.createElement("td");

      if (week === 0 && dow < firstDay) {
        cell.textContent = "";
      } else if (date > daysInMonth) {
        cell.textContent = "";
      } else {
        // fill in the date number
        cell.textContent = date;
        let cellDate = new Date(calendarYear, calendarMonth, date);

        // highlight today
        if (
          today.getFullYear() === cellDate.getFullYear() &&
          today.getMonth()    === cellDate.getMonth() &&
          today.getDate()     === cellDate.getDate()
        ) {
          cell.classList.add("today");
        }

        // find tasks for this cell
        const tasksForCell = tasks.filter(task => {
          let d = task.displayDate;
          return (
            d.getFullYear() === cellDate.getFullYear() &&
            d.getMonth()    === cellDate.getMonth() &&
            d.getDate()     === cellDate.getDate()
          );
        });

        // if this date is before today and has tasks, mark overdue
        if (cellDate < todayMid && tasksForCell.length) {
          cell.classList.add("overdue-day");
        }

        // render each task
        tasksForCell.forEach(task => {
          let taskDiv = document.createElement("div");
          taskDiv.textContent = task.displayName;
          taskDiv.className = "calendar-task calendar-" + task.taskType;
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


//////////////////////////////////////////////////
// Expose Functions for Inline Event Handlers
//////////////////////////////////////////////////
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
