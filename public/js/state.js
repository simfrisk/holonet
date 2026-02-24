        let contactsData = null;
        let editingContactId = null;

        // =========================================
        // DARK MODE
        // =========================================
        function initDarkMode() {
            const saved = localStorage.getItem('darkMode');
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const isDark = saved !== null ? saved === 'true' : prefersDark;
            document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
            updateDarkModeButton(isDark);
        }

        function toggleDarkMode() {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const newMode = !isDark;
            document.documentElement.setAttribute('data-theme', newMode ? 'dark' : 'light');
            localStorage.setItem('darkMode', String(newMode));
            updateDarkModeButton(newMode);
        }

        function updateDarkModeButton(isDark) {
            const btn = document.getElementById('darkModeBtn');
            if (!btn) return;
            btn.innerHTML = isDark ? '<i class="ti ti-sun"></i>' : '<i class="ti ti-moon"></i>';
            btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
        }
