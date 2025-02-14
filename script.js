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

//////////////////////////////////////////////
// Utility Functions
//////////////////////////////////////////////

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

function formatDateForInput(timestamp) {
  const d = new Date(timestamp);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split("T")[0];
}

function parseLocalDate(dateString) {
  const parts = dateString.split("-");
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function getStreakVisual(streak) {
  const effective = Math.min(streak, 100);
  let stars = Math.floor(effective / 10);
  let checks = effective % 10;
  let visual = "";
  if (stars > 0) {
    for (let i = 0; i < stars; i++) visual += "⭐";
    visual += "<br>";
  }
  if (checks > 0) {
    for (let i = 0; i < checks; i++) visual += "✅";
  }
  return visual;
}

//////////////////////////////////////////////
// User Management Functions
//////////////////////////////////////////////

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

function addUser(newUser) {
  let users = JSON.parse(localStorage.getItem("users"));
  if (!users.includes(newUser)) {
    users.push(newUser);
    localStorage.setItem("users", JSON.stringify(users));
  }
}

//////////////////////////////////////////////
// Data Functions for Each Category
//////////////////////////////////////////////

// Repeating Tasks
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
  const newTask = { owner, name, frequency, lastCompleted: todayMidnight, streak: 0, type: "repeating" };
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
    completeBtn.addEventListener("click", async () => {
      await markRepeatingTaskCompleted(task.docId, task);
    });
    actionsDiv.appendChild(completeBtn);
    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.innerText = "Edit";
    editBtn.addEventListener("click", () => {
      editRepeatingTask(task.docId, task);
    });
    actionsDiv.appendChild(editBtn);
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerText = "Delete";
    deleteBtn.addEventListener("click", async () => {
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
  task.streak = now - prevDue <= gracePeriod ? (task.streak || 0) + 1 : 0;
  task.lastCompleted = now;
  await updateDoc(doc(db, "repeatingTasks", docId), task);
  renderRepeatingTasks();
}

async function deleteRepeatingTask(docId) {
  await deleteDoc(doc(db, "repeatingTasks", docId));
  renderRepeatingTasks();
}

function editRepeatingTask(docId, task) {
  showEditModal(task, "repeating", async (newDate, newFreq) => {
    let newTimestamp = parseLocalDate(newDate).getTime();
    if (!isNaN(newTimestamp)) task.lastCompleted = newTimestamp;
    let freq = parseInt(newFreq);
    if (!isNaN(freq) && freq > 0) task.frequency = freq;
    await updateDoc(doc(db, "repeatingTasks", docId), task);
    renderRepeatingTasks();
  });
}

// Keep in Touch Tasks
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
  const contactName = document.getElementById("c-contact-name").value;
  const frequency = parseInt(document.getElementById("c-frequency").value);
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const newTask = { owner, contactName, frequency, lastContact: todayMidnight, streak: 0, type: "contact" };
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
    // Use contactName for display
    taskDiv.innerHTML = `
      <span><strong>${task.contactName || task.name}</strong> (Every ${task.frequency} days)</span>
      <small>Next contact: ${new Date(task.nextDue).toLocaleDateString()}</small>
      <div class="streak-visual">${getStreakVisual(task.streak)}</div>
      <small>Owner: ${task.owner}</small>`;
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "task-actions";
    const completeBtn = document.createElement("button");
    completeBtn.className = "complete-btn";
    completeBtn.innerText = "Completed Today";
    completeBtn.addEventListener("click", async () => {
      await markContactTask(task.docId, task);
    });
    actionsDiv.appendChild(completeBtn);
    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.innerText = "Edit";
    editBtn.addEventListener("click", () => {
      editContactTask(task.docId, task);
    });
    actionsDiv.appendChild(editBtn);
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerText = "Delete";
    deleteBtn.addEventListener("click", async () => {
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
  task.streak = now - prevDue <= gracePeriod ? (task.streak || 0) + 1 : 0;
  task.lastContact = now;
  await updateDoc(doc(db, "contactTasks", docId), task);
  renderContactTasks();
}

async function deleteContactTask(docId) {
  await deleteDoc(doc(db, "contactTasks", docId));
  renderContactTasks();
}

function editContactTask(docId, task) {
  showEditModal(task, "contact", async (newDate, newFreq) => {
    let newTimestamp = parseLocalDate(newDate).getTime();
    if (!isNaN(newTimestamp)) task.lastContact = newTimestamp;
    let freq = parseInt(newFreq);
    if (!isNaN(freq) && freq > 0) task.frequency = freq;
    await updateDoc(doc(db, "contactTasks", docId), task);
    renderContactTasks();
  });
}

// One-off Todos
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
  const newTodo = { owner, name, dueDate, completed: false, created: Date.now(), type: "todo" };
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
      <small>Due: ${new Date(todo.dueDate).toLocaleDateString()} | Owner: ${todo.owner}</small>`;
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "task-actions";
    const completeBtn = document.createElement("button");
    completeBtn.className = "complete-btn";
    completeBtn.innerText = "Mark Completed";
    completeBtn.addEventListener("click", async () => {
      await markTodoCompleted(todo.docId, todo);
    });
    actionsDiv.appendChild(completeBtn);
    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.innerText = "Edit";
    editBtn.addEventListener("click", () => {
      editTodo(todo.docId, todo);
    });
    actionsDiv.appendChild(editBtn);
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerText = "Delete";
    deleteBtn.addEventListener("click", async () => {
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
      <small>Due: ${new Date(todo.dueDate).toLocaleDateString()} | Owner: ${todo.owner}</small>`;
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "task-actions";
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerText = "Delete";
    deleteBtn.addEventListener("click", async () => {
      await deleteTodo(todo.docId);
    });
    actionsDiv.appendChild(deleteBtn);
    taskDiv.appendChild(actionsDiv);
    list.appendChild(taskDiv);
  });
}

