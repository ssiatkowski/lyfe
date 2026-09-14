// The edit field container is reused between task opens. Clear the compact
// layout marker before the core Edit handler rebuilds its fields so every task
// gets a fresh mobile layout.
document.addEventListener("click", event => {
  if (!event.target.closest?.(".edit-btn")) return;
  document.getElementById("edit-fields")?.removeAttribute("data-compact-layout-v2");
}, true);
