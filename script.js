document.addEventListener('DOMContentLoaded', (event) => {
    const checkbox = document.getElementById('studyCheckbox');

    // Load checkbox state from localStorage
    const checked = localStorage.getItem('studyChecked');
    if (checked === 'true') {
        checkbox.checked = true;
    }

    // Save checkbox state to localStorage
    checkbox.addEventListener('change', () => {
        localStorage.setItem('studyChecked', checkbox.checked);
    });

    // Function to reset checkbox at 4 AM
    const resetCheckbox = () => {
        const now = new Date();
        const nextReset = new Date();
        nextReset.setHours(4, 0, 0, 0); // Set the time to 4 AM today

        if (now > nextReset) {
            nextReset.setDate(nextReset.getDate() + 1); // Move to 4 AM next day if 4 AM has passed today
        }

        const timeToReset = nextReset - now;
        setTimeout(() => {
            localStorage.setItem('studyChecked', 'false');
            checkbox.checked = false;
            resetCheckbox(); // Schedule the next reset
        }, timeToReset);
    };

    resetCheckbox(); // Initial call to set the reset schedule
});
