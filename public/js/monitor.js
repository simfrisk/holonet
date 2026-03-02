// OSC Monitor Tab - lazy-loaded on tab activation

const INTERNAL_TENANTS = new Set([
    'eyevinn', 'eyevinnlab', 'simonsteam', 'team2',
    'oscaidev', 'testnp', 'simondemo', 'birme', 'birispriv'
]);

const CHART_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
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
    mutedTenants: [],
    isSoundMuted: true,
    soloedTenant: null,
    tenantColors: {},
    sidebarSearch: '',
    scrollObserver: null,
    _sidebarItems: [],
    _sidebarIsTenantMode: true,
};

// =========================================
// Audio + Notifications
// =========================================

function playPing() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
    } catch (_e) {
        // audio not available
    }
}

function sendBrowserNotification(events) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (events.length === 1) {
        new Notification((events[0].emoji || '') + ' OSC Monitor', {
            body: events[0].description,
            silent: false,
        });
    } else {
        new Notification('OSC Monitor - ' + events.length + ' new events', {
            body: events.slice(0, 3).map(function(e) { return (e.emoji || '') + ' ' + e.description; }).join('\n'),
            silent: false,
        });
    }
}

function updateNotifButtons() {
    if (typeof Notification === 'undefined') return;
    const perm = Notification.permission;
    const notifBtn = document.getElementById('monitor-notif-btn');
    const notifOnBtn = document.getElementById('monitor-notif-on-btn');
    const notifDenied = document.getElementById('monitor-notif-denied');
    if (notifBtn) notifBtn.style.display = perm === 'default' ? '' : 'none';
    if (notifOnBtn) notifOnBtn.style.display = perm === 'granted' ? '' : 'none';
    if (notifDenied) notifDenied.style.display = perm === 'denied' ? '' : 'none';
}

// =========================================
// Init / Teardown
// =========================================

function initMonitor() {
    if (monitorState.initialized) return;
    monitorState.initialized = true;
    setupMonitorControls();
    setupScrollObserver();
    refreshMonitorEvents();
    loadInstanceGraph(monitorState.currentRange);
    loadCurrentInstances();
    monitorState.pollTimer = setInterval(pollNewEvents, 30000);
}

function pauseMonitor() {
    if (!monitorState.initialized) return;
    if (monitorState.pollTimer) {
        clearInterval(monitorState.pollTimer);
        monitorState.pollTimer = null;
    }
    if (monitorState.scrollObserver) {
        monitorState.scrollObserver.disconnect();
        monitorState.scrollObserver = null;
    }
    monitorState.initialized = false;
}

function setupScrollObserver() {
    const sentinel = document.getElementById('monitor-scroll-sentinel');
    if (!sentinel || !window.IntersectionObserver) return;
    monitorState.scrollObserver = new IntersectionObserver(function(entries) {
        if (entries[0].isIntersecting && monitorState.hasMore) {
            loadOlderEvents();
        }
    }, { threshold: 0.1 });
    monitorState.scrollObserver.observe(sentinel);
}

// =========================================
// Controls Setup
// =========================================

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

    // Sound toggle
    const soundBtn = document.getElementById('monitor-sound-btn');
    if (soundBtn) {
        soundBtn.addEventListener('click', function() {
            monitorState.isSoundMuted = !monitorState.isSoundMuted;
            this.textContent = monitorState.isSoundMuted ? '🔇' : '🔊';
            this.title = monitorState.isSoundMuted ? 'Sound off - click to enable ping' : 'Sound on - click to mute';
        });
    }

    // Notification buttons
    updateNotifButtons();
    const notifBtn = document.getElementById('monitor-notif-btn');
    if (notifBtn) {
        notifBtn.addEventListener('click', function() {
            Notification.requestPermission().then(function() {
                updateNotifButtons();
            });
        });
    }
    const notifOnBtn = document.getElementById('monitor-notif-on-btn');
    if (notifOnBtn) {
        notifOnBtn.addEventListener('click', function() {
            sendBrowserNotification([{ emoji: '🔔', description: 'Notifications are working!' }]);
        });
    }

    // Range buttons
    document.querySelectorAll('.range-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.range-btn').forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            monitorState.currentRange = this.dataset.range;
            if (monitorState.soloedTenant) {
                loadDrilldown(monitorState.soloedTenant, monitorState.currentRange);
            } else {
                loadInstanceGraph(monitorState.currentRange);
            }
        });
    });

    // Graph back button
    const backBtn = document.getElementById('monitor-graph-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            exitDrilldown();
        });
    }

    // Sidebar search
    const searchInput = document.getElementById('monitor-sidebar-search');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            monitorState.sidebarSearch = this.value;
            renderTenantSidebar();
        });
    }
}

