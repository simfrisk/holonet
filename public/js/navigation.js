        const CONTACT_TABS = ['active', 'archived', 'later', 'skip', 'all'];
        let activeSection = 'todos';
        let activeContactTab = 'active';
        let trackedLoaded = false;
        let trackedCustomers = []; // in-memory cache
        let statsLoaded = false;
        let customersLoaded = false;
        let videosLoaded = false;
        let videosData = [];

        function switchSection(sectionName, skipHash) {
            activeSection = sectionName;
            if (!skipHash) {
                const hash = sectionName === 'contacts' ? `contacts-${activeContactTab}` : sectionName;
                history.replaceState(null, '', `#${hash}`);
            }

            // Update primary nav buttons
            document.querySelectorAll('.primary-nav-btn').forEach(btn => btn.classList.remove('active'));
            const navBtn = document.querySelector(`.primary-nav-btn[data-section="${sectionName}"]`);
            if (navBtn) navBtn.classList.add('active');

            // Show/hide sub-nav
            const subNav = document.getElementById('contact-sub-nav');
            if (sectionName === 'contacts') {
                subNav.classList.remove('hidden');
                // Restore last active contact sub-tab
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById(`${activeContactTab}-tab`).classList.add('active');
                if (activeContactTab === 'all') renderAllTab();
            } else {
                subNav.classList.add('hidden');
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById(`${sectionName}-tab`).classList.add('active');

                if (sectionName === 'drafts' && !draftsLoaded) {
                    loadDraftsTab();
                }
                if (sectionName === 'todos' && !todosLoaded) {
                    loadTodosTab();
                }
                if (sectionName === 'tracked' && !trackedLoaded) {
                    loadTrackedTab();
                }
                if (sectionName === 'stats') {
                    initStatsWeeklyCounter();
                    updateStats(); // refresh pipeline counts
                    statsLoaded = true;
                }
                if (sectionName === 'links') {
                    renderLinksGrid();
                }
                if (sectionName === 'monitor') {
                    loadChartJs(function() { initMonitor(); });
                }
                if (sectionName === 'brief') {
                    loadBriefTab();
                }
                if (sectionName === 'videos' && !videosLoaded) {
                    loadVideosTab();
                }
                if (sectionName === 'customers') {
                    if (!customersLoaded) {
                        customersLoaded = true;
                        initCustomersTab();
                    }
                    loadCustomers();
                }
            }

            // Pause monitor polling when leaving the monitor tab
            if (sectionName !== 'monitor') {
                pauseMonitor();
            }
        }

        function loadChartJs(callback) {
            if (window.Chart) { callback(); return; }
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
            s.onload = callback;
            document.head.appendChild(s);
        }

        function switchTab(tabName, skipHash) {
            activeContactTab = tabName;
            if (!skipHash) {
                history.replaceState(null, '', `#contacts-${tabName}`);
            }
            document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
            document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            document.getElementById(`${tabName}-tab`).classList.add('active');
            // All tab renders fresh from contactsData each time it's activated
            if (tabName === 'all') renderAllTab();
        }

        function restoreNavFromHash() {
            const hash = window.location.hash.slice(1);
            const CONTACT_SUB_TABS = ['active', 'archived', 'later', 'skip', 'all'];
            const TOP_SECTIONS = ['drafts', 'todos', 'tracked', 'stats', 'links', 'monitor', 'brief', 'customers', 'videos'];

            if (TOP_SECTIONS.includes(hash)) {
                switchSection(hash, true);
            } else if (hash.startsWith('contacts-')) {
                const sub = hash.replace('contacts-', '');
                if (CONTACT_SUB_TABS.includes(sub)) {
                    activeContactTab = sub;
                    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                    const btn = document.querySelector(`[data-tab="${sub}"]`);
                    if (btn) btn.classList.add('active');
                }
                switchSection('contacts', true);
            }
            // default (no hash or unknown): start on todos
            else { switchSection('todos', true); }
        }
