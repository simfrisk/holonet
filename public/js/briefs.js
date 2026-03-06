// =========================================
// DAILY BRIEFS
// =========================================

let briefsData = [];
let briefItemsData = [];
let activeBriefId = null;
let briefsLoaded = false;
let activeBriefView = 'today';

const PRIORITY_ORDER = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const PRIORITY_BORDER = {
    URGENT: 'var(--color-brief-urgent)',
    HIGH:   'var(--color-brief-high)',
    MEDIUM: 'var(--color-brief-medium)',
    LOW:    'var(--color-brief-low)'
};

// =========================================
// LOAD
// =========================================

async function loadBriefTab() {
    if (briefsLoaded) {
        renderBriefTodayView();
        return;
    }
    try {
        const res = await fetch('/api/briefs');
        if (!res.ok) throw new Error('Failed to fetch briefs');
        const data = await res.json();
        briefsData = data.briefs || [];
        briefsLoaded = true;
        updateBriefNavCount();
        renderBriefTodayView();
    } catch (err) {
        console.error('Failed to load briefs:', err);
        const container = document.getElementById('brief-today-content');
        if (container) container.innerHTML = '<p class="load-error">Failed to load briefs. Please try again.</p>';
    }
}

// =========================================
// NAV COUNT
// =========================================

function updateBriefNavCount() {
    const el = document.getElementById('brief-count');
    if (!el) return;
    const todayStr = getTodayStr();
    const todayBrief = briefsData.find(b => b.date === todayStr && !b.archived);
    if (!todayBrief || !todayBrief.totalItems) { el.textContent = ''; return; }
    const incomplete = todayBrief.totalItems - (todayBrief.completedItems || 0);
    el.textContent = incomplete > 0 ? incomplete : '';
}

function getTodayStr() {
    return new Date().toISOString().split('T')[0];
}

// =========================================
// VIEW SWITCHING
// =========================================

function switchBriefView(view) {
    activeBriefView = view;
    document.querySelectorAll('[data-brief-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.briefView === view);
    });
    document.getElementById('brief-today-view').style.display = view === 'today' ? 'block' : 'none';
    document.getElementById('brief-archive-view').style.display = view === 'archive' ? 'block' : 'none';
    if (view === 'archive') renderBriefArchiveView();
}

// =========================================
// TODAY VIEW
// =========================================

async function renderBriefTodayView() {
    const todayStr = getTodayStr();
    const todayBrief = briefsData.find(b => b.date === todayStr && !b.archived);
    const container = document.getElementById('brief-today-content');
    const actionsDiv = document.getElementById('brief-subnav-actions');
    if (!container) return;

    if (!todayBrief) {
        container.innerHTML = buildBriefEmptyState();
        if (actionsDiv) actionsDiv.innerHTML = '';
        return;
    }

    activeBriefId = todayBrief.id;

    try {
        const itemsRes = await fetch(`/api/brief-items?briefId=${todayBrief.id}`);
        if (!itemsRes.ok) throw new Error('Failed to load items');
        const itemsData = await itemsRes.json();
        briefItemsData = itemsData.items || [];
    } catch (err) {
        container.innerHTML = '<p class="load-error">Failed to load action items.</p>';
        return;
    }

    // Update brief counts in memory
    const brief = briefsData.find(b => b.id === todayBrief.id);
    if (brief) {
        brief.totalItems = briefItemsData.length;
        brief.completedItems = briefItemsData.filter(i => i.completed).length;
    }
    updateBriefNavCount();

    container.innerHTML = buildBriefTodayHtml(todayBrief);
    if (actionsDiv) actionsDiv.innerHTML = buildBriefSubnavActions(todayBrief);
    initBriefDragDrop();
}

