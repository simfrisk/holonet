// OSC Monitor Tab - lazy-loaded on tab activation

const INTERNAL_TENANTS = new Set([
    'eyevinn', 'eyevinnlab', 'simonsteam', 'team2',
    'oscaidev', 'testnp', 'simondemo', 'birme', 'birispriv'
]);

const CHART_COLORS = [
    '#5578f5', '#2ecc87', '#f0b429', '#e85555', '#a25afd',
    '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#14b8a6',
    '#a78bfa', '#fb7185', '#34d399', '#fbbf24', '#60a5fa',
    '#e879f9', '#4ade80', '#facc15', '#f87171', '#38bdf8',
];

let monitorState = {
    initialized: false,
    chart: null,
    pollTimer: null,
    currentRange: '6h',
    hideInternal: true,
    events: [],
    lastEventTime: null,
    oldestEventTime: null,
    hasMore: false,
    page: 0
};

// Called by navigation.js when Monitor tab is clicked
function initMonitor() {
    if (monitorState.initialized) return;
    monitorState.initialized = true;
    setupMonitorControls();
    refreshMonitorEvents();
    loadInstanceGraph(monitorState.currentRange);
    loadCurrentInstances();
    // Poll for new events every 30s
    monitorState.pollTimer = setInterval(pollNewEvents, 30000);
}

// Called by navigation.js when leaving Monitor tab
function pauseMonitor() {
    if (!monitorState.initialized) return;
    if (monitorState.pollTimer) {
        clearInterval(monitorState.pollTimer);
        monitorState.pollTimer = null;
    }
    monitorState.initialized = false; // reload fresh on next visit
}

function setupMonitorControls() {
    // Hide-internal checkbox
    const hideCheckbox = document.getElementById('monitor-hide-internal');
    if (hideCheckbox) {
        hideCheckbox.checked = monitorState.hideInternal;
        hideCheckbox.addEventListener('change', function() {
            monitorState.hideInternal = this.checked;
            renderEvents(monitorState.events);
        });
    }

    // Refresh button
    const refreshBtn = document.getElementById('monitor-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            monitorState.events = [];
            monitorState.lastEventTime = null;
            monitorState.oldestEventTime = null;
            monitorState.hasMore = false;
            refreshMonitorEvents();
            loadInstanceGraph(monitorState.currentRange);
            loadCurrentInstances();
        });
    }

    // Range buttons
    document.querySelectorAll('.range-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.range-btn').forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            loadInstanceGraph(this.dataset.range);
        });
    });

    // Load-more button
    const loadMoreBtn = document.getElementById('monitor-load-more-btn');
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', loadOlderEvents);
    }
}

async function refreshMonitorEvents() {
    const list = document.getElementById('monitor-events-list');
    if (!list) return;
    list.innerHTML = '<div class="monitor-loading">Loading events...</div>';

    try {
        const res = await fetch('/api/monitor/events');
        if (res.status === 503) {
            list.innerHTML = '<div class="monitor-loading">Monitor not configured on this server.</div>';
            return;
        }
        if (!res.ok) {
            list.innerHTML = '<div class="monitor-error">Error loading events (HTTP ' + res.status + ').</div>';
            return;
        }
        const data = await res.json();
        monitorState.events = data.events || [];
        monitorState.hasMore = data.hasMore || false;
        if (data.latestTimestamp) monitorState.lastEventTime = data.latestTimestamp;
        if (data.oldestTimestamp) monitorState.oldestEventTime = data.oldestTimestamp;
        renderEvents(monitorState.events);
        updateLoadMoreBtn();
    } catch (err) {
        list.innerHTML = '<div class="monitor-error">Failed to load events: ' + err.message + '</div>';
    }
}

async function pollNewEvents() {
    if (!monitorState.lastEventTime) return;
    try {
        const res = await fetch('/api/monitor/events?since=' + encodeURIComponent(monitorState.lastEventTime));
        if (!res.ok) return;
        const data = await res.json();
        const newEvents = data.events || [];
        if (newEvents.length > 0) {
            const existingIds = new Set(monitorState.events.map(function(e) { return e.id; }));
            const trulyNew = newEvents.filter(function(e) { return !existingIds.has(e.id); });
            if (trulyNew.length > 0) {
                monitorState.events = trulyNew.concat(monitorState.events);
                if (data.latestTimestamp) monitorState.lastEventTime = data.latestTimestamp;
                renderEvents(monitorState.events);
            }
        }
    } catch (_err) {
        // silent poll errors
    }
}

