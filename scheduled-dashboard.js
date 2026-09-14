// Scheduled routines are daily check-ins, not backlog items. Keep them out of the
// normal Repeating dashboard except on a scheduled day while still incomplete.
// They remain represented in Calendar and in the read-only AI API.
function isScheduledRoutineCard(card) {
  const summary = card.querySelector(".schedule-card-summary")?.textContent || "";
  return Boolean(summary) && !/^\(Every\s/i.test(summary.trim());
}

function updateScheduledCardVisibility(root = document) {
  root.querySelectorAll?.("#repeating-list .task-item").forEach(card => {
    if (!isScheduledRoutineCard(card)) {
      card.classList.remove("scheduled-routine-inactive");
      return;
    }
    // Core scheduling marks an incomplete occurrence due today with due-today.
    // After completion, the card immediately rerenders with its next future
    // occurrence, so it drops out for the rest of the day automatically.
    card.classList.toggle("scheduled-routine-inactive", !card.classList.contains("due-today"));
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
