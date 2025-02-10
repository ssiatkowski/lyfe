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

// Initialize Firebase and Firestore
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

//////////////////////////////////////////////////
// DOM Ready
//////////////////////////////////////////////////
document.addEventListener("DOMContentLoaded", function () {
  // --- Initialize Users & Current User ---
  if (!localStorage.getItem("users")) {
    localStorage.setItem("users", JSON.stringify(["Sebo", "Alomi"]));
  }
  // Set default current user to "Alomi" (instead of "All")
  if (!localStorage.getItem("currentUser")) {
    localStorage.setItem("currentUser", "Alomi");
  }

  updateUserDropdowns();
  document.getElementById("user-select").value = localStorage.getItem("currentUser");

  document.getElementById("user-select").addEventListener("change", function () {
    localStorage.setItem("currentUser", this.value);
    renderAllTasks();
  });

  // --- Navigation Bar Handlers ---
  document.querySelectorAll("#nav-bar button").forEach(button => {
    button.addEventListener("click", function () {
      document.querySelectorAll("#nav-bar button").forEach(btn => btn.classList.remove("active"));
      this.classList.add("active");
      const selectedType = this.getAttribute("data-type");
      reorderColumns(selectedType);
    });
  });

  // --- Form Handlers ---
  document.getElementById("repeating-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    await addRepeatingTask();
  });
  document.getElementById("contacts-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    await addContactTask();
  });
  document.getElementById("todos-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    await addTodo();
  });

  // --- Initial Render ---
  renderAllTasks();
  setInterval(renderAllTasks, 60000);
});

//////////////////////////////////////////////////
// Navigation: Reorder Columns Based on Selection
//////////////////////////////////////////////////
function reorderColumns(selectedType) {
  const container = document.querySelector(".columns");
  const repeating = document.getElementById("repeating-column");
  const contacts = document.getElementById("contacts-column");
  const todos = document.getElementById("todos-column");
  container.innerHTML = "";
  let order = [];
  if (selectedType === "repeating") {
    order = [repeating, contacts, todos];
  } else if (selectedType === "contact") {
    order = [contacts, repeating, todos];
  } else if (selectedType === "todos") {
    order = [todos, repeating, contacts];
  } else {
    order = [repeating, contacts, todos];
  }
  order.forEach(col => container.appendChild(col));
}

//////////////////////////////////////////////////
// User Management Functions
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
  ["r-owner", "c-owner", "t-owner"].forEach(id => {
    const select = document.getElementById(id);
    select.innerHTML = "";
    options.forEach(user => {
      const opt = document.createElement("option");
      opt.value = user;
      opt.textContent = user;
      select.appendChild(opt);
    });
    // Set default owner to "Alomi"
    select.value = "Alomi";
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
  if (diffDays < 0) {
    return " overdue";
  } else if (diffDays === 0) {
    return " due-today";
  } else if (diffDays <= 2) {
    return " almost-due";
  } else if (diffDays <= 4) {
    return " due-soon";
  }
  return "";
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
}

//////////////////////////////////////////////////
// Date Parsing Helpers
//////////////////////////////////////////////////
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
  const effective = Math.min(streak, 110);
  let stars = Math.floor(effective / 10);
  let checks = effective % 10;
  // Cap stars at 10.
  stars = Math.min(stars, 10);
  let visual = "";
  if (stars > 0) {
    // Display stars in one row.
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
    titleEl.textContent = "Edit Keep In Touch Task";
    fieldsDiv.appendChild(createField("Last Contact Date:", "date", formatDateForInput(task.lastContact), "edit-date"));
    fieldsDiv.appendChild(createField("Frequency (days):", "number", task.frequency, "edit-frequency"));
  } else if (type === "todo") {
    titleEl.textContent = "Edit One-off Task";
    fieldsDiv.appendChild(createField("Due Date:", "date", formatDateForInput(task.dueDate), "edit-date"));
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
  };
  await addDoc(collection(db, "repeatingTasks"), newTask);
  document.getElementById("repeating-form").reset();
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
  renderRepeatingTasks();
}
async function deleteRepeatingTask(docId) {
  await deleteDoc(doc(db, "repeatingTasks", docId));
  renderRepeatingTasks();
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
  const contactName = document.getElementById("c-contact-name").value;
  const frequency = parseInt(document.getElementById("c-frequency").value);
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const newTask = {
    owner,
    contactName,
    frequency,
    lastContact: todayMidnight,
    streak: 0,
  };
  await addDoc(collection(db, "contactTasks"), newTask);
  document.getElementById("contacts-form").reset();
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
  renderContactTasks();
}
async function deleteContactTask(docId) {
  await deleteDoc(doc(db, "contactTasks", docId));
  renderContactTasks();
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
  };
  await addDoc(collection(db, "todos"), newTodo);
  document.getElementById("todos-form").reset();
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
    // Insert an explicit <br> between due date and owner.
    taskDiv.innerHTML = `
      <span><strong>${todo.name}</strong></span>
      <small>Due: ${new Date(todo.dueDate).toLocaleDateString()}</small>
      <br>
      <small>Owner: ${todo.owner}</small>`;
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "task-actions";
    const completeBtn = document.createElement("button");
    completeBtn.className = "complete-btn";
    completeBtn.innerText = "Mark as Completed";
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
  renderTodos();
}
async function deleteTodo(docId) {
  await deleteDoc(doc(db, "todos", docId));
  renderTodos();
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
