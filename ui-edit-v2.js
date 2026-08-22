const GENERAL_AREAS_V2 = [
  { value: "", label: "No area", icon: "❔" },
  { value: "home", label: "Home", icon: "🏠" },
  { value: "health", label: "Health", icon: "🩺" },
  { value: "fitness", label: "Fitness", icon: "🏋️" },
  { value: "money", label: "Money", icon: "💰" },
  { value: "work", label: "Work", icon: "💼" },
  { value: "family", label: "Family", icon: "❤️" },
  { value: "social", label: "Social", icon: "🫂" },
  { value: "pet", label: "Pet", icon: "🐾" },
  { value: "hobbies", label: "Hobbies", icon: "🎯" },
  { value: "learning", label: "Learning", icon: "📚" },
  { value: "travel", label: "Travel", icon: "✈️" }
];

const RELATIONSHIP_AREAS_V2 = [
  { value: "", label: "No area", icon: "❔" },
  { value: "family", label: "Family", icon: "❤️" },
  { value: "friends", label: "Friends", icon: "🫂" },
  { value: "colleagues", label: "Colleagues", icon: "🤝" }
];

const GENERAL_BY_VALUE = Object.fromEntries(GENERAL_AREAS_V2.map(x => [x.value, x]));
const GENERAL_VALUE_BY_LABEL = Object.fromEntries(GENERAL_AREAS_V2.map(x => [x.label.toLowerCase(), x.value]));
const RELATIONSHIP_BY_VALUE = Object.fromEntries(RELATIONSHIP_AREAS_V2.map(x => [x.value, x]));
const RELATIONSHIP_VALUE_BY_LABEL = Object.fromEntries(RELATIONSHIP_AREAS_V2.map(x => [x.label.toLowerCase(), x.value]));

// Old area values are interpreted without rewriting Firestore. Unambiguous old
// areas migrate naturally the next time a task is edited and saved. The old
// combined Health & Fitness category intentionally becomes unassigned because
// only the user can decide which of the two new areas is correct.
const LEGACY_GENERAL_AREA_MAP = {
  "money_finance": "money",
  "money & finance": "money",
  "work_career": "work",
  "work & career": "work",
  "friends_social": "social",
  "friends & social": "social",
  "learning_growth": "learning",
  "learning & growth": "learning",
  "health_fitness": "",
  "health & fitness": "",
  "personal_admin": "",
  "personal admin": "",
  "errands": "",
  "car_transport": "",
  "car & transportation": "",
  "other": ""
};

let pendingGeneralAreaValue = null;
let relayoutTimer = null;

function canonicalGeneralValue(valueOrLabel) {
  const raw = String(valueOrLabel || "").trim();
  if (!raw) return "";
  if (GENERAL_BY_VALUE[raw]) return raw;
  const lower = raw.toLowerCase();
  if (GENERAL_VALUE_BY_LABEL[lower] !== undefined) return GENERAL_VALUE_BY_LABEL[lower];
  if (LEGACY_GENERAL_AREA_MAP[lower] !== undefined) return LEGACY_GENERAL_AREA_MAP[lower];
  return "";
}

function canonicalRelationshipValue(valueOrLabel) {
  const raw = String(valueOrLabel || "").trim();
  if (!raw) return "";
  if (RELATIONSHIP_BY_VALUE[raw]) return raw;
  const lower = raw.toLowerCase();
  return RELATIONSHIP_VALUE_BY_LABEL[lower] ?? "";
}

function areaOptionText(item) {
  return item.value ? `${item.icon} ${item.label}` : item.label;
}

function selectMatchesOptions(select, options) {
  if (select.options.length !== options.length) return false;
  return options.every((item, index) => select.options[index]?.value === item.value);
}

function replaceAreaOptions(select, options, preferredValue) {
  if (!select) return;
  const canonicalize = options === GENERAL_AREAS_V2 ? canonicalGeneralValue : canonicalRelationshipValue;
  const oldValue = select.value;
  const oldText = select.selectedOptions?.[0]?.textContent || "";
  const target = canonicalize(preferredValue ?? oldValue ?? oldText);

  if (!selectMatchesOptions(select, options)) {
    select.innerHTML = "";
    options.forEach(item => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = areaOptionText(item);
      select.appendChild(option);
    });
  }
  select.value = options.some(item => item.value === target) ? target : "";
  select.dataset.areaV2 = "1";
}

