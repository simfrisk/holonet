        // =========================================
        // QUICK LINKS
        // =========================================

        const LINKS_STORAGE_KEY = 'osc_quick_links';
        let linksData = [];
        let linkPendingDeleteId = null;

        function loadLinksData() {
            try {
                linksData = JSON.parse(localStorage.getItem(LINKS_STORAGE_KEY)) || [];
            } catch (e) {
                linksData = [];
            }
        }

        function saveLinksData() {
            localStorage.setItem(LINKS_STORAGE_KEY, JSON.stringify(linksData));
        }

        function renderLinksGrid() {
            const grid = document.getElementById('links-grid');
            if (!grid) return;

            const query = (document.getElementById('links-search')?.value || '').toLowerCase().trim();
            const filtered = query
                ? linksData.filter(l =>
                    l.name.toLowerCase().includes(query) ||
                    (l.url || '').toLowerCase().includes(query) ||
                    (l.username || '').toLowerCase().includes(query))
                : linksData;

            if (linksData.length === 0) {
                grid.innerHTML = `<div class="drafts-empty-state">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
                    </svg>
                    <h3>No quick links yet</h3>
                    <p>Click &ldquo;+ Add Link&rdquo; to save your first one.</p>
                </div>`;
                return;
            }

            if (filtered.length === 0) {
                grid.innerHTML = `<div class="drafts-empty-state">
                    <i class="ti ti-search" style="font-size:2em;color:var(--color-text-subtle);"></i>
                    <h3>No results</h3>
                    <p>No links match &ldquo;${escapeHtml(query)}&rdquo;.</p>
                </div>`;
                return;
            }

            grid.innerHTML = filtered.map(link => buildLinkTileHtml(link)).join('');
        }

        function buildLinkTileHtml(link) {
            const hasUrl  = link.url && link.url.trim();
            const hasPw   = link.password && link.password.trim();
            const hasUser = link.username && link.username.trim();
            const pwId    = 'lpw_' + link.id;

            return `<div class="draft-tile" data-link-id="${escapeHtml(link.id)}" style="border-top:3px solid var(--color-primary);">
                <div class="draft-tile-top" style="display:flex;justify-content:space-between;align-items:flex-start;">
                    <p class="draft-tile-subject" style="margin:0;flex:1;">${escapeHtml(link.name)}</p>
                    <button class="draft-delete-btn" onclick="promptLinkDelete('${escapeAttr(link.id)}')"
                        title="Delete link" style="margin-left:8px;flex-shrink:0;">
                        <i class="ti ti-x"></i>
                    </button>
                </div>

                <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px;">
                    ${hasUrl ? `
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:11px;color:var(--color-text-subtle);font-weight:600;text-transform:uppercase;letter-spacing:.04em;min-width:68px;">URL</span>
                        <span style="font-size:12px;color:var(--color-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(link.url)}">${escapeHtml(link.url)}</span>
                    </div>` : ''}

                    ${hasUser ? `
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:11px;color:var(--color-text-subtle);font-weight:600;text-transform:uppercase;letter-spacing:.04em;min-width:68px;">Username</span>
                        <span style="font-size:12px;color:var(--color-text-muted);background:var(--color-surface);border:1px solid var(--color-border);border-radius:4px;padding:2px 7px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;">${escapeHtml(link.username)}</span>
                        <button class="draft-copy-btn copy-subject-btn link-icon-btn" onclick="copyLinkField('${escapeAttr(link.id)}','username',this)" title="Copy username"><i class="ti ti-clipboard"></i></button>
                    </div>` : ''}

                    ${hasPw ? `
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:11px;color:var(--color-text-subtle);font-weight:600;text-transform:uppercase;letter-spacing:.04em;min-width:68px;">Password</span>
                        <span id="${pwId}" style="font-size:12px;color:var(--color-text-muted);background:var(--color-surface);border:1px solid var(--color-border);border-radius:4px;padding:2px 7px;flex:1;font-family:monospace;letter-spacing:.1em;">••••••••</span>
                        <button class="draft-copy-btn link-icon-btn" onclick="toggleLinkPw('${pwId}','${escapeAttr(link.password)}',this)" title="Show/hide password">
                            <i class="ti ti-eye"></i>
                        </button>
                        <button class="draft-copy-btn copy-body-btn link-icon-btn" onclick="copyLinkField('${escapeAttr(link.id)}','password',this)" title="Copy password"><i class="ti ti-clipboard"></i></button>
                    </div>` : ''}
                </div>

                <div class="draft-tile-actions" style="margin-top:8px;">
                    ${hasUrl ? `<a class="draft-copy-btn copy-subject-btn" href="${escapeHtml(link.url)}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center;gap:4px;">
                        <i class="ti ti-external-link"></i> Open</a>` : ''}
                    <button class="draft-edit-btn" onclick="openLinkModal('${escapeAttr(link.id)}')" title="Edit link">
                        <i class="ti ti-pencil"></i>
                    </button>
                </div>
            </div>`;
        }

        function toggleLinkPw(elId, pw, btn) {
            const el = document.getElementById(elId);
            const icon = btn.querySelector('i');
            if (el.textContent === '••••••••') {
                el.textContent = pw;
                el.style.letterSpacing = 'normal';
                if (icon) { icon.classList.remove('ti-eye'); icon.classList.add('ti-eye-off'); }
            } else {
                el.textContent = '••••••••';
                el.style.letterSpacing = '.1em';
                if (icon) { icon.classList.remove('ti-eye-off'); icon.classList.add('ti-eye'); }
            }
        }

        function copyLinkField(linkId, field, btn) {
            const link = linksData.find(l => l.id === linkId);
            if (!link) return;
            const text = field === 'username' ? (link.username || '') : (link.password || '');

            try {
                navigator.clipboard.writeText(text);
            } catch (e) {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }

            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="ti ti-check"></i>';
            btn.classList.add('copied');
            setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1500);
        }

        // =========================================
        // ADD / EDIT MODAL
        // =========================================
        function openLinkModal(id) {
            const modal = document.getElementById('linkModal');
            const title = document.getElementById('linkModalTitle');
            document.getElementById('linkEditId').value = id || '';

            if (id) {
                const link = linksData.find(l => l.id === id);
                if (!link) return;
                title.textContent = 'Edit Link';
                document.getElementById('linkFieldName').value = link.name || '';
                document.getElementById('linkFieldUrl').value = link.url || '';
                document.getElementById('linkFieldUsername').value = link.username || '';
                document.getElementById('linkFieldPassword').value = link.password || '';
            } else {
                title.textContent = 'Add Link';
                document.getElementById('linkFieldName').value = '';
                document.getElementById('linkFieldUrl').value = '';
                document.getElementById('linkFieldUsername').value = '';
                document.getElementById('linkFieldPassword').value = '';
            }

            modal.style.display = 'block';
            setTimeout(() => document.getElementById('linkFieldName').focus(), 50);
        }

        function closeLinkModal() {
            document.getElementById('linkModal').style.display = 'none';
        }

        function saveLinkCard() {
            const nameInput = document.getElementById('linkFieldName');
            const name = nameInput.value.trim();
            if (!name) {
                nameInput.style.borderColor = 'var(--color-danger)';
                nameInput.focus();
                setTimeout(() => nameInput.style.borderColor = '', 1500);
                return;
            }

            const id = document.getElementById('linkEditId').value;
            const data = {
                id: id || Date.now().toString(36) + Math.random().toString(36).slice(2),
                name,
                url: document.getElementById('linkFieldUrl').value.trim(),
                username: document.getElementById('linkFieldUsername').value.trim(),
                password: document.getElementById('linkFieldPassword').value.trim(),
            };

            if (id) {
                const idx = linksData.findIndex(l => l.id === id);
                if (idx !== -1) linksData[idx] = data;
            } else {
                linksData.push(data);
            }

            saveLinksData();
            renderLinksGrid();
            closeLinkModal();
        }

        // =========================================
        // DELETE
        // =========================================
        function promptLinkDelete(id) {
            const link = linksData.find(l => l.id === id);
            if (!link) return;
            linkPendingDeleteId = id;
            document.getElementById('linkConfirmName').textContent = link.name;
            document.getElementById('linkConfirmModal').style.display = 'block';
        }

        function closeLinkConfirmModal() {
            linkPendingDeleteId = null;
            document.getElementById('linkConfirmModal').style.display = 'none';
        }

        function confirmLinkDelete() {
            if (!linkPendingDeleteId) return;
            linksData = linksData.filter(l => l.id !== linkPendingDeleteId);
            saveLinksData();
            renderLinksGrid();
            closeLinkConfirmModal();
        }

        // Load data on init
        loadLinksData();
