import { getApps, getApp } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  doc,
  runTransaction
} from "https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js";

const ONE_DAY = 24 * 60 * 60 * 1000;
const app = getApps().length ? getApp() : null;
const db = app ? getFirestore(app) : null;

const AREA_ICON_BY_LABEL = {
  "No area": "?",
  "Home": "H",
  "Health & Fitness": "+",
  "Money & Finance": "$",
  "Work & Career": "W",
  "Family": "F",
  "Friends & Social": "S",
  "Personal Admin": "A",
  "Errands": "E",
  "Car & Transportation": "C",
  "Learning & Growth": "L",
  "Travel": "T",
  "Other": "*",
  "Friends": "Fr",
  "Colleagues": "Co"
};

const PRIORITY_VALUE_BY_LABEL = {
  "Critical — must not slip": "critical",
  "Important — should happen soon": "important",
  "Routine — keep on track": "routine",
  "Flexible — can wait": "flexible",
  "Someday — no pressure": "someday"
};

let pendingEditDetails = null;

function priorityFromCard(card) {
  for (const value of ["critical", "important", "routine", "flexible", "someday"]) {
    if (card.classList.contains(`priority-${value}`)) return value;
  }
  return "routine";
}

function applyPrioritySelectStyle(select) {
  if (!select) return;
  select.classList.add("priority-select");
  ["critical", "important", "routine", "flexible", "someday"].forEach(value => {
    select.classList.remove(`priority-select-${value}`);
  });
  const value = select.value || "routine";
  select.classList.add(`priority-select-${value}`);
  Array.from(select.options).forEach(option => {
    const optionValue = option.value || "routine";
    option.dataset.priority = optionValue;
  });
}

function wirePrioritySelect(select) {
  if (!select || select.dataset.priorityWired === "1") return;
  select.dataset.priorityWired = "1";
  applyPrioritySelectStyle(select);
  select.addEventListener("change", () => applyPrioritySelectStyle(select));
}

function extractOwner(card) {
  const ownerLine = Array.from(card.querySelectorAll("small")).find(el => el.textContent.trim().startsWith("Owner:"));
  if (!ownerLine) return card.dataset.owner || "";
  const owner = ownerLine.textContent.replace(/^Owner:\s*/i, "").trim();
  card.dataset.owner = owner;
  ownerLine.remove();
  return owner;
}

function extractArea(card) {
  const areaChip = card.querySelector(".area-chip");
  const label = areaChip?.textContent.trim() || card.dataset.areaLabel || "No area";
  card.dataset.areaLabel = label;
  return label;
}

function extractEffort(card) {
  const effort = card.querySelector(".effort-chip")?.textContent.trim() || "";
  if (effort) card.dataset.effortLabel = effort;
  return effort;
}

function areaIconElement(areaLabel) {
  const icon = document.createElement("span");
  icon.className = "area-ascii-icon" + (areaLabel === "No area" ? " missing-area-icon" : "");
  icon.textContent = AREA_ICON_BY_LABEL[areaLabel] || "*";
  icon.title = areaLabel;
  icon.setAttribute("aria-label", `Area: ${areaLabel}`);
  return icon;
}

function ensureTaskFooter(card, areaLabel) {
  if (card.querySelector(":scope > .task-card-footer")) return;
  const actions = card.querySelector(":scope > .task-actions");
  if (!actions) return;
  const footer = document.createElement("div");
  footer.className = "task-card-footer";
  actions.replaceWith(footer);
  footer.append(actions, areaIconElement(areaLabel));
}