// =========================================
// Events: fetch, poll, render
// =========================================

async function refreshMonitorEvents() {
    const list = document.getElementById('monitor-events-list');
    if (!list) return;
    list.innerHTML = '<div class="monitor-loading">Loading events...</div>';
    monitorState.events = [];
    monitorState.lastEventTime = null;
    monitorState.oldestEventTime = null;
    monitorState.hasMore = false;

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
        updateLoadMoreIndicator();
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

                // Notifications + audio for visible events
                const notifiable = trulyNew.filter(function(e) {
                    return !monitorState.mutedTenants.includes(e.tenant) &&
                           !(monitorState.hideInternal && INTERNAL_TENANTS.has(e.tenant));
                });
                if (notifiable.length > 0) {
                    sendBrowserNotification(notifiable);
                    if (!monitorState.isSoundMuted) playPing();
                }
            }
        }
        // Update last poll time display
        const pollEl = document.getElementById('monitor-last-poll');
        if (pollEl) {
            pollEl.textContent = new Date().toLocaleTimeString();
        }
    } catch (_err) {
        // silent poll errors
    }
}

async function loadOlderEvents() {
    if (!monitorState.hasMore || !monitorState.oldestEventTime) return;
    const indicator = document.getElementById('monitor-load-more-indicator');
    if (indicator) { indicator.style.display = ''; indicator.textContent = 'Loading older events...'; }

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
        updateLoadMoreIndicator();
    } catch (_err) {
        // ignore
    }
}

function updateLoadMoreIndicator() {
    const indicator = document.getElementById('monitor-load-more-indicator');
    if (!indicator) return;
    if (!monitorState.hasMore && monitorState.events.length > 0) {
        indicator.style.display = '';
        indicator.textContent = '30-day history loaded';
    } else {
        indicator.style.display = 'none';
    }
}

// =========================================
// Mute tenants
// =========================================

function muteTenant(tenant) {
    if (!monitorState.mutedTenants.includes(tenant)) {
        monitorState.mutedTenants.push(tenant);
    }
    renderEvents(monitorState.events);
    renderMutedBar();
}

function unmuteTenant(tenant) {
    monitorState.mutedTenants = monitorState.mutedTenants.filter(function(t) { return t !== tenant; });
    renderEvents(monitorState.events);
    renderMutedBar();
}

function renderMutedBar() {
    const bar = document.getElementById('monitor-muted-bar');
    if (!bar) return;
    if (monitorState.mutedTenants.length === 0) {
        bar.style.display = 'none';
        bar.innerHTML = '';
        return;
    }
    bar.style.display = '';
    bar.innerHTML = '<span class="monitor-muted-label">Muted:</span>' +
        monitorState.mutedTenants.map(function(t) {
            return '<button class="monitor-muted-chip" onclick="unmuteTenant(' + JSON.stringify(t) + ')">' +
                escapeHtml(t) + ' <span>x</span></button>';
        }).join('');
}

// =========================================
// Event rendering
// =========================================