async function markTodoCompleted(docId, task) {
  await updateDoc(doc(db, "todos", docId), { completed: true });
  renderTodos();
}

async function deleteTodo(docId) {
  await deleteDoc(doc(db, "todos", docId));
  renderTodos();
}

function editTodo(docId, task) {
  showEditModal(task, "todo", async (newDate) => {
    let newTimestamp = parseLocalDate(newDate).getTime();
    if (!isNaN(newTimestamp)) task.dueDate = newTimestamp;
    await updateDoc(doc(db, "todos", docId), task);
    renderTodos();
  });
}

// Birthdays/Occasions
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
  const dueDate = parseLocalDate(dateStr).getTime();
  const nextOccurrence = getNextOccurrence(dueDate);
  const newTask = { owner, name, dueDate: nextOccurrence, completed: false, created: Date.now(), type: "birthday" };
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
      <small>Next Occurrence: ${new Date(task.dueDate).toLocaleDateString()} | Owner: ${task.owner}</small>`;
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "task-actions";
    const completeBtn = document.createElement("button");
    completeBtn.className = "complete-btn";
    completeBtn.innerText = "Completed";
    completeBtn.addEventListener("click", async () => {
      await markBirthdayCompleted(task.docId, task);
    });
    actionsDiv.appendChild(completeBtn);
    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.innerText = "Edit";
    editBtn.addEventListener("click", () => {
      editBirthday(task.docId, task);
    });
    actionsDiv.appendChild(editBtn);
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerText = "Delete";
    deleteBtn.addEventListener("click", async () => {
      await deleteBirthday(task.docId);
    });
    actionsDiv.appendChild(deleteBtn);
    taskDiv.appendChild(actionsDiv);
    list.appendChild(taskDiv);
  });
}

async function markBirthdayCompleted(docId, task) {
  const dueDate = new Date(task.dueDate);
  const nextYear = dueDate.getFullYear() + 1;
  const newDue = new Date(nextYear, dueDate.getMonth(), dueDate.getDate()).getTime();
  task.dueDate = newDue;
  await updateDoc(doc(db, "birthdays", docId), task);
  renderBirthdays();
}

async function deleteBirthday(docId) {
  await deleteDoc(doc(db, "birthdays", docId));
  renderBirthdays();
}

function editBirthday(docId, task) {
  showEditModal(task, "birthday", async (newDate) => {
    let newDue = getNextOccurrence(newDate);
    task.dueDate = newDue;
    await updateDoc(doc(db, "birthdays", docId), task);
    renderBirthdays();
  });
}

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

//////////////////////////////////////////////
// View All Functionality
//////////////////////////////////////////////
async function renderViewAll() {
  // Get tasks from all collections and filter by current user
  let [repeating, contact, todos, birthdays] = await Promise.all([
    getRepeatingTasks(),
    getContactTasks(),
    getTodos(),
    getBirthdays()
  ]);
  // Compute nextDue and assign displayName where needed
  repeating.forEach(task => {
    task.nextDue = task.lastCompleted + task.frequency * 24 * 60 * 60 * 1000;
    task.displayName = task.name;
  });
  contact.forEach(task => {
    task.nextDue = task.lastContact + task.frequency * 24 * 60 * 60 * 1000;
    task.displayName = task.contactName || task.name;
  });
  todos.forEach(task => { task.displayName = task.name; });
  birthdays.forEach(task => { task.displayName = task.name; });
  
  // Ensure task types are set (if missing)
  repeating.forEach(task => { task.type = task.type || "repeating"; });
  contact.forEach(task => { task.type = task.type || "contact"; });
  todos.forEach(task => { task.type = task.type || "todo"; });
  birthdays.forEach(task => { task.type = task.type || "birthday"; });
  
  let allTasks = [...repeating, ...contact, ...todos, ...birthdays];
  // Filter by current user (if not "All")
  allTasks = filterTasksByUser(allTasks);
  allTasks = sortByDue(allTasks, task => task.nextDue || task.dueDate);
  const container = document.getElementById("all-tasks-view");
  container.innerHTML = "";
  window.taskCache = {};
  allTasks.forEach(task => {
    window.taskCache[task.docId] = task;
    let categoryLabel = "";
    switch(task.type) {
      case "repeating": categoryLabel = "Repeating"; break;
      case "contact": categoryLabel = "Keep in Touch"; break;
      case "todo": categoryLabel = "One-off Todo"; break;
      case "birthday": categoryLabel = "Birthday/Occasion"; break;
      default: categoryLabel = "Unknown";
    }
    const div = document.createElement("div");
    div.className = "task-item";
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
      <button class="complete-btn" onclick="window.markRepeatingTaskCompleted('${task.docId}', window.taskCache['${task.docId}'])">Completed Today</button>
      <button class="edit-btn" onclick="window.editRepeatingTask('${task.docId}', window.taskCache['${task.docId}'])">Edit</button>
      <button class="delete-btn" onclick="window.deleteRepeatingTask('${task.docId}')">Delete</button>`;
  } else if (task.type === "contact") {
    return `
      <button class="complete-btn" onclick="window.markContactTask('${task.docId}', window.taskCache['${task.docId}'])">Completed Today</button>
      <button class="edit-btn" onclick="window.editContactTask('${task.docId}', window.taskCache['${task.docId}'])">Edit</button>
      <button class="delete-btn" onclick="window.deleteContactTask('${task.docId}')">Delete</button>`;
  } else if (task.type === "todo") {
    return `
      <button class="complete-btn" onclick="window.markTodoCompleted('${task.docId}', window.taskCache['${task.docId}'])">Mark Completed</button>
      <button class="edit-btn" onclick="window.editTodo('${task.docId}', window.taskCache['${task.docId}'])">Edit</button>
      <button class="delete-btn" onclick="window.deleteTodo('${task.docId}')">Delete</button>`;
  } else if (task.type === "birthday") {
    return `
      <button class="complete-btn" onclick="window.markBirthdayCompleted('${task.docId}', window.taskCache['${task.docId}'])">Completed</button>
      <button class="edit-btn" onclick="window.editBirthday('${task.docId}', window.taskCache['${task.docId}'])">Edit</button>
      <button class="delete-btn" onclick="window.deleteBirthday('${task.docId}')">Delete</button>`;
  } else {
    return "";
  }
}

//////////////////////////////////////////////
// Expose Functions for Inline Handlers
//////////////////////////////////////////////
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
