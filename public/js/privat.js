let privatItemsData = [];
let privatLastChecked = null;
let privatShowResolved = false;

async function loadPrivatTab() {
    const container = document.getElementById('privat-items');
    if (container) container.innerHTML = '<p class="privat-empty">Loading…</p>';
    try {
        const res = await fetch('/api/privat');
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();
        privatItemsData = data.items || [];
        privatLastChecked = data.lastGmailCheckAt || null;
        privatLoaded = true;
        updatePrivatCount();
        renderPrivat();
    } catch (err) {
        console.error('Failed to load privat items:', err);
        if (container) container.innerHTML = '<p class="privat-empty" style="color:var(--color-danger);">Failed to load privat items.</p>';
    }
}

function updatePrivatCount() {
    const el = document.getElementById('privat-count');
    if (!el) return;
    const unresolved = privatItemsData.filter(i => !i.resolved).length;
    el.textContent = unresolved;
}

function escapePrivatHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function privatRelativeTime(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    if (d === 1) return 'yesterday';
    if (d < 7) return `${d}d ago`;
    const w = Math.floor(d / 7);
    if (w < 5) return `${w}w ago`;
    const date = new Date(iso);
    return date.toLocaleDateString();
}

function privatPriorityKey(p) {
    if (p === 'action_needed') return 'action';
    if (p === 'review') return 'review';
    return 'info';
}

function privatPriorityLabel(p) {
    if (p === 'action_needed') return 'Action';
    if (p === 'review') return 'Review';
    return 'Info';
}

function renderPrivat() {
    const container = document.getElementById('privat-items');
    const subtitle = document.getElementById('privat-last-checked');
    if (subtitle) {
        subtitle.textContent = privatLastChecked
            ? `Last checked: ${new Date(privatLastChecked).toLocaleString()}`
            : 'Last checked: never';
    }
    if (!container) return;

    const unresolved = privatItemsData.filter(i => !i.resolved);
    const resolved = privatItemsData.filter(i => i.resolved);

    if (unresolved.length === 0 && resolved.length === 0) {
        container.innerHTML = '<p class="privat-empty">No privat items yet. The Gmail agent will push items here when something needs your attention.</p>';
        return;
    }

    const groups = [
        { key: 'action_needed', title: 'Action needed' },
        { key: 'review', title: 'For review' },
        { key: 'info', title: 'Info' }
    ];

    const sortByReceived = (a, b) => {
        const aT = new Date(a.receivedAt || a.createdAt || 0).getTime();
        const bT = new Date(b.receivedAt || b.createdAt || 0).getTime();
        return bT - aT;
    };

    let html = '';
    groups.forEach(g => {
        const items = unresolved.filter(i => (i.priority || 'review') === g.key).sort(sortByReceived);
        if (items.length === 0) return;
        html += `<div class="privat-group">
            <p class="privat-group-title">${g.title} (${items.length})</p>
            <div class="privat-list">${items.map(renderPrivatItem).join('')}</div>
        </div>`;
    });

    if (resolved.length > 0) {
        html += `<button class="privat-resolved-toggle" onclick="togglePrivatResolvedView()">
            ${privatShowResolved ? 'Hide' : 'Show'} resolved (${resolved.length})
        </button>`;
        if (privatShowResolved) {
            const sorted = resolved.slice().sort((a, b) => {
                const aT = new Date(a.resolvedAt || a.receivedAt || 0).getTime();
                const bT = new Date(b.resolvedAt || b.receivedAt || 0).getTime();
                return bT - aT;
            });
            html += `<div class="privat-group">
                <p class="privat-group-title">Resolved</p>
                <div class="privat-list">${sorted.map(renderPrivatItem).join('')}</div>
            </div>`;
        }
    }

    if (!html) {
        html = '<p class="privat-empty">All clear. No items need your attention.</p>';
    }

    container.innerHTML = html;
}

function renderPrivatItem(item) {
    const pkey = privatPriorityKey(item.priority);
    const plabel = privatPriorityLabel(item.priority);
    const senderLine = item.senderName
        ? `${escapePrivatHtml(item.senderName)} <span style="opacity:0.7">&lt;${escapePrivatHtml(item.sender || '')}&gt;</span>`
        : escapePrivatHtml(item.sender || '');
    const tagsHtml = (item.tags || []).length
        ? `<span class="privat-tags">${item.tags.map(t => `<span class="privat-tag">${escapePrivatHtml(t)}</span>`).join('')}</span>`
        : '';
    const checked = item.resolved ? 'checked' : '';
    const itemClass = `privat-item priority-${pkey} ${item.resolved ? 'resolved' : ''}`;
    return `<div class="${itemClass}" data-id="${escapePrivatHtml(item.id)}">
        <input type="checkbox" class="privat-checkbox" ${checked}
               onchange="togglePrivatResolved('${escapePrivatHtml(item.id)}', this.checked)"
               title="${item.resolved ? 'Mark as unresolved' : 'Mark as resolved'}">
        <span class="privat-priority-badge priority-${pkey}">${plabel}</span>
        <div class="privat-body">
            <div class="privat-line1"><span class="privat-sender">${senderLine}</span></div>
            <div class="privat-subject">${escapePrivatHtml(item.subject || '(no subject)')}${tagsHtml}</div>
            ${item.snippet ? `<div class="privat-snippet">${escapePrivatHtml(item.snippet)}</div>` : ''}
        </div>
        <div class="privat-time" title="${escapePrivatHtml(item.receivedAt || '')}">${privatRelativeTime(item.receivedAt)}</div>
    </div>`;
}

function togglePrivatResolvedView() {
    privatShowResolved = !privatShowResolved;
    renderPrivat();
}

async function togglePrivatResolved(id, resolved) {
    const item = privatItemsData.find(i => i.id === id);
    if (item) {
        item.resolved = resolved;
        item.resolvedAt = resolved ? new Date().toISOString() : null;
    }
    updatePrivatCount();
    renderPrivat();

    try {
        const res = await fetch(`/api/privat/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resolved })
        });
        if (!res.ok) throw new Error('Failed to update');
    } catch (err) {
        console.error('Failed to update privat item:', err);
        if (item) {
            item.resolved = !resolved;
            item.resolvedAt = !resolved ? new Date().toISOString() : null;
        }
        updatePrivatCount();
        renderPrivat();
    }
}
