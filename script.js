/* script.js */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  getDocs, 
  addDoc, 
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
    // If the View All container is visible, re-render it; otherwise, re-render all tasks
    if (document.getElementById("all-tasks-view").style.display !== "none") {
      renderViewAll();
    } else {
      renderAllTasks();
    }
  });

  // Navigation Bar Handlers (including View All)
  document.querySelectorAll("#nav-bar button").forEach(button => {
    button.addEventListener("click", function() {
      document.querySelectorAll("#nav-bar button").forEach(btn => btn.classList.remove("active"));
      this.classList.add("active");
      const selectedType = this.getAttribute("data-type");
      reorderColumns(selectedType);
    });
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

  updateScoreboard();

  // Initial Render (default view: columns)
  renderAllTasks();
  setInterval(renderAllTasks, 60000);
});

// ===== SCOREBOARD FUNCTIONS =====

// Returns true if the user has no overdue/uncompleted tasks for today.
async function isCleanDayForUser(user) {
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  
  // Retrieve individual tasks for this user.
  let repeating = (await getRepeatingTasks()).filter(task => task.owner === user);
  let contact   = (await getContactTasks()).filter(task => task.owner === user);
  let todos     = (await getTodos()).filter(task => task.owner === user);
  let birthdays = (await getBirthdays()).filter(task => task.owner === user);
  
  // For repeating and contact tasks, compute nextDue.
  repeating.forEach(task => {
    task.nextDue = task.lastCompleted + task.frequency * 24 * 60 * 60 * 1000;
  });
  contact.forEach(task => {
    task.nextDue = task.lastContact + task.frequency * 24 * 60 * 60 * 1000;
  });
  
  // Check for overdue tasks:
  // - For repeating/contact: overdue if nextDue is before today's midnight.
  // - For todos: if not completed and dueDate is before today's midnight.
  // - For birthdays: if dueDate is before today's midnight.
  if (repeating.some(task => task.nextDue < todayMidnight)) return false;
  if (contact.some(task => task.nextDue < todayMidnight)) return false;
  if (todos.some(task => !task.completed && task.dueDate < todayMidnight)) return false;
  if (birthdays.some(task => task.dueDate < todayMidnight)) return false;
  
  return true;
}

// Returns true if the user's birthday tasks are "clean" for today (i.e. none are overdue).
async function isBirthdayCleanForUser(user) {
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  let birthdays = (await getBirthdays()).filter(task => task.owner === user);
  // For birthdays, consider it clean if all birthday tasks have dueDate >= today.
  return birthdays.every(task => task.dueDate >= todayMidnight);
}

// Returns a visual representation for streak values, using stars and checkmarks.
// For the overall streak, cap the effective value at 100;
// for birthdays, we allow a cap up to 1000.
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

// Updates the scoreboard for all users and saves it in localStorage.
// The scoreboard object structure is as follows:
// {
//   "User1": {
//     totalCleanDays: number,
//     overallStreak: number,
//     lastOverallUpdate: "YYYY-MM-DD",
//     birthdayCleanDays: number,
//     birthdayStreak: number,
//     lastBirthdayUpdate: "YYYY-MM-DD"
//   },
//   "User2": { ... }
// }
async function updateScoreboard() {
  const users = JSON.parse(localStorage.getItem("users"));
  let scoreboard = JSON.parse(localStorage.getItem("scoreboard") || "{}");
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0]; // "YYYY-MM-DD"
  
  for (const user of users) {
    // Initialize if needed.
    if (!scoreboard[user]) {
      scoreboard[user] = {
        totalCleanDays: 0,
        overallStreak: 0,
        lastOverallUpdate: "",
        birthdayCleanDays: 0,
        birthdayStreak: 0,
        lastBirthdayUpdate: ""
      };
    }
    
    // ---- Overall Clean Day Streak ----
    if (scoreboard[user].lastOverallUpdate !== todayStr) {
      const overallClean = await isCleanDayForUser(user);
      if (overallClean) {
        // Check if yesterday was updated.
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split("T")[0];
        
        if (scoreboard[user].lastOverallUpdate === yesterdayStr) {
          scoreboard[user].overallStreak += 1;
        } else {
          scoreboard[user].overallStreak = 1;
        }
        scoreboard[user].totalCleanDays += 1;
      } else {
        scoreboard[user].overallStreak = 0;
      }
      scoreboard[user].lastOverallUpdate = todayStr;
    }
    
    // ---- Birthday Clean Day Streak ----
    if (scoreboard[user].lastBirthdayUpdate !== todayStr) {
      const birthdayClean = await isBirthdayCleanForUser(user);
      if (birthdayClean) {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split("T")[0];
        
        if (scoreboard[user].lastBirthdayUpdate === yesterdayStr) {
          scoreboard[user].birthdayStreak += 1;
        } else {
          scoreboard[user].birthdayStreak = 1;
        }
        scoreboard[user].birthdayCleanDays = (scoreboard[user].birthdayCleanDays || 0) + 1;
      } else {
        scoreboard[user].birthdayStreak = 0;
      }
      scoreboard[user].lastBirthdayUpdate = todayStr;
    }
  }
  
  localStorage.setItem("scoreboard", JSON.stringify(scoreboard));
  displayScoreboard(scoreboard);
}