async function loadOlderEvents() {
    if (!monitorState.hasMore || !monitorState.oldestEventTime) return;
    const loadMoreBtn = document.getElementById('monitor-load-more-btn');
    if (loadMoreBtn) loadMoreBtn.textContent = 'Loading...';

    try {
        const res = await fetch('/api/monitor/events?before=' + encodeURIComponent(monitorState.oldestEventTime));
        if (!res.ok) return;
        const data = await res.json();
        const olderEvents = data.events || [];
        if (olderEvents.length > 0) {
            const existingIds = new Set(monitorState.events.map(function(e) { return e.id; }));
            const trulyOld = olderEvents.filter(function(e) { return !existingIds.has(e.id); });
            monitorState.events = monitorState.events.concat(trulyOld);
            if (data.oldestTimestamp) monitorState.oldestEventTime = data.oldestTimestamp;
        }
        monitorState.hasMore = data.hasMore || false;
        renderEvents(monitorState.events);
        updateLoadMoreBtn();
    } catch (_err) {
        if (loadMoreBtn) loadMoreBtn.textContent = 'Load more';
    }
}

async function loadInstanceGraph(range) {
    monitorState.currentRange = range;
    const canvas = document.getElementById('monitor-instance-chart');
    const loadingEl = document.getElementById('monitor-chart-loading');
    if (!canvas || !loadingEl) return;

    loadingEl.style.display = 'flex';
    canvas.style.display = 'none';

    try {
        const res = await fetch('/api/monitor/instances/graph?range=' + encodeURIComponent(range));
        if (res.status === 503) {
            loadingEl.textContent = 'Monitor not configured on this server.';
            return;
        }
        if (!res.ok) {
            loadingEl.textContent = 'Error loading graph (HTTP ' + res.status + ').';
            return;
        }
        const data = await res.json();
        const seriesData = data.series || [];

        // Destroy old chart
        if (monitorState.chart) {
            monitorState.chart.destroy();
            monitorState.chart = null;
        }

        if (seriesData.length === 0) {
            loadingEl.textContent = 'No data for this time range.';
            return;
        }

        // Build unified time labels
        const timeSet = new Set();
        seriesData.forEach(function(s) {
            s.data.forEach(function(d) { timeSet.add(d.time); });
        });
        const sortedTimes = Array.from(timeSet).sort(function(a, b) { return a - b; });

        const formatLabel = function(ts) {
            const d = new Date(ts);
            if (range === '7d') {
                return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
                       d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            }
            return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        };

        const labels = sortedTimes.map(formatLabel);

        const datasets = seriesData.map(function(s, i) {
            const color = CHART_COLORS[i % CHART_COLORS.length];
            const lookup = new Map(s.data.map(function(d) { return [d.time, d.value]; }));
            return {
                label: s.namespace,
                data: sortedTimes.map(function(t) { return lookup.get(t) || 0; }),
                backgroundColor: color.replace('#', 'rgba(') + '99)',
                borderColor: color,
                borderWidth: 1.5,
                fill: true,
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 3
            };
        });

        // Proper rgba from hex
        datasets.forEach(function(ds, i) {
            const hex = CHART_COLORS[i % CHART_COLORS.length];
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            ds.backgroundColor = 'rgba(' + r + ',' + g + ',' + b + ',0.35)';
            ds.borderColor = hex;
        });

        loadingEl.style.display = 'none';
        canvas.style.display = 'block';

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const gridColor = isDark ? 'rgba(38,40,64,0.6)' : 'rgba(200,200,200,0.4)';
        const tickColor = isDark ? '#7c84a8' : '#999';

        monitorState.chart = new Chart(canvas, {
            type: 'line',
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        stacked: true,
                        ticks: { color: tickColor, font: { size: 10 }, maxTicksLimit: 8, maxRotation: 0 },
                        grid: { color: gridColor }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        ticks: { color: tickColor, font: { size: 10 }, precision: 0 },
                        grid: { color: gridColor }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: isDark ? '#1b1e35' : '#fff',
                        titleColor: isDark ? '#e8eaf5' : '#333',
                        bodyColor: isDark ? '#7c84a8' : '#666',
                        borderColor: isDark ? '#262840' : '#ddd',
                        borderWidth: 1,
                        callbacks: {
                            label: function(ctx) {
                                return ctx.dataset.label + ': ' + ctx.parsed.y;
                            }
                        }
                    }
                }
            }
        });
    } catch (err) {
        loadingEl.textContent = 'Failed to load graph: ' + err.message;
        loadingEl.style.display = 'flex';
    }
}

