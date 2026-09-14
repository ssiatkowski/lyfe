// Scheduled routines are daily check-ins, not backlog items. Keep them out of the
// normal Repeating dashboard except on a scheduled day while still incomplete.
// They remain represented in Calendar and in the read-only AI API.
function isScheduledRoutineCard(card) {
  const summary = card.querySelector(".schedule-card-summary")?.textContent || "";
  return Boolean(summary) && !/^\(Every\s/i.test(summary.trim());
}

function updateScheduledCardVisibility(root = document) {
  root.querySelectorAll?.("#repeating-list .task-item").forEach(card => {
    const inactive = isScheduledRoutineCard(card) && !card.classList.contains("due-today");
    card.classList.toggle("scheduled-routine-inactive", inactive);
    card.hidden = inactive;
  });
}

function initScheduledDashboard() {
  updateScheduledCardVisibility();
  const list = document.getElementById("repeating-list");
  if (!list) return;
  const observer = new MutationObserver(() => updateScheduledCardVisibility(list));
  observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initScheduledDashboard);
else initScheduledDashboard();
