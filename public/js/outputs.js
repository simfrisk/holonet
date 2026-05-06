let outputsLoaded = false;
let outputsData = [];
let outputsTaskFilter = '';

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
    container.innerHTML = buttons.join('');
    if (!container.dataset.bound) {
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.outputs-filter-btn');
            if (!btn || !container.contains(btn)) return;
            outputsTaskFilter = btn.dataset.task || '';
            container.querySelectorAll('.outputs-filter-btn').forEach(b => {
                b.classList.toggle('active', (b.dataset.task || '') === outputsTaskFilter);
            });
            renderOutputsList();
        });
        container.dataset.bound = '1';
    }
}

function renderOutputsList() {
    const container = document.getElementById('outputs-list-container');
    const filtered = outputsTaskFilter
        ? outputsData.filter(o => o.agentTask === outputsTaskFilter)
        : outputsData;
    if (!filtered.length) {
        const msg = outputsTaskFilter
            ? `No outputs for "${outputsTaskFilter}".`
            : 'No outputs yet. Agent reports will appear here after each run.';
        container.innerHTML = `<div class="outputs-empty"><p>${msg}</p></div>`;
        return;
    }
    const rows = filtered.map(o => {
        const date = new Date(o.runAt);
        const dateStr = date.toLocaleDateString('en-SE', { year: 'numeric', month: 'short', day: 'numeric' });
        const timeStr = date.toLocaleTimeString('en-SE', { hour: '2-digit', minute: '2-digit' });
        const taskLabel = (o.agentTask || 'agent').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const actionBadge = o.actionItems ? `<span class="output-badge">${o.actionItems} actions</span>` : '';
        return `
            <div class="output-row" onclick="openOutput('${o._id}')">
                <div class="output-row-main">
                    <span class="output-title">${o.title}</span>
                    ${actionBadge}
                </div>
                <div class="output-row-meta">
                    <span class="output-task">${taskLabel}</span>
                    <span class="output-date">${dateStr} at ${timeStr}</span>
                </div>
            </div>
        `;
    }).join('');
    container.innerHTML = `<div class="outputs-list">${rows}</div>`;
}

function openOutput(id) {
    window.open(`/api/outputs/${encodeURIComponent(id)}/content`, '_blank');
}
