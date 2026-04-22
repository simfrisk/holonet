let outputsLoaded = false;
let outputsData = [];

async function loadOutputsTab() {
    const container = document.getElementById('outputs-list-container');
    container.innerHTML = '<p class="outputs-loading">Loading…</p>';
    try {
        const response = await fetch('/api/outputs');
        const data = await response.json();
        outputsData = data.outputs || [];
        outputsLoaded = true;
        renderOutputsList();
    } catch (err) {
        container.innerHTML = '<p style="padding:2rem;color:#ef4444">Failed to load outputs.</p>';
    }
}

function renderOutputsList() {
    const container = document.getElementById('outputs-list-container');
    if (!outputsData.length) {
        container.innerHTML = '<div class="outputs-empty"><p>No outputs yet. Agent reports will appear here after each run.</p></div>';
        return;
    }
    const rows = outputsData.map(o => {
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