function editModalType() {
  const title = document.getElementById("edit-modal-title")?.textContent || "";
  if (/Repeating/i.test(title)) return "repeating";
  if (/Keep in Touch/i.test(title)) return "contact";
  if (/Todo/i.test(title)) return "todo";
  if (/Birthday|Occasion/i.test(title)) return "birthday";
  return null;
}

function syncAreaSelects() {
  replaceAreaOptions(document.getElementById("r-area"), GENERAL_AREAS_V2);
  replaceAreaOptions(document.getElementById("t-area"), GENERAL_AREAS_V2);
  replaceAreaOptions(document.getElementById("c-area"), RELATIONSHIP_AREAS_V2);
  replaceAreaOptions(document.getElementById("b-area"), RELATIONSHIP_AREAS_V2);

  const editArea = document.getElementById("edit-area");
  if (editArea) {
    const type = editModalType();
    if (type === "repeating" || type === "todo") {
      replaceAreaOptions(editArea, GENERAL_AREAS_V2, pendingGeneralAreaValue ?? editArea.value ?? editArea.selectedOptions?.[0]?.textContent);
    } else if (type === "contact" || type === "birthday") {
      replaceAreaOptions(editArea, RELATIONSHIP_AREAS_V2, editArea.value ?? editArea.selectedOptions?.[0]?.textContent);
    }
  }
}

function canonicalAreaInfoFromCard(card) {
  const source = card?.dataset.areaLabel || "";
  const columnId = card?.closest(".column")?.id || "";
  const relationship = columnId === "contacts-column" || columnId === "birthdays-column";
  const value = relationship ? canonicalRelationshipValue(source) : canonicalGeneralValue(source);
  const item = relationship ? RELATIONSHIP_BY_VALUE[value] : GENERAL_BY_VALUE[value];
  return item || (relationship ? RELATIONSHIP_BY_VALUE[""] : GENERAL_BY_VALUE[""]);
}

function refreshCardAreaIcon(card) {
  if (!(card instanceof HTMLElement) || !card.classList.contains("task-item")) return;
  const info = canonicalAreaInfoFromCard(card);
  card.dataset.areaCanonical = info.value;
  card.dataset.areaLabel = info.label;
  const icon = card.querySelector(".area-ascii-icon");
  if (!icon) return;
  icon.textContent = info.icon;
  icon.title = info.label;
  icon.setAttribute("aria-label", `Area: ${info.label}`);
  icon.classList.toggle("missing-area-icon", !info.value);
}

function refreshAllCardAreaIcons(root = document) {
  root.querySelectorAll?.(".task-item").forEach(refreshCardAreaIcon);
}

function captureEditArea(event) {
  const editButton = event.target.closest?.(".edit-btn");
  if (!editButton) return;
  const card = editButton.closest(".task-item");
  if (!card) return;
  const columnId = card.closest(".column")?.id || "";
  if (columnId === "repeating-column" || columnId === "todos-column") {
    pendingGeneralAreaValue = canonicalAreaInfoFromCard(card).value;
  } else {
    pendingGeneralAreaValue = null;
  }
}

function fieldFor(id) {
  return document.getElementById(id)?.closest(".edit-field") || null;
}

function makeGridRow(...fields) {
  const usable = fields.filter(Boolean);
  if (!usable.length) return null;
  const row = document.createElement("div");
  row.className = "edit-grid-row";
  usable.forEach(field => row.appendChild(field));
  return row;
}

function compactHistorySection(history) {
  if (!history) return;
  history.classList.add("compact-history-section");
  const button = history.querySelector(".history-load-btn");
  if (button && !button.dataset.shortened) {
    button.dataset.shortened = "1";
    button.textContent = "↻ Completion history";
  }
}

function compactOwnerDetail(fields) {
  const detail = fields.querySelector(".edit-readonly-detail");
  if (!detail || detail.dataset.ownerCompacted === "1") return;

  detail.querySelector(".edit-area-detail")?.remove();
  const ownerText = detail.textContent
    .replace(/^\s*Owner:\s*/i, "")
    .replace(/^(?:👤\s*)+/u, "")
    .trim();

  detail.classList.add("owner-only-detail");
  detail.dataset.ownerCompacted = "1";
  if (ownerText) detail.innerHTML = `<span>👤 <strong>${ownerText}</strong></span>`;
}