function processTaskCard(card) {
  if (!(card instanceof HTMLElement) || !card.classList.contains("task-item") || card.dataset.compactEnhanced === "1") return;

  const areaLabel = extractArea(card);
  const effortLabel = extractEffort(card);
  const owner = extractOwner(card);
  const name = card.querySelector("span strong")?.textContent.trim() || "";
  const dueLine = Array.from(card.querySelectorAll("small")).find(el => /^(Due:|Next due:|Next contact:|Next occurrence:)/i.test(el.textContent.trim()));

  card.dataset.taskName = name;
  card.dataset.priority = priorityFromCard(card);
  card.dataset.dueLabel = dueLine?.textContent.replace(/^[^:]+:\s*/i, "").trim() || "";
  card.dataset.owner = owner;
  card.dataset.areaLabel = areaLabel;
  card.dataset.effortLabel = effortLabel;

  card.querySelector(".task-meta")?.remove();

  card.querySelectorAll(".complete-btn").forEach(button => {
    button.textContent = "Complete";
  });

  const editButton = card.querySelector(".edit-btn");
  editButton?.addEventListener("click", () => {
    pendingEditDetails = {
      owner: card.dataset.owner || "",
      areaLabel: card.dataset.areaLabel || "No area",
      priority: card.dataset.priority || "routine",
      effortLabel: card.dataset.effortLabel || ""
    };
  });

  ensureTaskFooter(card, areaLabel);
  card.dataset.compactEnhanced = "1";
}

function processAllTaskCards(root = document) {
  root.querySelectorAll?.(".task-item").forEach(processTaskCard);
}

function decorateEditModal() {
  const modal = document.getElementById("edit-modal");
  if (!modal || modal.style.display === "none") return;

  const priority = modal.querySelector("#edit-priority");
  wirePrioritySelect(priority);

  const fields = modal.querySelector("#edit-fields");
  if (!fields || fields.querySelector(".edit-readonly-detail")) return;
  if (!pendingEditDetails?.owner) return;

  const detail = document.createElement("div");
  detail.className = "edit-readonly-detail";
  detail.innerHTML = `<strong>Owner:</strong> ${escapeHtml(pendingEditDetails.owner)}`;
  fields.appendChild(detail);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]);
}

function hideEditModalWithoutSaving() {
  const modal = document.getElementById("edit-modal");
  if (modal) modal.style.display = "none";
  pendingEditDetails = null;
}

function setupEditModalDismissal() {
  const modal = document.getElementById("edit-modal");
  if (!modal || modal.dataset.outsideDismissWired === "1") return;
  modal.dataset.outsideDismissWired = "1";
  modal.addEventListener("click", event => {
    if (event.target === modal) hideEditModalWithoutSaving();
  });
}

function todoCardIdentity(card) {
  return {
    name: card.dataset.taskName || card.querySelector("span strong")?.textContent.trim() || "",
    owner: card.dataset.owner || "",
    dueLabel: card.dataset.dueLabel || "",
    priority: card.dataset.priority || "routine",
    areaLabel: card.dataset.areaLabel || "No area"
  };
}

function todoMatchesCard(data, identity) {
  if ((data.name || "").trim() !== identity.name) return false;
  if ((data.owner || "") !== identity.owner) return false;
  if (new Date(data.dueDate).toLocaleDateString() !== identity.dueLabel) return false;
  return true;
}

async function archiveAndCompleteTodo(card, button) {
  if (!db) throw new Error("Firebase is not initialized");
  const identity = todoCardIdentity(card);
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Completing…";

  try {
    const snap = await getDocs(collection(db, "todos"));
    let matches = snap.docs.filter(docSnap => todoMatchesCard(docSnap.data(), identity));

    if (matches.length > 1) {
      matches = matches.filter(docSnap => {
        const data = docSnap.data();
        const priority = data.priority || "routine";
        const areaLabel = data.area ? card.dataset.areaLabel : "No area";
        return priority === identity.priority && areaLabel === identity.areaLabel;
      });
    }

    if (matches.length !== 1) {
      throw new Error(matches.length ? "Multiple matching todos found; open Edit and make this task name or due date unique first." : "Could not identify this todo safely.");
    }

    const source = matches[0];
    const data = source.data();
    const completedAt = Date.now();
    const archiveRef = doc(collection(db, "completedTodos"));

    await runTransaction(db, async transaction => {
      transaction.set(archiveRef, {
        originalTaskId: source.id,
        type: "todo",
        name: data.name || identity.name,
        owner: data.owner || identity.owner,
        dueDate: data.dueDate,
        created: data.created || null,
        area: data.area || null,
        priority: data.priority || "routine",
        estimatedMinutes: data.estimatedMinutes || null,
        completedAt
      });
      transaction.delete(source.ref);
    });
  } finally {
    button.disabled = false;
    button.textContent = originalText || "Complete";
  }
}