// Updates the DOM element with id="scoreboard" to show each user's stats.
function displayScoreboard(scoreboard) {
  const scoreboardEl = document.getElementById("scoreboard");
  if (!scoreboardEl) return;
  
  let html = "";
  for (const user in scoreboard) {
    const {
      totalCleanDays,
      overallStreak,
      birthdayCleanDays,
      birthdayStreak
    } = scoreboard[user];
    html += `<div class="scoreboard-user">
      <strong>${user}</strong><br>
      Overall Clean Days: ${totalCleanDays}<br>
      Overall Streak: ${getStreakVisualForScore(overallStreak, 100)} (${overallStreak} days)<br>
      Birthday Clean Days: ${birthdayCleanDays || 0}<br>
      Birthday Streak: ${getStreakVisualForScore(birthdayStreak, 1000)} (${birthdayStreak} days)
    </div>`;
  }
  scoreboardEl.innerHTML = html;
}



//////////////////////////////////////////////////
// Navigation / Reorder Columns / View All
//////////////////////////////////////////////////
function reorderColumns(selectedType) {
  // Assume your HTML has a container with id "columns-container" for the 4-column view,
  // and a container with id "all-tasks-view" for the combined view.
  const columnsContainer = document.getElementById("columns-container");
  const allView = document.getElementById("all-tasks-view");
  if (selectedType === "all") {
    columnsContainer.style.display = "none";
    allView.style.display = "block";
    renderViewAll();
  } else {
    columnsContainer.style.display = "flex";
    allView.style.display = "none";
    // Rearrange columns according to selected type.
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
function filterTasksByUser(tasks) {
  const currentUser = localStorage.getItem("currentUser");
  if (currentUser === "All") return tasks;
  return tasks.filter(task => task.owner === currentUser || task.owner === "All");
}
function renderAllTasks() {
  renderRepeatingTasks();
  renderContactTasks();
  renderTodos();
  renderBirthdays();
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
// Streak Visual Function
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
  const modal = document.getElementById("edit-modal");
  const titleEl = document.getElementById("edit-modal-title");
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
  if (type === "repeating") {
    titleEl.textContent = "Edit Repeating Task";
    fieldsDiv.appendChild(createField("Last Completed Date:", "date", formatDateForInput(task.lastCompleted), "edit-date"));
    fieldsDiv.appendChild(createField("Frequency (days):", "number", task.frequency, "edit-frequency"));
  } else if (type === "contact") {
    titleEl.textContent = "Edit Keep in Touch Task";
    fieldsDiv.appendChild(createField("Last Contact Date:", "date", formatDateForInput(task.lastContact), "edit-date"));
    fieldsDiv.appendChild(createField("Frequency (days):", "number", task.frequency, "edit-frequency"));
  } else if (type === "todo") {
    titleEl.textContent = "Edit One-off Todo";
    fieldsDiv.appendChild(createField("Due Date:", "date", formatDateForInput(task.dueDate), "edit-date"));
  } else if (type === "birthday") {
    titleEl.textContent = "Edit Birthday/Occasion";
    fieldsDiv.appendChild(createField("Occasion Date:", "date", formatDateForInput(task.dueDate), "edit-date"));
  }
  modal.style.display = "flex";
  const form = document.getElementById("edit-form");
  form.onsubmit = function(e) {
    e.preventDefault();
    const newDate = document.getElementById("edit-date").value;
    let newFreq = null;
    if (type === "repeating" || type === "contact") {
      newFreq = document.getElementById("edit-frequency").value;
    }
    callback(newDate, newFreq);
    hideEditModal();
  };
  document.getElementById("edit-cancel-btn").onclick = hideEditModal;
}
function hideEditModal() {
  document.getElementById("edit-modal").style.display = "none";
}

//////////////////////////////////////////////////
// Repeating Tasks
//////////////////////////////////////////////////
async function getRepeatingTasks() {
  let tasks = [];
  const colRef = collection(db, "repeatingTasks");
  const querySnapshot = await getDocs(colRef);
  querySnapshot.forEach(docSnap => {
    let data = docSnap.data();
    data.docId = docSnap.id;
    tasks.push(data);
  });
  return tasks;
}
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
  renderRepeatingTasks();
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
    const dueClass = getDueClass(task.nextDue);
    const taskDiv = document.createElement("div");
    taskDiv.className = "task-item" + dueClass;
    taskDiv.innerHTML = `
      <span><strong>${task.name}</strong> (Every ${task.frequency} days)</span>
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
// Helper function to re-render the current view
function refreshView() {
  const viewAllEl = document.getElementById("all-tasks-view");
  if (viewAllEl.style.display !== "none") {
    renderViewAll();
  } else {
    renderAllTasks();
  }
}
// Repeating Tasks
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
  refreshView(); // update view after completion
}
async function deleteRepeatingTask(docId) {
  await deleteDoc(doc(db, "repeatingTasks", docId));
  refreshView(); // update view after deletion
}
function editRepeatingTask(docId, task) {
  showEditModal(task, "repeating", async function(newDate, newFreq) {
    let newTimestamp = parseLocalDate(newDate).getTime();
    if (!isNaN(newTimestamp)) {
      task.lastCompleted = newTimestamp;
    }
    let freq = parseInt(newFreq);
    if (!isNaN(freq) && freq > 0) {
      task.frequency = freq;
    }
    await updateDoc(doc(db, "repeatingTasks", docId), task);
    renderRepeatingTasks();
  });
}

//////////////////////////////////////////////////
// Keep in Touch Tasks
//////////////////////////////////////////////////
async function getContactTasks() {
  let tasks = [];
  const colRef = collection(db, "contactTasks");
  const querySnapshot = await getDocs(colRef);
  querySnapshot.forEach(docSnap => {
    let data = docSnap.data();
    data.docId = docSnap.id;
    tasks.push(data);
  });
  return tasks;
}
async function addContactTask() {
  const owner = document.getElementById("c-owner").value;
  // Use the same input value for both name and contactName
  const name = document.getElementById("c-contact-name").value;
  const frequency = parseInt(document.getElementById("c-frequency").value);
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const newTask = {
    owner,
    name,              // New field for consistency in View All
    contactName: name, // Also store as contactName for the contacts view
    frequency,
    lastContact: todayMidnight,
    streak: 0,
    type: "contact"
  };
  await addDoc(collection(db, "contactTasks"), newTask);
  document.getElementById("contacts-form").reset();
  updateOwnerDropdowns();
  renderContactTasks();
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
    // For contact tasks, display the name stored in "name"
    taskDiv.innerHTML = `
      <span><strong>${task.contactName}</strong> (Every ${task.frequency} days)</span>
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
// Keep in Touch Tasks
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
  showEditModal(task, "contact", async function(newDate, newFreq) {
    let newTimestamp = parseLocalDate(newDate).getTime();
    if (!isNaN(newTimestamp)) {
      task.lastContact = newTimestamp;
    }
    let freq = parseInt(newFreq);
    if (!isNaN(freq) && freq > 0) {
      task.frequency = freq;
    }
    await updateDoc(doc(db, "contactTasks", docId), task);
    renderContactTasks();
  });
}

//////////////////////////////////////////////////
// One-off Todos
//////////////////////////////////////////////////
async function getTodos() {
  let tasks = [];
  const colRef = collection(db, "todos");
  const querySnapshot = await getDocs(colRef);
  querySnapshot.forEach(docSnap => {
    let data = docSnap.data();
    data.docId = docSnap.id;
    tasks.push(data);
  });
  return tasks;
}
async function addTodo() {
  const owner = document.getElementById("t-owner").value;
  const name = document.getElementById("t-task-name").value;
  const dueDateStr = document.getElementById("t-due-date").value;
  const dueDate = parseLocalDate(dueDateStr).getTime();
  const newTodo = {
    owner,
    name,
    dueDate,
    completed: false,
    created: Date.now(),
    type: "todo"
  };
  await addDoc(collection(db, "todos"), newTodo);
  document.getElementById("todos-form").reset();
  updateOwnerDropdowns();
  renderTodos();
}
async function renderTodos() {
  let tasks = await getTodos();
  let filtered = filterTasksByUser(tasks);
  let uncompleted = filtered.filter(t => !t.completed);
  let completed = filtered.filter(t => t.completed);
  uncompleted = sortByDue(uncompleted, t => t.dueDate);
  completed = sortByDue(completed, t => t.dueDate);
  const list = document.getElementById("todos-list");
  list.innerHTML = "";
  uncompleted.forEach(todo => {
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
    completeBtn.innerText = "Mark Completed";
    completeBtn.addEventListener("click", async function () {
      await markTodoCompleted(todo.docId, todo);
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
  completed.forEach(todo => {
    const taskDiv = document.createElement("div");
    taskDiv.className = "task-item completed";
    taskDiv.innerHTML = `
      <span><strong>${todo.name}</strong></span>
      <small>Due: ${new Date(todo.dueDate).toLocaleDateString()}</small>
      <br>
      <small>Owner: ${todo.owner}</small>`;
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "task-actions";
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
async function markTodoCompleted(docId, task) {
  await updateDoc(doc(db, "todos", docId), { completed: true });
  refreshView();
}

async function deleteTodo(docId) {
  await deleteDoc(doc(db, "todos", docId));
  refreshView();
}
function editTodo(docId, task) {
  showEditModal(task, "todo", async function(newDate) {
    let newTimestamp = parseLocalDate(newDate).getTime();
    if (!isNaN(newTimestamp)) {
      task.dueDate = newTimestamp;
    }
    await updateDoc(doc(db, "todos", docId), task);
    renderTodos();
  });
}

//////////////////////////////////////////////////
// Birthdays/Occasions
//////////////////////////////////////////////////
async function getBirthdays() {
  let tasks = [];
  const colRef = collection(db, "birthdays");
  const querySnapshot = await getDocs(colRef);
  querySnapshot.forEach(docSnap => {
    let data = docSnap.data();
    data.docId = docSnap.id;
    tasks.push(data);
  });
  return tasks;
}
async function addBirthday() {
  const owner = document.getElementById("b-owner").value;
  const name = document.getElementById("b-task-name").value;
  const dateStr = document.getElementById("b-date").value;
  // Store the birthday exactly as entered (do not adjust to next year)
  const dueDate = parseLocalDate(dateStr).getTime();
  const newTask = {
    owner,
    name,
    dueDate, // use the entered date directly
    completed: false,
    created: Date.now(),
    type: "birthday",
    streak: 0  // <--- add this line
  };
  await addDoc(collection(db, "birthdays"), newTask);
  document.getElementById("birthdays-form").reset();
  updateOwnerDropdowns();
  renderBirthdays();
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
  // Increment birthday streak
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
  showEditModal(task, "birthday", async function(newDate) {
    // Update with the entered date without adjusting to next year
    let newDue = parseLocalDate(newDate).getTime();
    task.dueDate = newDue;
    await updateDoc(doc(db, "birthdays", docId), task);
    renderBirthdays();
  });
}

//////////////////////////////////////////////////
// Helper: Compute Next Occurrence for Birthdays
//////////////////////////////////////////////////
function getNextOccurrence(dateInput) {
  const inputDate = new Date(dateInput);
  const month = inputDate.getMonth();
  const day = inputDate.getDate();
  const now = new Date();
  let year = now.getFullYear();
  let nextOccurrence = new Date(year, month, day).getTime();
  if (nextOccurrence < now.getTime()) {
    nextOccurrence = new Date(year + 1, month, day).getTime();
  }
  return nextOccurrence;
}

//////////////////////////////////////////////////
// View All Functionality
//////////////////////////////////////////////////
async function renderViewAll() {
  let [repeating, contact, todos, birthdays] = await Promise.all([
    getRepeatingTasks(),
    getContactTasks(),
    getTodos(),
    getBirthdays()
  ]);
  
  // Filter tasks by current user (or "All")
  repeating = filterTasksByUser(repeating);
  contact = filterTasksByUser(contact);
  todos = filterTasksByUser(todos).filter(todo => !todo.completed);
  birthdays = filterTasksByUser(birthdays);

  // For repeating and contact tasks, compute nextDue, set display names, and assign type.
  repeating.forEach(task => {
    task.nextDue = task.lastCompleted + task.frequency * 24 * 60 * 60 * 1000;
    task.displayName = task.name || "No Name";
    task.type = "repeating"; // assign type manually
  });
  contact.forEach(task => {
    task.nextDue = task.lastContact + task.frequency * 24 * 60 * 60 * 1000;
    task.displayName = task.contactName || task.contactName || "No Name";
    task.type = "contact"; // assign type manually
  });
  todos.forEach(task => {
    task.displayName = task.name || "No Name";
    task.type = "todo"; // assign type manually
  });
  birthdays.forEach(task => {
    task.displayName = task.name || "No Name";
    task.type = "birthday"; // assign type manually
  });

  let allTasks = [...repeating, ...contact, ...todos, ...birthdays];
  allTasks = sortByDue(allTasks, task => task.nextDue || task.dueDate);
  const container = document.getElementById("all-tasks-view");
  container.innerHTML = "";
  // Clear global task cache.
  window.taskCache = {};
  allTasks.forEach(task => {
    window.taskCache[task.docId] = task;
    let categoryLabel = "";
    if (task.type === "repeating") {
      categoryLabel = "Repeating";
    } else if (task.type === "contact") {
      categoryLabel = "Keep in Touch";
    } else if (task.type === "todo") {
      categoryLabel = "One-off Todo";
    } else if (task.type === "birthday") {
      categoryLabel = "Birthday/Occasion";
    } else {
      categoryLabel = "Unknown";
    }
    // Apply color scheme: compute the due class (e.g., " overdue", " due-today", etc.)
    const dueClass = getDueClass(task.nextDue || task.dueDate);
    
    const div = document.createElement("div");
    div.className = "task-item" + dueClass;
    div.innerHTML = `
      <span><strong>${task.displayName}</strong> [${categoryLabel}]</span>
      <small>Due: ${new Date(task.nextDue || task.dueDate).toLocaleDateString()} | Owner: ${task.owner}</small>
      <div class="streak-visual">${(task.streak !== undefined) ? getStreakVisual(task.streak) : ""}</div>
      <div class="task-actions">
        ${getViewAllActions(task)}
      </div>
    `;
    container.appendChild(div);
  });
}

function getViewAllActions(task) {
  if (task.type === "repeating") {
    return `
      <button class="complete-btn" onclick="markRepeatingTaskCompleted('${task.docId}', window.taskCache['${task.docId}'])">Completed Today</button>
      <button class="edit-btn" onclick="editRepeatingTask('${task.docId}', window.taskCache['${task.docId}'])">Edit</button>
      <button class="delete-btn" onclick="deleteRepeatingTask('${task.docId}')">Delete</button>`;
  } else if (task.type === "contact") {
    return `
      <button class="complete-btn" onclick="markContactTask('${task.docId}', window.taskCache['${task.docId}'])">Completed Today</button>
      <button class="edit-btn" onclick="editContactTask('${task.docId}', window.taskCache['${task.docId}'])">Edit</button>
      <button class="delete-btn" onclick="deleteContactTask('${task.docId}')">Delete</button>`;
  } else if (task.type === "todo") {
    return `
      <button class="complete-btn" onclick="markTodoCompleted('${task.docId}', window.taskCache['${task.docId}'])">Mark Completed</button>
      <button class="edit-btn" onclick="editTodo('${task.docId}', window.taskCache['${task.docId}'])">Edit</button>
      <button class="delete-btn" onclick="deleteTodo('${task.docId}')">Delete</button>`;
  } else if (task.type === "birthday") {
    return `
      <button class="complete-btn" onclick="markBirthdayCompleted('${task.docId}', window.taskCache['${task.docId}'])">Completed</button>
      <button class="edit-btn" onclick="editBirthday('${task.docId}', window.taskCache['${task.docId}'])">Edit</button>
      <button class="delete-btn" onclick="deleteBirthday('${task.docId}')">Delete</button>`;
  } else {
    return "";
  }
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
window.markTodoCompleted = markTodoCompleted;
window.editTodo = editTodo;
window.deleteTodo = deleteTodo;
window.markBirthdayCompleted = markBirthdayCompleted;
window.editBirthday = editBirthday;
window.deleteBirthday = deleteBirthday;
