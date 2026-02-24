        // =========================================
        // EVENT LISTENERS
        // =========================================
        window.onclick = function(event) {
            if (event.target === document.getElementById('addContactModal')) closeAddContactModal();
            if (event.target === document.getElementById('noteModal')) closeNoteModal();
            if (event.target === document.getElementById('draftModal')) closeDraftModal();
        };

        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                if (document.getElementById('addContactModal').style.display === 'block') closeAddContactModal();
                if (document.getElementById('noteModal').style.display === 'block') closeNoteModal();
                if (document.getElementById('draftModal').style.display === 'block') closeDraftModal();
            }
        });
        // =========================================
        // INIT
        // =========================================
        window.addEventListener('DOMContentLoaded', () => {
            initDarkMode();
            loadContacts().then(() => restoreNavFromHash());
        });
