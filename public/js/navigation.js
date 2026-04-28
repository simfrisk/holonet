        const CONTACT_TABS = ['active', 'archived', 'later', 'skip', 'all'];
        const NAV_SECTION_KEY = 'osc_active_section';
        const NAV_CONTACT_TAB_KEY = 'osc_active_contact_tab';
        const MOBILE_NAV_BREAKPOINT = 900;

        // ---- Sidebar toggle ----
        let sidebarOpen = true; // desktop: starts open

        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            const isMobile = window.innerWidth <= MOBILE_NAV_BREAKPOINT;
            if (isMobile) {
                if (sidebar.classList.contains('open')) {
                    closeSidebar();
                } else {
                    openSidebar();
                }
            } else {
                sidebar.classList.toggle('collapsed');
                sidebarOpen = !sidebar.classList.contains('collapsed');
            }
        }

        function openSidebar() {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebarOverlay');
            if (!sidebar || !overlay) return;
            sidebar.classList.add('open');
            sidebar.classList.remove('collapsed');
            overlay.style.display = 'block';
            requestAnimationFrame(() => overlay.classList.add('visible'));
            document.body.style.overflow = 'hidden';
        }

        function closeSidebar() {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebarOverlay');
            if (!sidebar || !overlay) return;
            const isMobile = window.innerWidth <= MOBILE_NAV_BREAKPOINT;
            if (isMobile) {
                sidebar.classList.remove('open');
                sidebar.classList.add('collapsed');
                overlay.classList.remove('visible');
                document.body.style.overflow = '';
                setTimeout(() => { overlay.style.display = 'none'; }, 250);
            } else {
                sidebar.classList.add('collapsed');
                sidebarOpen = false;
            }
        }
        let activeSection = 'todos';
        let activeContactTab = 'active';
        let trackedLoaded = false;
        let trackedCustomers = []; // in-memory cache
        let customersLoaded = false;
        let videosLoaded = false;
        let videosData = [];

        function switchSection(sectionName, skipHash) {
            activeSection = sectionName;
            try { localStorage.setItem(NAV_SECTION_KEY, sectionName); } catch (e) {}
            // Auto-close sidebar on mobile after selecting a section
            if (window.innerWidth <= MOBILE_NAV_BREAKPOINT) closeSidebar();
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
                if (sectionName === 'links') {
                    if (!linksLoaded) {
                        loadLinksData().then(() => renderLinksGrid());
                    } else {
                        renderLinksGrid();
                    }
                }
                if (sectionName === 'monitor') {
                    loadChartJs(function() { initMonitor(); });
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
                if (sectionName === 'outputs' && !outputsLoaded) {
                    loadOutputsTab();
                }
            }

            // Pause monitor polling when leaving the monitor tab
            if (sectionName !== 'monitor' && typeof pauseMonitor === 'function') {
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
            try { localStorage.setItem(NAV_CONTACT_TAB_KEY, tabName); } catch (e) {}
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
            const TOP_SECTIONS = ['drafts', 'todos', 'tracked', 'links', 'monitor', 'customers', 'videos', 'outputs', 'contacts'];

            // Restore last contact sub-tab from localStorage so it persists even when arriving via plain "contacts" hash
            try {
                const savedSub = localStorage.getItem(NAV_CONTACT_TAB_KEY);
                if (savedSub && CONTACT_SUB_TABS.includes(savedSub)) {
                    activeContactTab = savedSub;
                }
            } catch (e) {}

            // Hash takes priority
            if (TOP_SECTIONS.includes(hash) && hash !== 'contacts') {
                switchSection(hash, true);
                return;
            }
            if (hash === 'contacts' || hash.startsWith('contacts-')) {
                if (hash.startsWith('contacts-')) {
                    const sub = hash.replace('contacts-', '');
                    if (CONTACT_SUB_TABS.includes(sub)) activeContactTab = sub;
                }
                document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                const btn = document.querySelector(`[data-tab="${activeContactTab}"]`);
                if (btn) btn.classList.add('active');
                switchSection('contacts', true);
                return;
            }

            // No usable hash → fall back to localStorage
            try {
                const savedSection = localStorage.getItem(NAV_SECTION_KEY);
                if (savedSection && TOP_SECTIONS.includes(savedSection)) {
                    if (savedSection === 'contacts') {
                        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                        const btn = document.querySelector(`[data-tab="${activeContactTab}"]`);
                        if (btn) btn.classList.add('active');
                    }
                    switchSection(savedSection, true);
                    return;
                }
            } catch (e) {}

            // Final default
            switchSection('todos', true);
        }

        window.addEventListener('resize', () => {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebarOverlay');
            if (!sidebar || !overlay) return;

            if (window.innerWidth > MOBILE_NAV_BREAKPOINT) {
                sidebar.classList.remove('open');
                overlay.classList.remove('visible');
                overlay.style.display = 'none';
                document.body.style.overflow = '';
            } else if (!sidebar.classList.contains('open')) {
                sidebar.classList.add('collapsed');
                overlay.classList.remove('visible');
                overlay.style.display = 'none';
                document.body.style.overflow = '';
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && window.innerWidth <= MOBILE_NAV_BREAKPOINT) {
                closeSidebar();
            }
        });
