const STORAGE_KEY = 'osc_quick_links';
const THEME_KEY = 'osc_theme';
let pendingDeleteId = null;
let links = [];

// =========================================
// DARK MODE
// =========================================
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('darkModeBtn');
    if (btn) btn.innerHTML = theme === 'dark'
        ? '<i class="ti ti-sun"></i>'
        : '<i class="ti ti-moon"></i>';
}

function toggleDarkMode() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
}

// =========================================
// DATA
// =========================================
function loadLinks() {
    try {
        links = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
        links = [];
    }
}

function saveLinks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
}

// =========================================
// RENDER
// =========================================
function renderCards() {
    const grid = document.getElementById('linksGrid');
    const query = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
    const filtered = query
        ? links.filter(l =>
            l.name.toLowerCase().includes(query) ||
            (l.url || '').toLowerCase().includes(query) ||
            (l.username || '').toLowerCase().includes(query))
        : links;

    if (links.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <i class="ti ti-link"></i>
                <h3>No links yet</h3>
                <p>Click <strong>+ Add Link</strong> to save your first one.</p>
            </div>`;
        return;
    }

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <i class="ti ti-search"></i>
                <h3>No results</h3>
                <p>No links match "<em>${esc(query)}</em>".</p>
            </div>`;
        return;
    }

    grid.innerHTML = filtered.map(buildTile).join('');
}

