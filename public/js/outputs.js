let outputsLoaded = false;
let outputsData = [];
let outputsTaskFilter = '';
let outputsHideDone = false;

async function loadOutputsTab() {
    const container = document.getElementById('outputs-list-container');
    container.innerHTML = '<p class="outputs-loading">Loading…</p>';
    try {
        const response = await fetch('/api/outputs');
        const data = await response.json();
        outputsData = data.outputs || [];
        outputsLoaded = true;
        populateOutputsTaskFilter();
        renderOutputsList();
    } catch (err) {
        container.innerHTML = '<p style="padding:2rem;color:#ef4444">Failed to load outputs.</p>';
    }
}

function populateOutputsTaskFilter() {
    const container = document.getElementById('outputs-filter-task');
    if (!container) return;
    const tasks = [...new Set(outputsData.map(o => o.agentTask).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (outputsTaskFilter && !tasks.includes(outputsTaskFilter)) {
        outputsTaskFilter = '';
    }
    const labelFor = (t) => t.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const buttons = [
        `<button type="button" class="outputs-filter-btn${outputsTaskFilter === '' ? ' active' : ''}" data-task="">All jobs</button>`,
        ...tasks.map(t => `<button type="button" class="outputs-filter-btn${outputsTaskFilter === t ? ' active' : ''}" data-task="${t}">${labelFor(t)}</button>`)
    ];
    const options = [
        `<option value=""${outputsTaskFilter === '' ? ' selected' : ''}>All jobs</option>`,
        ...tasks.map(t => `<option value="${t}"${outputsTaskFilter === t ? ' selected' : ''}>${labelFor(t)}</option>`)
    ];
    container.innerHTML = `
        <div class="outputs-filter-buttons">${buttons.join('')}</div>
        <select class="outputs-filter-select" aria-label="Filter outputs by job type">${options.join('')}</select>
    `;
    if (!container.dataset.bound) {
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.outputs-filter-btn');
            if (!btn || !container.contains(btn)) return;
            setTaskFilter(btn.dataset.task || '');
        });
        container.addEventListener('change', (e) => {
            const sel = e.target.closest('.outputs-filter-select');
            if (!sel) return;
            setTaskFilter(sel.value || '');
        });
        container.dataset.bound = '1';
    }
}