function renderEvents(events) {
    const list = document.getElementById('monitor-events-list');
    if (!list) return;

    const filtered = events.filter(function(e) {
        if (monitorState.mutedTenants.includes(e.tenant)) return false;
        if (monitorState.hideInternal && INTERNAL_TENANTS.has(e.tenant)) return false;
        return true;
    });

    // Update count badge
    const countEl = document.getElementById('monitor-events-count');
    if (countEl) countEl.textContent = events.length > 0 ? '(' + events.length + ')' : '';

    if (filtered.length === 0) {
        list.innerHTML = '<div class="monitor-loading">No events to display.</div>';
        return;
    }

    const html = filtered.map(function(e) {
        // Build description with tenant name as a clickable link
        const tenantJson = JSON.stringify(e.tenant);
        const tenantLink = '<button class="monitor-event-tenant-link" onclick="focusTenant(' + tenantJson + ')" title="View in Instance Graph">' +
            escapeHtml(e.tenant) + '</button>';

        let desc;
        if (e.tenant && e.description && e.description.includes(e.tenant)) {
            const parts = e.description.split(e.tenant);
            desc = parts.map(function(p) { return escapeHtml(p); }).join(tenantLink);
        } else {
            desc = escapeHtml(e.description || '');
        }

        return '<div class="monitor-event-item" ' +
            'onmouseenter="this.querySelector(\'.monitor-event-mute-btn\').style.display=\'\'" ' +
            'onmouseleave="this.querySelector(\'.monitor-event-mute-btn\').style.display=\'none\'">' +
            '<span class="monitor-event-emoji">' + (e.emoji || '•') + '</span>' +
            '<span class="monitor-event-time">' + formatRelativeTime(e.timestamp) + '</span>' +
            '<span class="monitor-event-desc">' + desc + '</span>' +
            '<button class="monitor-event-mute-btn" style="display:none" onclick="muteTenant(' + tenantJson + ')">Mute</button>' +
            '</div>';
    }).join('');

    list.innerHTML = html;
}

// =========================================
// Drilldown
// =========================================

function focusTenant(tenant) {
    monitorState.soloedTenant = tenant;
    updateGraphHeader();
    loadDrilldown(tenant, monitorState.currentRange);
}

function exitDrilldown() {
    monitorState.soloedTenant = null;
    updateGraphHeader();
    loadInstanceGraph(monitorState.currentRange);
    loadCurrentInstances();
}

function updateGraphHeader() {
    const title = document.getElementById('monitor-graph-title');
    const backBtn = document.getElementById('monitor-graph-back-btn');
    if (title) title.textContent = monitorState.soloedTenant || 'Instance Graph';
    if (backBtn) backBtn.style.display = monitorState.soloedTenant ? '' : 'none';
}

async function loadDrilldown(namespace, range) {
    const canvas = document.getElementById('monitor-instance-chart');
    const loadingEl = document.getElementById('monitor-chart-loading');
    if (!canvas || !loadingEl) return;

    loadingEl.style.display = 'flex';
    loadingEl.textContent = 'Loading...';
    canvas.style.display = 'none';

    try {
        const res = await fetch('/api/monitor/instances/drilldown?namespace=' + encodeURIComponent(namespace) + '&range=' + encodeURIComponent(range));
        if (res.status === 503) {
            loadingEl.textContent = 'Monitor not configured on this server.';
            return;
        }
        if (!res.ok) {
            loadingEl.textContent = 'Error loading drilldown (HTTP ' + res.status + ').';
            return;
        }
        const data = await res.json();
        // Normalize: drilldown returns { service, data } - map to { namespace, data }
        const seriesData = (data.series || []).map(function(s) {
            return { namespace: s.service, data: s.data };
        });
        renderChart(seriesData, range, canvas, loadingEl);
        renderTenantSidebarFromSeries(seriesData, false);
    } catch (err) {
        loadingEl.textContent = 'Failed to load drilldown: ' + err.message;
        loadingEl.style.display = 'flex';
    }
}

// =========================================
// Instance graph
// =========================================

async function loadInstanceGraph(range) {
    monitorState.currentRange = range;
    const canvas = document.getElementById('monitor-instance-chart');
    const loadingEl = document.getElementById('monitor-chart-loading');
    if (!canvas || !loadingEl) return;

    loadingEl.style.display = 'flex';
    loadingEl.textContent = 'Loading chart...';
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
        renderChart(seriesData, range, canvas, loadingEl);
        renderTenantSidebarFromSeries(seriesData, true);
    } catch (err) {
        loadingEl.textContent = 'Failed to load graph: ' + err.message;
        loadingEl.style.display = 'flex';
    }
}

async function loadCurrentInstances() {
    const sidebar = document.getElementById('monitor-tenant-sidebar');
    if (!sidebar) return;
    sidebar.innerHTML = '<div class="monitor-loading" style="font-size:12px;padding:12px;">Loading...</div>';

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
        const tenants = (data.tenants || []).map(function(t) {
            return { namespace: t.namespace || t.name, count: t.count };
        });
        renderTenantSidebarFromSeries(tenants, true);
    } catch (_err) {
        sidebar.innerHTML = '<div class="monitor-loading" style="font-size:12px;">Failed to load.</div>';
    }
}

// =========================================
// Chart rendering
// =========================================