function buildTile(link) {
    const hasUrl  = link.url && link.url.trim();
    const hasPw   = link.password && link.password.trim();
    const hasUser = link.username && link.username.trim();
    const pwId    = 'pw_' + link.id;

    return `
    <div class="link-tile" id="tile_${link.id}" style="border-top: 3px solid var(--color-primary);">
        <button class="tile-delete-btn" data-action="prompt-delete" data-id="${esc(link.id)}" title="Delete">
            <i class="ti ti-x"></i>
        </button>
        <div class="tile-name">${esc(link.name)}</div>

        <div class="tile-fields">
            ${hasUrl ? `
            <div class="field-row">
                <span class="field-label">URL</span>
                <span class="field-val url-val" title="${esc(link.url)}">${esc(link.url)}</span>
            </div>` : ''}

            ${hasUser ? `
            <div class="field-row">
                <span class="field-label">Username</span>
                <span class="field-val" title="${esc(link.username)}">${esc(link.username)}</span>
                <button class="icon-btn" data-action="copy-user" data-id="${esc(link.id)}" title="Copy"><i class="ti ti-clipboard"></i></button>
            </div>` : ''}

            ${hasPw ? `
            <div class="field-row">
                <span class="field-label">Password</span>
                <div class="pw-wrapper">
                    <span class="field-val" id="${pwId}">••••••••</span>
                    <button class="icon-btn" data-action="toggle-pw" data-id="${esc(link.id)}" data-pw-id="${pwId}" title="Show/hide"><i class="ti ti-eye"></i></button>
                    <button class="icon-btn" data-action="copy-pw" data-id="${esc(link.id)}" title="Copy"><i class="ti ti-clipboard"></i></button>
                </div>
            </div>` : ''}
        </div>

        <div class="tile-actions">
            ${hasUrl ? `<a class="btn btn-success" href="${esc(link.url)}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i> Open</a>` : ''}
            <button class="btn btn-neutral" data-action="open-edit" data-id="${esc(link.id)}"><i class="ti ti-pencil"></i> Edit</button>
        </div>
    </div>`;
}

function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function togglePw(elId, pw, btn) {
    const el = document.getElementById(elId);
    const isHidden = el.textContent === '••••••••';
    if (isHidden) {
        el.textContent = pw;
        btn.innerHTML = '<i class="ti ti-eye-off"></i>';
        btn.title = 'Hide';
    } else {
        el.textContent = '••••••••';
        btn.innerHTML = '<i class="ti ti-eye"></i>';
        btn.title = 'Show';
    }
}

function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = '<i class="ti ti-check"></i>';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerHTML = '<i class="ti ti-clipboard"></i>';
            btn.classList.remove('copied');
        }, 1500);
    });
}

// =========================================
// ADD / EDIT MODAL
// =========================================
function openAddModal() {
    document.getElementById('editModalTitle').textContent = 'Add Link';
    document.getElementById('editCardId').value = '';
    document.getElementById('fieldName').value = '';
    document.getElementById('fieldUrl').value = '';
    document.getElementById('fieldUsername').value = '';
    document.getElementById('fieldPassword').value = '';
    document.getElementById('editModal').classList.add('active');
    setTimeout(() => document.getElementById('fieldName').focus(), 50);
}

function openEditModal(id) {
    const link = links.find(l => l.id === id);
    if (!link) return;
    document.getElementById('editModalTitle').textContent = 'Edit Link';
    document.getElementById('editCardId').value = id;
    document.getElementById('fieldName').value = link.name || '';
    document.getElementById('fieldUrl').value = link.url || '';
    document.getElementById('fieldUsername').value = link.username || '';
    document.getElementById('fieldPassword').value = link.password || '';
    document.getElementById('editModal').classList.add('active');
    setTimeout(() => document.getElementById('fieldName').focus(), 50);
}

function closeEditModal() {
    document.getElementById('editModal').classList.remove('active');
}

function saveCard() {
    const nameInput = document.getElementById('fieldName');
    const name = nameInput.value.trim();
    if (!name) {
        nameInput.classList.add('invalid');
        nameInput.focus();
        setTimeout(() => nameInput.classList.remove('invalid'), 1500);
        return;
    }

    const id = document.getElementById('editCardId').value;
    const data = {
        id: id || Date.now().toString(36) + Math.random().toString(36).slice(2),
        name,
        url: document.getElementById('fieldUrl').value.trim(),
        username: document.getElementById('fieldUsername').value.trim(),
        password: document.getElementById('fieldPassword').value.trim(),
    };

    if (id) {
        const idx = links.findIndex(l => l.id === id);
        if (idx !== -1) links[idx] = data;
    } else {
        links.push(data);
    }

    saveLinks();
    renderCards();
    closeEditModal();
}

// =========================================
// DELETE
// =========================================
function promptDelete(id) {
    const link = links.find(l => l.id === id);
    if (!link) return;
    pendingDeleteId = id;
    document.getElementById('confirmCardName').textContent = link.name;
    document.getElementById('confirmModal').classList.add('active');
}

function closeConfirmModal() {
    pendingDeleteId = null;
    document.getElementById('confirmModal').classList.remove('active');
}

function confirmDelete() {
    if (!pendingDeleteId) return;
    links = links.filter(l => l.id !== pendingDeleteId);
    saveLinks();
    renderCards();
    closeConfirmModal();
}

// =========================================
// EVENTS
// =========================================
document.getElementById('darkModeBtn').addEventListener('click', toggleDarkMode);
document.getElementById('searchInput').addEventListener('input', renderCards);

// Header "Add Link" button (the one with btn-primary in the toolbar)
document.querySelectorAll('.links-toolbar .btn-primary').forEach(btn => {
    btn.addEventListener('click', openAddModal);
});

// Edit modal buttons
document.querySelectorAll('#editModal .modal-close').forEach(b => b.addEventListener('click', closeEditModal));
document.querySelectorAll('#editModal .btn-neutral').forEach(b => b.addEventListener('click', closeEditModal));
document.querySelectorAll('#editModal .modal-footer .btn-primary').forEach(b => b.addEventListener('click', saveCard));

// Confirm modal buttons
document.querySelectorAll('#confirmModal .modal-close').forEach(b => b.addEventListener('click', closeConfirmModal));
document.querySelectorAll('#confirmModal .btn-neutral').forEach(b => b.addEventListener('click', closeConfirmModal));
document.querySelectorAll('#confirmModal .btn-danger').forEach(b => b.addEventListener('click', confirmDelete));

// Event delegation for dynamically rendered tiles
document.getElementById('linksGrid').addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    const link = links.find(l => l.id === id);
    if (!link && (action === 'copy-user' || action === 'copy-pw' || action === 'toggle-pw')) return;
    switch (action) {
        case 'prompt-delete':
            promptDelete(id);
            break;
        case 'open-edit':
            openEditModal(id);
            break;
        case 'copy-user':
            copyText(link.username || '', target);
            break;
        case 'copy-pw':
            copyText(link.password || '', target);
            break;
        case 'toggle-pw':
            togglePw(target.dataset.pwId, link.password || '', target);
            break;
    }
});

document.getElementById('editModal').addEventListener('click', e => {
    if (e.target === document.getElementById('editModal')) closeEditModal();
});
document.getElementById('confirmModal').addEventListener('click', e => {
    if (e.target === document.getElementById('confirmModal')) closeConfirmModal();
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeEditModal(); closeConfirmModal(); }
    if (e.key === 'Enter' && document.getElementById('editModal').classList.contains('active')) saveCard();
});

// =========================================
// INIT
// =========================================
const savedTheme = localStorage.getItem(THEME_KEY) || 'light';
applyTheme(savedTheme);
loadLinks();
renderCards();
