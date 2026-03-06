        // =========================================
        // EVENT LISTENERS
        // =========================================
        window.onclick = function(event) {
            if (event.target === document.getElementById('addContactModal')) closeAddContactModal();
            if (event.target === document.getElementById('noteModal')) closeNoteModal();
            // draftModal intentionally does NOT close on outside click — use Save or Cancel
        };

        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                if (document.getElementById('addContactModal').style.display === 'block') closeAddContactModal();
                if (document.getElementById('noteModal').style.display === 'block') closeNoteModal();
                // draftModal: Escape also does NOT close (avoid accidental data loss)
            }
        });

        // =========================================
        // PRELOAD COUNTS for primary nav badges
        // =========================================
        async function preloadCounts() {
            try {
                const [draftsRes, todosRes, trackedRes, briefsRes] = await Promise.all([
                    fetch('/api/drafts'),
                    fetch('/api/todos'),
                    fetch('/api/tracked'),
                    fetch('/api/briefs')
                ]);
                if (draftsRes.ok) {
                    const d = await draftsRes.json();
                    document.getElementById('drafts-count').textContent = (d.drafts || []).length;
                }
                if (todosRes.ok) {
                    const d = await todosRes.json();
                    const active = (d.todos || []).filter(t => !t.done).length;
                    document.getElementById('todos-count').textContent = active;
                }
                if (trackedRes.ok) {
                    const d = await trackedRes.json();
                    const tracked = d.tracked || [];
                    document.getElementById('tracked-count').textContent = tracked.length;
                    // Pre-populate trackedCustomers so syncTrackButtons works immediately
                    if (tracked.length > 0 && trackedCustomers.length === 0) {
                        trackedCustomers = tracked;
                        syncTrackButtons();
                    }
                }
                if (briefsRes.ok) {
                    const d = await briefsRes.json();
                    const todayStr = new Date().toISOString().split('T')[0];
                    const todayBrief = (d.briefs || []).find(b => b.date === todayStr && !b.archived);
                    if (todayBrief && todayBrief.totalItems > 0) {
                        const incomplete = todayBrief.totalItems - (todayBrief.completedItems || 0);
                        const el = document.getElementById('brief-count');
                        if (el && incomplete > 0) el.textContent = incomplete;
                    }
                }
            } catch (e) {
                // Silently ignore — counts will update when tabs are visited
            }
        }

        // =========================================
        // INIT
        // =========================================
        window.addEventListener('DOMContentLoaded', () => {
            initDarkMode();
            loadContacts().then(() => restoreNavFromHash());
            preloadCounts();
        });