function renderChart(seriesData, range, canvas, loadingEl) {
    if (monitorState.chart) {
        monitorState.chart.destroy();
        monitorState.chart = null;
    }

    if (seriesData.length === 0) {
        loadingEl.textContent = 'No data for this time range.';
        return;
    }

    // Assign colors
    monitorState.tenantColors = {};
    seriesData.forEach(function(s, i) {
        monitorState.tenantColors[s.namespace] = CHART_COLORS[i % CHART_COLORS.length];
    });

    // Build unified time axis
    const timeSet = new Set();
    seriesData.forEach(function(s) {
        s.data.forEach(function(d) { timeSet.add(d.time); });
    });
    const sortedTimes = Array.from(timeSet).sort(function(a, b) { return a - b; });

    function formatLabel(ts) {
        const d = new Date(ts);
        if (range === '7d' || range === '48h') {
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
                   d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        }
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    const labels = sortedTimes.map(formatLabel);

    const datasets = seriesData.map(function(s, i) {
        const hex = CHART_COLORS[i % CHART_COLORS.length];
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);

        const lookup = new Map(s.data.map(function(d) { return [d.time, d.value]; }));
        const values = sortedTimes.map(function(t) { return lookup.get(t) || 0; });

        // Delta dots: green where count goes up, red where it drops
        const pointRadii = values.map(function(v, idx) {
            if (idx === 0) return 0;
            const delta = values[idx] - values[idx - 1];
            if (delta === 0) return 0;
            return Math.min(6, Math.max(3, Math.abs(delta) + 2));
        });
        const pointColors = values.map(function(v, idx) {
            if (idx === 0) return 'transparent';
            const delta = values[idx] - values[idx - 1];
            if (delta === 0) return 'transparent';
            return delta > 0 ? '#10b981' : '#ef4444';
        });

        return {
            label: s.namespace,
            data: values,
            backgroundColor: 'rgba(' + r + ',' + g + ',' + b + ',0.35)',
            borderColor: hex,
            borderWidth: 1.5,
            fill: true,
            tension: 0.3,
            pointRadius: pointRadii,
            pointBackgroundColor: pointColors,
            pointBorderColor: '#111827',
            pointBorderWidth: 1.5,
            pointHoverRadius: 0,
        };
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
}

// =========================================
// Sidebar rendering
// =========================================

function renderTenantSidebarFromSeries(seriesData, isTenantMode) {
    const items = seriesData.map(function(s) {
        let count = s.count;
        if (count === undefined && s.data && s.data.length > 0) {
            count = s.data[s.data.length - 1].value;
        }
        return { name: s.namespace, count: count || 0 };
    }).sort(function(a, b) { return b.count - a.count; });

    monitorState._sidebarItems = items;
    monitorState._sidebarIsTenantMode = isTenantMode;
    renderTenantSidebar();
}

function renderTenantSidebar() {
    const sidebar = document.getElementById('monitor-tenant-sidebar');
    if (!sidebar) return;

    const items = monitorState._sidebarItems || [];
    const isTenantMode = monitorState._sidebarIsTenantMode !== false;
    const search = monitorState.sidebarSearch.toLowerCase().trim();

    const filtered = search
        ? items.filter(function(item) { return item.name.toLowerCase().includes(search); })
        : items;

    const label = monitorState.soloedTenant
        ? 'Services (' + items.length + ')'
        : 'Tenants (' + items.length + ')';

    const clickable = isTenantMode && !monitorState.soloedTenant;

    const html = '<div class="monitor-sidebar-label">' + label + '</div>' +
        filtered.map(function(t) {
            const color = monitorState.tenantColors[t.name] || '#6b7280';
            const clickAttr = clickable
                ? ' onclick="focusTenant(' + JSON.stringify(t.name) + ')"'
                : '';
            return '<div class="monitor-tenant-item' + (clickable ? ' monitor-tenant-item--clickable' : '') + '"' + clickAttr + '>' +
                '<span class="monitor-tenant-color-dot" style="background:' + color + '"></span>' +
                '<span class="monitor-tenant-name">' + escapeHtml(t.name) + '</span>' +
                '<span class="monitor-tenant-count">' + (t.count || 0) + '</span>' +
                '</div>';
        }).join('');

    sidebar.innerHTML = html;
}

// =========================================
// Utilities
// =========================================

function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    const ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    const diffMs = Date.now() - ts;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + 'm ago';
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