function buildBriefTodayHtml(brief) {
    const totalItems = briefItemsData.length;
    const completedItems = briefItemsData.filter(i => i.completed).length;

    let html = `<div class="brief-header">
        <div>
            <h2 class="brief-title">Daily Brief &mdash; ${formatBriefDate(brief.date)}</h2>
            <p class="brief-meta">${brief.generatedAt ? 'Generated ' + formatBriefTime(brief.generatedAt) + ' &middot; ' : ''}${completedItems}/${totalItems} complete</p>
        </div>
        <button class="new-draft-btn" onclick="openBriefItemModal(null, '${escAttr(brief.id)}')">
            <i class="ti ti-plus"></i> Add Item
        </button>
    </div>`;

    if (brief.metricsSnapshot && Object.keys(brief.metricsSnapshot).length > 0) {
        html += buildMetricsSnapshotHtml(brief.metricsSnapshot);
    }

    const activeItems = briefItemsData.filter(i => !i.archived);
    const priorityGroups = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
    let hasAny = false;

    for (const priority of priorityGroups) {
        const group = activeItems
            .filter(i => i.priority === priority)
            .sort((a, b) => {
                // Incomplete first, then by sortOrder
                if (a.completed !== b.completed) return a.completed ? 1 : -1;
                return (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999);
            });
        if (group.length === 0) continue;
        hasAny = true;

        const incompleteCount = group.filter(i => !i.completed).length;
        html += `<div class="brief-priority-section" data-priority="${priority}">
            <div class="brief-priority-header">
                <span class="brief-priority-label brief-label-${priority.toLowerCase()}">${priority}</span>
                <span class="brief-priority-count">${incompleteCount}/${group.length}</span>
            </div>
            <div class="brief-items-list" id="brief-list-${priority}">
                ${group.map(item => buildBriefItemHtml(item)).join('')}
            </div>
        </div>`;
    }

    if (!hasAny) {
        html += `<div class="brief-all-done">
            <i class="ti ti-circle-check" style="font-size:48px;color:var(--color-brief-low)"></i>
            <h3>All done for today!</h3>
            <p>No action items remain.</p>
        </div>`;
    }

    return html;
}

function buildBriefItemHtml(item) {
    const completedClass = item.completed ? 'brief-item-completed' : '';
    const borderColor = PRIORITY_BORDER[item.priority] || 'var(--color-border)';
    const hasDesc = item.description && item.description.trim();

    return `<div class="brief-item ${completedClass}" data-brief-item-id="${escAttr(item.id)}" draggable="true"
              style="border-left-color:${borderColor}">
        <span class="brief-drag-handle" title="Drag to reorder"><i class="ti ti-grip-vertical"></i></span>
        <input type="checkbox" class="brief-checkbox" ${item.completed ? 'checked' : ''}
               onchange="toggleBriefItemComplete('${escAttr(item.id)}', this.checked)">
        <div class="brief-item-body">
            <div class="brief-item-title">${escHtml(item.title)}</div>
            ${hasDesc ? `<button class="brief-expand-btn" onclick="toggleBriefItemExpand(this)">
                <i class="ti ti-chevron-down"></i> show more
            </button>
            <div class="brief-item-desc" style="display:none">${escHtml(item.description)}</div>` : ''}
        </div>
        ${item.source ? `<span class="brief-source-chip">${escHtml(item.source)}</span>` : ''}
        <div class="brief-item-actions">
            <button class="brief-action-btn" onclick="openBriefItemModal('${escAttr(item.id)}', null)"
                    title="Edit"><i class="ti ti-pencil"></i></button>
            <button class="brief-action-btn brief-action-danger"
                    onclick="deleteBriefItem('${escAttr(item.id)}')"
                    title="Delete"><i class="ti ti-trash"></i></button>
        </div>
    </div>`;
}

function buildBriefSubnavActions(brief) {
    return `<button class="brief-archive-brief-btn" onclick="archiveTodayBrief('${escAttr(brief.id)}')" title="Move this brief to the archive">
        <i class="ti ti-archive"></i> Archive Brief
    </button>`;
}