function ensureEditActionRow() {
  const form = document.getElementById("edit-form");
  if (!form) return;
  let row = form.querySelector(":scope > .edit-actions-v2");
  if (!row) {
    row = document.createElement("div");
    row.className = "edit-actions-v2";
    const save = form.querySelector(":scope > button[type='submit']");
    const cancel = form.querySelector(":scope > #edit-cancel-btn");
    if (save) row.appendChild(save);
    if (cancel) row.appendChild(cancel);
    form.appendChild(row);
  }
}

function layoutEditModal() {
  const modal = document.getElementById("edit-modal");
  if (!modal || modal.style.display === "none") return;
  syncAreaSelects();

  const fields = document.getElementById("edit-fields");
  if (!fields) return;
  compactOwnerDetail(fields);
  ensureEditActionRow();

  // Core rebuilding edit-fields on every open gives us a clean signal that the
  // compact layout needs to be recreated.
  if (fields.dataset.compactLayoutV2 === "1") return;

  const name = fieldFor("edit-name");
  const date = fieldFor("edit-date");
  const frequency = fieldFor("edit-frequency");
  const area = fieldFor("edit-area");
  const priority = fieldFor("edit-priority");
  const effort = fieldFor("edit-effort");
  const history = fields.querySelector(".history-section");
  const detail = fields.querySelector(".edit-readonly-detail");
  const type = editModalType();

  const fragment = document.createDocumentFragment();
  if (name) fragment.appendChild(name);

  if ((type === "repeating" || type === "contact") && date && frequency) {
    fragment.appendChild(makeGridRow(date, frequency));
  } else if (date) {
    fragment.appendChild(date);
  }

  if ((type === "repeating" || type === "todo") && area && effort) {
    fragment.appendChild(makeGridRow(area, effort));
  } else if (type === "birthday" && date && area) {
    // Birthday is intentionally tiny: date and relationship area share a row.
    const existingDate = fragment.querySelector?.("#edit-date")?.closest?.(".edit-field");
    if (existingDate) existingDate.remove();
    fragment.appendChild(makeGridRow(date, area));
  } else if (area) {
    fragment.appendChild(area);
  }

  if (priority) fragment.appendChild(priority);
  if (detail) fragment.appendChild(detail);
  if (history) {
    compactHistorySection(history);
    fragment.appendChild(history);
  }

  fields.innerHTML = "";
  fields.appendChild(fragment);
  fields.dataset.compactLayoutV2 = "1";

  // New layout starts at the top every time, eliminating stale weird scroll
  // positions from the previous edit session.
  const content = modal.querySelector(".modal-content");
  if (content) {
    content.scrollLeft = 0;
    content.scrollTop = 0;
  }
}

function scheduleLayout() {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(layoutEditModal, 0);
}

function initAreaAndEditV2() {
  syncAreaSelects();
  refreshAllCardAreaIcons();
  document.addEventListener("click", captureEditArea, true);

  const observer = new MutationObserver(mutations => {
    let shouldSyncAreas = false;
    let shouldLayout = false;

    mutations.forEach(mutation => {
      if (mutation.type === "childList") {
        // Only changes inside the edit fields should trigger an edit relayout.
        // This avoids feedback loops from unrelated DOM updates while the sheet
        // happens to be open.
        if (mutation.target?.id === "edit-fields" || mutation.target?.closest?.("#edit-fields")) {
          shouldLayout = true;
        }

        mutation.addedNodes.forEach(node => {
          if (!(node instanceof HTMLElement)) return;
          if (node.classList.contains("task-item")) refreshCardAreaIcon(node);
          refreshAllCardAreaIcons(node);
          if (node.matches?.("#edit-fields, #edit-area, #r-area, #t-area, #c-area, #b-area") || node.querySelector?.("#edit-area, #r-area, #t-area, #c-area, #b-area")) {
            shouldSyncAreas = true;
          }
          if (node.id === "edit-fields" || node.querySelector?.("#edit-fields")) shouldLayout = true;
        });
        if (mutation.target instanceof HTMLSelectElement && mutation.target.matches("#edit-area, #r-area, #t-area, #c-area, #b-area")) shouldSyncAreas = true;
      }
      if (mutation.type === "attributes" && mutation.target.id === "edit-modal") shouldLayout = true;
    });

    if (shouldSyncAreas) syncAreaSelects();
    if (shouldLayout) scheduleLayout();
  });

  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  window.addEventListener("orientationchange", scheduleLayout);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAreaAndEditV2);
else initAreaAndEditV2();