async function loadCurrentInstances() {
    const sidebar = document.getElementById('monitor-tenant-sidebar');
    if (!sidebar) return;
    sidebar.innerHTML = '<div class="monitor-loading" style="font-size:12px;">Loading...</div>';

    try {
        const res = await fetch('/api/monitor/instances/current');
        if (res.status === 503) {
            sidebar.innerHTML = '<div class="monitor-loading" style="font-size:12px;">Not configured.</div>';
            return;
        }
        if (!res.ok) {
            sidebar.innerHTML = '<div class="monitor-loading" style="font-size:12px;">Error.</div>';
            return;
        }
        const data = await res.json();
        renderTenantSidebar(data.tenants || []);
    } catch (err) {
        sidebar.innerHTML = '<div class="monitor-loading" style="font-size:12px;">Failed to load.</div>';
    }
}

function renderEvents(events) {
    const list = document.getElementById('monitor-events-list');
    if (!list) return;

    const filtered = events.filter(function(e) {
        if (monitorState.hideInternal && INTERNAL_TENANTS.has(e.tenant)) return false;
        return true;
    });

    if (filtered.length === 0) {
        list.innerHTML = '<div class="monitor-loading">No events to display.</div>';
        return;
    }

    const html = filtered.map(function(e) {
        return '<div class="monitor-event-item">' +
            '<span class="monitor-event-emoji">' + (e.emoji || '•') + '</span>' +
            '<div class="monitor-event-body">' +
                '<div class="monitor-event-desc">' + escapeHtml(e.description || '') + '</div>' +
                '<div class="monitor-event-meta">' +
                    '<span class="monitor-event-tenant">' + escapeHtml(e.tenant || '') + '</span>' +
                    ' · ' +
                    '<span>' + formatRelativeTime(e.timestamp) + '</span>' +
                '</div>' +
            '</div>' +
        '</div>';
    }).join('');

    list.innerHTML = html;
}

function renderTenantSidebar(tenants) {
    const sidebar = document.getElementById('monitor-tenant-sidebar');
    if (!sidebar) return;

    if (!tenants || tenants.length === 0) {
        sidebar.innerHTML = '<div class="monitor-loading" style="font-size:12px;">No instances.</div>';
        return;
    }

    const sorted = tenants.slice().sort(function(a, b) { return (b.count || 0) - (a.count || 0); });

    const html = '<div class="monitor-sidebar-label">Tenants</div>' +
        sorted.map(function(t) {
            return '<div class="monitor-tenant-item">' +
                '<span class="monitor-tenant-name">' + escapeHtml(t.name || t.namespace || '') + '</span>' +
                '<span class="monitor-tenant-count">' + (t.count || 0) + '</span>' +
            '</div>';
        }).join('');

    sidebar.innerHTML = html;
}

function updateLoadMoreBtn() {
    const btn = document.getElementById('monitor-load-more-btn');
    if (!btn) return;
    btn.style.display = monitorState.hasMore ? 'inline-block' : 'none';
    btn.textContent = 'Load more';
}

function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    // timestamp may be a number (ms) or ISO string
    const ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    const diffMs = Date.now() - ts;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + ' min ago';
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return diffHour + 'h ago';
    const diffDay = Math.floor(diffHour / 24);
    return diffDay + 'd ago';
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