function buildBriefEmptyState() {
    const todayId = `brief-${getTodayStr()}`;
    return `<div class="brief-empty-state">
        <i class="ti ti-calendar" style="font-size:48px;color:var(--color-text-muted)"></i>
        <h3>No brief for today</h3>
        <p>The planner agent will post today's brief here after running the daily check.</p>
        <button class="new-draft-btn" style="margin-top:12px" onclick="openBriefItemModal(null, '${escAttr(todayId)}')">
            <i class="ti ti-plus"></i> Add Item Manually
        </button>
    </div>`;
}

function buildMetricsSnapshotHtml(metrics) {
    const entries = Object.entries(metrics).slice(0, 5);
    if (entries.length === 0) return '';
    return `<div class="brief-metrics-row">
        ${entries.map(([k, v]) => `<div class="brief-metric-chip">
            <span class="brief-metric-value">${escHtml(String(v))}</span>
            <span class="brief-metric-label">${escHtml(k)}</span>
        </div>`).join('')}
    </div>`;
}

// =========================================
// ARCHIVE VIEW
// =========================================

function renderBriefArchiveView() {
    const container = document.getElementById('brief-archive-list');
    if (!container) return;
    const archived = briefsData.filter(b => b.archived).sort((a, b) => b.date.localeCompare(a.date));

    if (archived.length === 0) {
        container.innerHTML = `<div class="brief-empty-state">
            <h3>No archived briefs</h3>
            <p>Archive today's brief when you're done with it.</p>
        </div>`;
        return;
    }

    container.innerHTML = archived.map(brief => `
        <div class="brief-archive-row">
            <div class="brief-archive-info">
                <strong>${formatBriefDate(brief.date)}</strong>
                <span class="brief-archive-meta">${brief.completedItems || 0}/${brief.totalItems || 0} completed</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
                <button class="brief-restore-btn" onclick="unarchiveBrief('${escAttr(brief.id)}')">
                    <i class="ti ti-arrow-back-up"></i> Restore
                </button>
                <button class="brief-restore-btn brief-action-danger" onclick="deleteBriefFull('${escAttr(brief.id)}')" title="Delete permanently">
                    <i class="ti ti-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

// =========================================
// ACTIONS
// =========================================

async function toggleBriefItemComplete(id, completed) {
    try {
        const res = await fetch(`/api/brief-items/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed })
        });
        if (!res.ok) throw new Error('Failed');
        const item = briefItemsData.find(i => i.id === id);
        if (item) {
            item.completed = completed;
            item.completedAt = completed ? new Date().toISOString() : null;
        }
        // Update counts in briefsData
        const brief = briefsData.find(b => b.id === activeBriefId);
        if (brief) brief.completedItems = briefItemsData.filter(i => i.completed).length;
        updateBriefNavCount();
        renderBriefTodayView();
    } catch (err) {
        console.error('Failed to toggle brief item:', err);
    }
}

async function deleteBriefItem(id) {
    if (!confirm('Delete this action item?')) return;
    try {
        const res = await fetch(`/api/brief-items/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed');
        briefItemsData = briefItemsData.filter(i => i.id !== id);
        const brief = briefsData.find(b => b.id === activeBriefId);
        if (brief) {
            brief.totalItems = briefItemsData.length;
            brief.completedItems = briefItemsData.filter(i => i.completed).length;
        }
        updateBriefNavCount();
        renderBriefTodayView();
    } catch (err) {
        console.error('Failed to delete brief item:', err);
    }
}

async function archiveTodayBrief(briefId) {
    if (!confirm("Archive today's brief? It will move to the Archive view.")) return;
    try {
        const res = await fetch(`/api/briefs/${briefId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ archived: true })
        });
        if (!res.ok) throw new Error('Failed');
        const brief = briefsData.find(b => b.id === briefId);
        if (brief) brief.archived = true;
        activeBriefId = null;
        briefItemsData = [];
        updateBriefNavCount();
        renderBriefTodayView();
    } catch (err) {
        console.error('Failed to archive brief:', err);
    }
}

