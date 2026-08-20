(() => {
  const addModal = document.getElementById('add-modal');
  const addModalTitle = document.getElementById('add-modal-title');
  const statsModal = document.getElementById('stats-modal');

  const addTitles = {
    repeating: 'Add Repeating Task',
    contact: 'Add Keep in Touch Task',
    todos: 'Add Todo',
    birthdays: 'Add Occasion'
  };

  function hideAddModal() {
    if (addModal) addModal.style.display = 'none';
  }

  function showAddModal(type) {
    document.querySelectorAll('.add-modal-form').forEach(form => {
      form.style.display = form.dataset.addForm === type ? 'block' : 'none';
    });
    if (addModalTitle) addModalTitle.textContent = addTitles[type] || 'Add Task';
    if (addModal) addModal.style.display = 'flex';

    requestAnimationFrame(() => {
      const visibleForm = document.querySelector(`.add-modal-form[data-add-form="${type}"]`);
      const firstInput = visibleForm?.querySelector('input');
      firstInput?.focus();
    });
  }

  document.querySelectorAll('.add-task-btn').forEach(button => {
    button.addEventListener('click', () => showAddModal(button.dataset.addType));
  });

  document.getElementById('add-modal-close')?.addEventListener('click', hideAddModal);
  addModal?.addEventListener('click', event => {
    if (event.target === addModal) hideAddModal();
  });

  document.querySelectorAll('.add-modal-form').forEach(form => {
    form.addEventListener('submit', () => {
      // The existing app handler performs the actual async Firestore write.
      // Closing on the next tick preserves that handler while keeping mobile UX snappy.
      setTimeout(hideAddModal, 0);
    });
  });

  document.getElementById('stats-btn')?.addEventListener('click', () => {
    if (statsModal) statsModal.style.display = 'flex';
  });
  document.getElementById('stats-modal-close')?.addEventListener('click', () => {
    if (statsModal) statsModal.style.display = 'none';
  });
  statsModal?.addEventListener('click', event => {
    if (event.target === statsModal) statsModal.style.display = 'none';
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    hideAddModal();
    if (statsModal) statsModal.style.display = 'none';
  });
})();
