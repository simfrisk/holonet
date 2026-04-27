        // =========================================
        // QUICK LINKS
        // =========================================

        const LINKS_STORAGE_KEY = 'osc_quick_links';
        const LINKS_MIGRATED_KEY = 'osc_quick_links_migrated_v1';
        let linksData = [];
        let linksLoaded = false;
        let linkPendingDeleteId = null;

        async function loadLinksData() {
            let apiOk = false;
            try {
                const res = await fetch('/api/links');
                if (res.ok) {
                    const data = await res.json();
                    linksData = data.links || [];
                    apiOk = true;
                }
            } catch (e) {
                linksData = [];
            }

            // One-time migration from localStorage → DB. Only run if API is reachable
            // so we don't drop localStorage data when the server is down.
            if (apiOk && !localStorage.getItem(LINKS_MIGRATED_KEY)) {
                let local = [];
                try { local = JSON.parse(localStorage.getItem(LINKS_STORAGE_KEY)) || []; } catch (e) {}
                let allOk = true;
                if (local.length > 0 && linksData.length === 0) {
                    for (const link of local) {
                        try {
                            const res = await fetch('/api/links', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    name: link.name || 'Untitled',
                                    url: link.url || '',
                                    username: link.username || '',
                                    password: link.password || ''
                                })
                            });
                            if (res.ok) {
                                const data = await res.json();
                                linksData.push(data.link);
                            } else {
                                allOk = false;
                            }
                        } catch (e) { allOk = false; }
                    }
                }
                if (allOk) {
                    localStorage.setItem(LINKS_MIGRATED_KEY, '1');
                    localStorage.removeItem(LINKS_STORAGE_KEY);
                }
            }

            linksLoaded = true;
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

        async function saveLinkCard() {
            const nameInput = document.getElementById('linkFieldName');
            const name = nameInput.value.trim();
            if (!name) {
                nameInput.style.borderColor = 'var(--color-danger)';
                nameInput.focus();
                setTimeout(() => nameInput.style.borderColor = '', 1500);
                return;
            }

            const id = document.getElementById('linkEditId').value;
            const payload = {
                name,
                url: document.getElementById('linkFieldUrl').value.trim(),
                username: document.getElementById('linkFieldUsername').value.trim(),
                password: document.getElementById('linkFieldPassword').value.trim(),
            };

            try {
                if (id) {
                    const res = await fetch(`/api/links/${id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (!res.ok) throw new Error('Failed');
                    const data = await res.json();
                    const idx = linksData.findIndex(l => l.id === id);
                    if (idx !== -1) linksData[idx] = data.link;
                } else {
                    const res = await fetch('/api/links', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (!res.ok) throw new Error('Failed');
                    const data = await res.json();
                    linksData.push(data.link);
                }
                renderLinksGrid();
                closeLinkModal();
            } catch (err) {
                console.error('Failed to save link:', err);
                alert('Could not save link. Check your connection and try again.');
            }
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

        async function confirmLinkDelete() {
            if (!linkPendingDeleteId) return;
            const id = linkPendingDeleteId;
            try {
                const res = await fetch(`/api/links/${id}`, { method: 'DELETE' });
                if (!res.ok) throw new Error('Failed');
                linksData = linksData.filter(l => l.id !== id);
                renderLinksGrid();
                closeLinkConfirmModal();
            } catch (err) {
                console.error('Failed to delete link:', err);
                alert('Could not delete link. Check your connection and try again.');
            }
        }