async function unarchiveBrief(briefId) {
    try {
        const res = await fetch(`/api/briefs/${briefId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ archived: false })
        });
        if (!res.ok) throw new Error('Failed');
        const brief = briefsData.find(b => b.id === briefId);
        if (brief) brief.archived = false;
        renderBriefArchiveView();
        updateBriefNavCount();
    } catch (err) {
        console.error('Failed to unarchive brief:', err);
    }
}

async function deleteBriefFull(briefId) {
    if (!confirm('Permanently delete this brief and all its items? This cannot be undone.')) return;
    try {
        const res = await fetch(`/api/briefs/${briefId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed');
        briefsData = briefsData.filter(b => b.id !== briefId);
        renderBriefArchiveView();
    } catch (err) {
        console.error('Failed to delete brief:', err);
    }
}

// =========================================
// MODAL
// =========================================

let briefItemModalBriefId = null;

function openBriefItemModal(itemId, briefId) {
    briefItemModalBriefId = briefId || activeBriefId || `brief-${getTodayStr()}`;
    const modal = document.getElementById('briefItemModal');
    const editIdEl = document.getElementById('briefItemEditId');
    const titleEl = document.getElementById('briefItemModalTitle');
    const submitBtn = document.getElementById('briefItemSubmitBtn');
    const errorEl = document.getElementById('briefItemError');
    if (!modal) return;
    errorEl.style.display = 'none';

    if (itemId) {
        const item = briefItemsData.find(i => i.id === itemId);
        if (!item) return;
        editIdEl.value = itemId;
        titleEl.textContent = 'Edit Action Item';
        submitBtn.textContent = 'Save Changes';
        document.getElementById('briefItemPriority').value = item.priority || 'HIGH';
        document.getElementById('briefItemTitle').value = item.title || '';
        document.getElementById('briefItemDesc').value = item.description || '';
        document.getElementById('briefItemSource').value = item.source || '';
    } else {
        editIdEl.value = '';
        titleEl.textContent = 'Add Action Item';
        submitBtn.textContent = 'Add Item';
        document.getElementById('briefItemPriority').value = 'HIGH';
        document.getElementById('briefItemTitle').value = '';
        document.getElementById('briefItemDesc').value = '';
        document.getElementById('briefItemSource').value = '';
    }

    modal.style.display = 'block';
    setTimeout(() => document.getElementById('briefItemTitle').focus(), 50);
}

function closeBriefItemModal() {
    const modal = document.getElementById('briefItemModal');
    if (modal) modal.style.display = 'none';
}

async function submitBriefItem() {
    const editId = document.getElementById('briefItemEditId').value;
    const priority = document.getElementById('briefItemPriority').value;
    const titleVal = document.getElementById('briefItemTitle').value.trim();
    const desc = document.getElementById('briefItemDesc').value.trim();
    const source = document.getElementById('briefItemSource').value.trim();
    const errorEl = document.getElementById('briefItemError');
    const submitBtn = document.getElementById('briefItemSubmitBtn');

    if (!titleVal) {
        errorEl.textContent = 'Title is required.';
        errorEl.style.display = 'block';
        return;
    }

    submitBtn.disabled = true;
    errorEl.style.display = 'none';

    try {
        if (editId) {
            const res = await fetch(`/api/brief-items/${editId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ priority, title: titleVal, description: desc, source })
            });
            if (!res.ok) throw new Error('Failed to update');
            const item = briefItemsData.find(i => i.id === editId);
            if (item) { item.priority = priority; item.title = titleVal; item.description = desc; item.source = source; }
        } else {
            const res = await fetch('/api/brief-items', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ briefId: briefItemModalBriefId, priority, title: titleVal, description: desc, source })
            });
            if (!res.ok) throw new Error('Failed to create');
            const newData = await res.json();
            briefItemsData.push(newData.item);

            // If we created the brief on the fly, refresh briefsData
            if (!briefsData.find(b => b.id === briefItemModalBriefId)) {
                const briefsRes = await fetch('/api/briefs');
                if (briefsRes.ok) {
                    const d = await briefsRes.json();
                    briefsData = d.briefs || [];
                    activeBriefId = briefItemModalBriefId;
                }
            }
        }
        closeBriefItemModal();
        renderBriefTodayView();
        updateBriefNavCount();
    } catch (err) {
        errorEl.textContent = 'Save failed. Please try again.';
        errorEl.style.display = 'block';
        console.error(err);
    } finally {
        submitBtn.disabled = false;
    }
}

// =========================================
// HELPERS
// =========================================

function formatBriefDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatBriefTime(isoStr) {
    if (!isoStr) return '';
    try {
        return new Date(isoStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch { return ''; }
}

function toggleBriefItemExpand(btn) {
    const desc = btn.nextElementSibling;
    if (!desc) return;
    const isOpen = desc.style.display !== 'none';
    desc.style.display = isOpen ? 'none' : 'block';
    btn.innerHTML = isOpen ? '<i class="ti ti-chevron-down"></i> show more' : '<i class="ti ti-chevron-up"></i> show less';
}

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escAttr(str) {
    if (!str) return '';
    return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// =========================================
// DRAG-DROP REORDER
// =========================================

let briefDragSrcId = null;

function initBriefDragDrop() {
    document.querySelectorAll('.brief-item[draggable]').forEach(el => {
        el.addEventListener('dragstart', onBriefDragStart);
        el.addEventListener('dragend', onBriefDragEnd);
        el.addEventListener('dragover', onBriefDragOver);
        el.addEventListener('dragleave', onBriefDragLeave);
        el.addEventListener('drop', onBriefDrop);
    });
}

function onBriefDragStart(e) {
    briefDragSrcId = this.dataset.briefItemId;
    this.classList.add('brief-item-dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function onBriefDragEnd() {
    briefDragSrcId = null;
    document.querySelectorAll('.brief-item').forEach(i => {
        i.classList.remove('brief-item-dragging', 'brief-item-drag-over');
    });
}

function onBriefDragOver(e) {
    e.preventDefault();
    if (this.dataset.briefItemId !== briefDragSrcId) this.classList.add('brief-item-drag-over');
}

function onBriefDragLeave() {
    this.classList.remove('brief-item-drag-over');
}

async function onBriefDrop(e) {
    e.preventDefault();
    this.classList.remove('brief-item-drag-over');
    const targetId = this.dataset.briefItemId;
    if (!briefDragSrcId || briefDragSrcId === targetId) return;

    const srcItem = briefItemsData.find(i => i.id === briefDragSrcId);
    if (!srcItem) return;
    const priority = srcItem.priority;

    // Only reorder within same priority group
    let group = briefItemsData
        .filter(i => i.priority === priority && !i.archived)
        .sort((a, b) => {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            return (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999);
        });

    const srcIdx = group.findIndex(i => i.id === briefDragSrcId);
    const tgtIdx = group.findIndex(i => i.id === targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;

    const moved = group.splice(srcIdx, 1)[0];
    group.splice(tgtIdx, 0, moved);

    const order = group.map((item, i) => ({ id: item.id, sortOrder: i * 10 }));
    order.forEach(({ id, sortOrder }) => {
        const item = briefItemsData.find(i => i.id === id);
        if (item) item.sortOrder = sortOrder;
    });

    // Re-render just this priority group's list
    const listEl = document.getElementById(`brief-list-${priority}`);
    if (listEl) {
        listEl.innerHTML = group.map(i => buildBriefItemHtml(i)).join('');
        // Re-attach drag events to the updated nodes
        listEl.querySelectorAll('.brief-item[draggable]').forEach(el => {
            el.addEventListener('dragstart', onBriefDragStart);
            el.addEventListener('dragend', onBriefDragEnd);
            el.addEventListener('dragover', onBriefDragOver);
            el.addEventListener('dragleave', onBriefDragLeave);
            el.addEventListener('drop', onBriefDrop);
        });
    }

    try {
        await fetch('/api/brief-items/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order })
        });
    } catch (err) {
        console.error('Failed to persist brief item order:', err);
    }
}