function setupTodoCompletionCapture() {
  document.addEventListener("click", event => {
    const button = event.target.closest?.("#todos-list .complete-btn");
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const card = button.closest(".task-item");
    if (!card) return;

    archiveAndCompleteTodo(card, button).catch(err => {
      console.error("Unable to archive completed todo", err);
      alert(err?.message || "Could not complete this todo. Please try again.");
    });
  }, true);
}

function currentUserIncludes(owner) {
  const current = localStorage.getItem("currentUser");
  return current === "All" || owner === current || owner === "All";
}

function formatEffort(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 60) return `${n} min`;
  if (n === 60) return "1 hr";
  if (n % 60 === 0) return `${n / 60} hrs`;
  return `${Math.floor(n / 60)}h ${n % 60}m`;
}

function areaLabelFromStoredValue(value) {
  const map = {
    home: "Home",
    health_fitness: "Health & Fitness",
    money_finance: "Money & Finance",
    work_career: "Work & Career",
    family: "Family",
    friends_social: "Friends & Social",
    personal_admin: "Personal Admin",
    errands: "Errands",
    car_transport: "Car & Transportation",
    learning_growth: "Learning & Growth",
    travel: "Travel",
    other: "Other"
  };
  return map[value] || "No area";
}

async function loadCompletedTodos() {
  if (!db) return;
  const status = document.getElementById("completed-todos-status");
  const list = document.getElementById("completed-todos-list");
  if (!status || !list) return;

  status.textContent = "Loading completed todos…";
  list.innerHTML = "";
  try {
    const cutoff = Date.now() - 365 * ONE_DAY;
    const snap = await getDocs(query(collection(db, "completedTodos"), where("completedAt", ">=", cutoff)));
    const items = snap.docs
      .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
      .filter(item => currentUserIncludes(item.owner))
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

    status.textContent = items.length
      ? `${items.length} completed todo${items.length === 1 ? "" : "s"} from the last year.`
      : "No archived completed todos from the last year yet. History begins with completions made after this feature was added.";

    items.forEach(item => {
      const areaLabel = areaLabelFromStoredValue(item.area);
      const row = document.createElement("div");
      row.className = "completed-todo-item";
      const effort = formatEffort(item.estimatedMinutes);
      row.innerHTML = `
        <strong>${escapeHtml(item.name || "Untitled todo")}</strong>
        <small>Completed: ${escapeHtml(new Date(item.completedAt).toLocaleDateString())}</small>
        <small>Originally due: ${escapeHtml(new Date(item.dueDate).toLocaleDateString())}</small>
        <div class="completed-todo-meta">
          <small>${escapeHtml(item.owner || "")}${effort ? ` · ${escapeHtml(effort)}` : ""}</small>
        </div>`;
      row.querySelector(".completed-todo-meta")?.appendChild(areaIconElement(areaLabel));
      list.appendChild(row);
    });
  } catch (err) {
    console.error("Unable to load completed todos", err);
    status.textContent = "Could not load completed todo history.";
  }
}

function setupCompletedTodosModal() {
  const modal = document.getElementById("completed-todos-modal");
  const openButton = document.getElementById("completed-todos-btn");
  const closeButton = document.getElementById("completed-todos-close");
  if (!modal || !openButton) return;

  openButton.addEventListener("click", () => {
    modal.style.display = "flex";
    loadCompletedTodos();
  });
  closeButton?.addEventListener("click", () => { modal.style.display = "none"; });
  modal.addEventListener("click", event => {
    if (event.target === modal) modal.style.display = "none";
  });
}

function init() {
  ["r-priority", "t-priority"].forEach(id => wirePrioritySelect(document.getElementById(id)));
  setupEditModalDismissal();
  setupTodoCompletionCapture();
  setupCompletedTodosModal();
  processAllTaskCards();

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach(node => {
          if (!(node instanceof HTMLElement)) return;
          if (node.classList.contains("task-item")) processTaskCard(node);
          processAllTaskCards(node);
          node.querySelectorAll?.(".priority-select, #edit-priority").forEach(wirePrioritySelect);
        });
      }
      if (mutation.type === "attributes" && mutation.target.id === "edit-modal") decorateEditModal();
    }
    decorateEditModal();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    hideEditModalWithoutSaving();
    const completedModal = document.getElementById("completed-todos-modal");
    if (completedModal) completedModal.style.display = "none";
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