function setTaskFilter(value) {
    outputsTaskFilter = value;
    const container = document.getElementById('outputs-filter-task');
    if (container) {
        container.querySelectorAll('.outputs-filter-btn').forEach(b => {
            b.classList.toggle('active', (b.dataset.task || '') === outputsTaskFilter);
        });
        const sel = container.querySelector('.outputs-filter-select');
        if (sel) sel.value = outputsTaskFilter;
    }
    renderOutputsList();
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderOutputsList() {
    const container = document.getElementById('outputs-list-container');
    // Detach filter element before innerHTML wipes it (it gets re-attached via moveFilterIntoToolbar)
    const filters = document.getElementById('outputs-filter-task');
    if (filters && container.contains(filters)) {
        document.getElementById('outputs-tab').appendChild(filters);
        filters.setAttribute('hidden', '');
    }
    let filtered = outputsTaskFilter
        ? outputsData.filter(o => o.agentTask === outputsTaskFilter)
        : outputsData.slice();
    if (outputsHideDone) filtered = filtered.filter(o => !o.done);

    const totalCount = outputsData.length;
    const doneCount = outputsData.filter(o => o.done).length;

    const toolbar = `
        <div class="outputs-toolbar">
            <label class="outputs-hide-done">
                <input type="checkbox" id="outputs-hide-done-cb" ${outputsHideDone ? 'checked' : ''}>
                Hide completed
            </label>
            <div class="outputs-toolbar-filters" id="outputs-toolbar-filters-slot"></div>
            <span class="outputs-count">${filtered.length} shown · ${doneCount}/${totalCount} done</span>
        </div>
    `;

    if (!filtered.length) {
        const msg = outputsTaskFilter
            ? `No outputs for "${outputsTaskFilter}".`
            : (outputsHideDone ? 'All outputs are marked done.' : 'No outputs yet. Agent reports will appear here after each run.');
        container.innerHTML = toolbar + `<div class="outputs-empty"><p>${msg}</p></div>`;
        moveFilterIntoToolbar();
        bindOutputsToolbar();
        return;
    }

    const rows = filtered.map(o => {
        const date = new Date(o.runAt);
        const dateStr = date.toLocaleDateString('en-SE', { year: 'numeric', month: 'short', day: 'numeric' });
        const timeStr = date.toLocaleTimeString('en-SE', { hour: '2-digit', minute: '2-digit' });
        const taskLabel = (o.agentTask || 'agent').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const actions = o.actionItems ? `<span class="output-badge">${o.actionItems}</span>` : '';
        const id = escapeHtml(o._id);
        const doneClass = o.done ? ' is-done' : '';
        const unreadClass = o.read ? '' : ' is-unread';
        const dot = o.read ? '' : '<span class="output-unread-dot" title="Unread"></span>';
        return `
            <tr class="output-row${doneClass}${unreadClass}" data-id="${id}">
                <td class="output-done-cell">
                    <input type="checkbox" class="output-done-cb" ${o.done ? 'checked' : ''} title="Mark done">
                </td>
                <td class="output-task-cell">${dot}${escapeHtml(taskLabel)}</td>
                <td class="output-actions-cell">${actions}</td>
                <td class="output-date-cell">${dateStr} <span class="output-time">${timeStr}</span></td>
                <td class="output-row-actions">
                    <button class="output-delete-btn" title="Delete"><i class="ti ti-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = toolbar + `
        <div class="outputs-table-wrapper">
            <table class="outputs-table">
                <thead>
                    <tr>
                        <th style="width:36px;"></th>
                        <th>Job</th>
                        <th style="width:80px;">Actions</th>
                        <th style="width:170px;">Run At</th>
                        <th style="width:48px;"></th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
    moveFilterIntoToolbar();
    bindOutputsToolbar();
    bindOutputsRowEvents();
}

function moveFilterIntoToolbar() {
    const slot = document.getElementById('outputs-toolbar-filters-slot');
    const filters = document.getElementById('outputs-filter-task');
    if (slot && filters && filters.parentElement !== slot) {
        slot.appendChild(filters);
        filters.removeAttribute('hidden');
    }
}

function bindOutputsToolbar() {
    const cb = document.getElementById('outputs-hide-done-cb');
    if (cb) {
        cb.addEventListener('change', () => {
            outputsHideDone = cb.checked;
            renderOutputsList();
        });
    }
}

function bindOutputsRowEvents() {
    const tbody = document.querySelector('.outputs-table tbody');
    if (!tbody) return;

    tbody.addEventListener('click', async (e) => {
        const row = e.target.closest('.output-row');
        if (!row) return;
        const id = row.dataset.id;

        if (e.target.closest('.output-done-cb')) {
            return; // change handler will fire
        }
        if (e.target.closest('.output-delete-btn')) {
            e.stopPropagation();
            confirmDeleteOutput(id);
            return;
        }
        if (e.target.closest('.output-task-cell') || e.target.closest('.output-date-cell')) {
            openOutput(id);
        }
    });

    tbody.addEventListener('change', async (e) => {
        const cb = e.target.closest('.output-done-cb');
        if (!cb) return;
        const row = cb.closest('.output-row');
        const id = row.dataset.id;
        const done = cb.checked;
        try {
            const resp = await fetch(`/api/outputs/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ done })
            });
            if (!resp.ok) {
                const text = await resp.text().catch(() => '');
                console.error('PATCH /api/outputs failed', resp.status, text);
                throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
            }
            const out = outputsData.find(o => o._id === id);
            if (out) out.done = done;
            row.classList.toggle('is-done', done);
            // Update counts in toolbar without full re-render
            const totalCount = outputsData.length;
            const doneCount = outputsData.filter(o => o.done).length;
            const countEl = document.querySelector('.outputs-count');
            if (countEl) {
                const shown = document.querySelectorAll('.outputs-table tbody tr').length;
                countEl.textContent = `${shown} shown · ${doneCount}/${totalCount} done`;
            }
            if (outputsHideDone && done) renderOutputsList();
        } catch (err) {
            cb.checked = !done;
            alert('Could not update done status. ' + (err && err.message ? err.message : ''));
        }
    });
}

function confirmDeleteOutput(id) {
    const out = outputsData.find(o => o._id === id);
    const title = out ? (out.title || '(untitled)') : '';

    let modal = document.getElementById('output-delete-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'output-delete-modal';
        modal.className = 'output-modal-overlay';
        modal.innerHTML = `
            <div class="output-modal">
                <h3>Delete output?</h3>
                <p class="output-modal-body"></p>
                <p class="output-modal-warn">This cannot be undone.</p>
                <div class="output-modal-actions">
                    <button class="output-modal-cancel">Cancel</button>
                    <button class="output-modal-delete">Delete</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    modal.querySelector('.output-modal-body').textContent = title ? `"${title}"` : '';
    modal.style.display = 'flex';

    const cancel = modal.querySelector('.output-modal-cancel');
    const del = modal.querySelector('.output-modal-delete');

    const close = () => { modal.style.display = 'none'; };
    const onCancel = () => { cleanup(); close(); };
    const onDelete = async () => {
        del.disabled = true;
        try {
            const resp = await fetch(`/api/outputs/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (!resp.ok) throw new Error('Failed');
            outputsData = outputsData.filter(o => o._id !== id);
            cleanup();
            close();
            populateOutputsTaskFilter();
            renderOutputsList();
        } catch (err) {
            del.disabled = false;
            alert('Could not delete output.');
        }
    };
    const onKey = (ev) => { if (ev.key === 'Escape') onCancel(); };
    const onBackdrop = (ev) => { if (ev.target === modal) onCancel(); };
    function cleanup() {
        cancel.removeEventListener('click', onCancel);
        del.removeEventListener('click', onDelete);
        document.removeEventListener('keydown', onKey);
        modal.removeEventListener('click', onBackdrop);
    }
    cancel.addEventListener('click', onCancel);
    del.addEventListener('click', onDelete);
    document.addEventListener('keydown', onKey);
    modal.addEventListener('click', onBackdrop);
}

function openOutput(id) {
    window.open(`/api/outputs/${encodeURIComponent(id)}/content`, '_blank');
    markOutputRead(id);
}

async function markOutputRead(id) {
    const out = outputsData.find(o => o._id === id);
    if (!out || out.read) return;
    out.read = true;
    const row = document.querySelector(`.output-row[data-id="${CSS.escape(id)}"]`);
    if (row) {
        row.classList.remove('is-unread');
        const dot = row.querySelector('.output-unread-dot');
        if (dot) dot.remove();
    }
    try {
        await fetch(`/api/outputs/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ read: true })
        });
    } catch (err) {
        out.read = false;
    }
}
