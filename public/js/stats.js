        // =========================================
        // STATS TAB - Weekly Counter
        // =========================================

        const WEEKLY_COUNTER_KEY = 'osc_weekly_contacted';

        function getMondayOfCurrentWeek() {
            const now = new Date();
            const day = now.getDay(); // 0 = Sunday
            const diff = day === 0 ? -6 : 1 - day; // Monday is start of week
            const monday = new Date(now);
            monday.setDate(now.getDate() + diff);
            monday.setHours(0, 0, 0, 0);
            return monday.toISOString().slice(0, 10); // YYYY-MM-DD
        }

        function loadWeeklyCounter() {
            const currentWeek = getMondayOfCurrentWeek();
            try {
                const stored = JSON.parse(localStorage.getItem(WEEKLY_COUNTER_KEY) || '{}');
                if (stored.weekStart === currentWeek) {
                    return { weekStart: currentWeek, count: stored.count || 0 };
                }
            } catch (e) { /* ignore */ }
            // New week or no data
            return { weekStart: currentWeek, count: 0 };
        }

        function saveWeeklyCounter(data) {
            localStorage.setItem(WEEKLY_COUNTER_KEY, JSON.stringify(data));
        }

        function adjustWeeklyContacted(delta) {
            const data = loadWeeklyCounter();
            data.count = Math.max(0, data.count + delta);
            saveWeeklyCounter(data);
            renderWeeklyCounter(data);
        }

        function renderWeeklyCounter(data) {
            const countEl = document.getElementById('weekly-contacted-count');
            const labelEl = document.getElementById('weekly-counter-week-label');
            if (countEl) countEl.textContent = data.count;
            if (labelEl) {
                const d = new Date(data.weekStart + 'T00:00:00');
                const endDate = new Date(d);
                endDate.setDate(d.getDate() + 6);
                const fmt = (dt) => dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                labelEl.textContent = `Week of ${fmt(d)} - ${fmt(endDate)}`;
            }
        }

        function initStatsWeeklyCounter() {
            const data = loadWeeklyCounter();
            renderWeeklyCounter(data);
        }
