        // =========================================
        // STATUS / PRIORITY CONFIG
        // =========================================

        const STATUS_INFO = {
            '':          { label: 'Active',     color: '#0073ea' },
            'contacted': { label: 'Contacted',  color: '#00c875' },
            'later':     { label: 'Later',      color: '#fdab3d' },
            'skip':      { label: 'Skip',       color: '#e2445c' },
        };

        const PRIORITY_INFO = {
            focus:  { label: 'In Focus', color: '#a25afd' },
            high:   { label: 'High',     color: '#e2445c' },
            medium: { label: 'Medium',   color: '#fdab3d' },
            low:    { label: 'Low',      color: '#00c875' },
        };

        // Position a popover below (or above) its trigger button using document-absolute coords
        function positionDropdown(dd, btn) {
            const btnRect = btn.getBoundingClientRect();
            const ddRect  = dd.getBoundingClientRect(); // valid after showPopover()
            const ddH     = ddRect.height || 170;
            const ddW     = ddRect.width  || 170;
            const gap     = 6;

            // Flip above if not enough room below
            const spaceBelow = window.innerHeight - btnRect.bottom;
            const top = spaceBelow >= ddH + gap + 10
                ? btnRect.bottom + window.scrollY + gap
                : btnRect.top   + window.scrollY - ddH - gap;

            // Center under button, clamped to viewport
            let left = btnRect.left + window.scrollX + btnRect.width / 2 - ddW / 2;
            left = Math.max(window.scrollX + 8,
                   Math.min(left, window.scrollX + window.innerWidth - ddW - 8));

            dd.style.top  = top  + 'px';
            dd.style.left = left + 'px';
        }

        function toggleStatusDropdown(contactId, btn) {
            const dd = document.getElementById(`status-dd-${contactId}`);
            if (!dd) return;
            const isOpen = dd.matches(':popover-open');
            closeAllDropdowns();
            if (!isOpen) { dd.showPopover(); positionDropdown(dd, btn); }
        }

        function togglePriorityDropdown(contactId, btn) {
            const dd = document.getElementById(`priority-dd-${contactId}`);
            if (!dd) return;
            const isOpen = dd.matches(':popover-open');
            closeAllDropdowns();
            if (!isOpen) { dd.showPopover(); positionDropdown(dd, btn); }
        }

        function closeAllDropdowns() {
            document.querySelectorAll('.status-dropdown, .priority-dropdown').forEach(d => {
                if (d.matches(':popover-open')) d.hidePopover();
            });
        }

        function pickStatus(contactId, value) {
            closeAllDropdowns();
            const select = document.getElementById(`status-select-${contactId}`);
            if (select) { select.value = value; select.dispatchEvent(new Event('change')); }
        }

        function pickPriority(contactId, value) {
            closeAllDropdowns();
            const select = document.getElementById(`priority-select-${contactId}`);
            if (select) { select.value = value; select.dispatchEvent(new Event('change')); }
        }
        // Outside-click dismiss is handled automatically by popover="auto"

        // =========================================
        // CONTACTS
        // =========================================

        async function loadContacts() {
            try {
                const response = await fetch('/api/contacts');
                if (!response.ok) throw new Error('Failed to load contacts data');
                contactsData = await response.json();
                document.getElementById('loading').style.display = 'none';
                document.getElementById('active-tab').classList.add('active');
                renderContacts();
            } catch (error) {
                console.error('Error loading contacts:', error);
                document.getElementById('loading').innerHTML =
                    '<p class="load-error">Failed to load contacts. Check that the server is running and try refreshing.</p>';
                document.getElementById('stat-last-check').textContent = '—';
                document.getElementById('active-tab').classList.add('active');
                document.getElementById('active-empty').style.display = 'block';
            }
        }

        function formatDateShort(isoString) {
            if (!isoString) return '';
            const d = new Date(isoString);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }

        // =========================================
        // PAGINATION
        // =========================================
        const PAGE_SIZE = 30;
        const paginationState = {}; // { 'active': 1, 'archived': 1, ... }

        function applyPagination(tabName) {
            const tbody = document.getElementById(`${tabName}-table-body`);
            if (!tbody) return;
            const page = paginationState[tabName] || 1;
            const limit = page * PAGE_SIZE;
            const rows = Array.from(tbody.querySelectorAll('tr[data-contact-id]'));
            rows.forEach((row, i) => {
                row.classList.toggle('row-page-hidden', i >= limit);
            });
            const wrap = document.getElementById(`${tabName}-load-more-wrap`);
            if (wrap) {
                const remaining = rows.length - limit;
                if (remaining > 0) {
                    wrap.style.display = 'block';
                    const btn = wrap.querySelector('.load-more-btn');
                    if (btn) btn.textContent = `Load ${Math.min(remaining, PAGE_SIZE)} more (${remaining} remaining)`;
                } else {
                    wrap.style.display = 'none';
                }
            }
        }

        function loadMoreRows(tabName) {
            paginationState[tabName] = (paginationState[tabName] || 1) + 1;
            applyPagination(tabName);
        }

        function applyPaginationToAll() {
            ['active', 'archived', 'later', 'skip'].forEach(applyPagination);
        }

        function renderContacts() {
            const { metadata, contacts } = contactsData;

            // Last check date
            const lastCheckDate = new Date(metadata.lastCheckDate);
            document.getElementById('stat-last-check').textContent = lastCheckDate.toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
            });

            const activeTableBody = document.getElementById('active-table-body');
            activeTableBody.innerHTML = '';

            // Render all contacts into active table initially
            contacts.forEach(contact => {
                const row = createContactRow(contact);
                activeTableBody.appendChild(row);
            });

            // Move contacts to correct tabs based on status
            applyContactStatuses();

            updateStats();
            updateTabCounts();
            updateAllEmptyStates();
            initDragAndDrop();
            addGroupHeadersToAllTabs();
            // Reset pagination state and apply
            ['active', 'archived', 'later', 'skip'].forEach(t => { paginationState[t] = 1; });
            applyPaginationToAll();
        }

        // =========================================
        // ALL TAB
        // =========================================
        function renderAllTab() {
            if (!contactsData) return;
            const tbody = document.getElementById('all-table-body');
            if (!tbody) return;
            tbody.innerHTML = '';

            const { contacts } = contactsData;
            contacts.forEach(contact => {
                const row = createContactRow(contact);
                // Mark with correct tab-specific class based on status
                if (contact.status === 'contacted') row.classList.add('archived-row');
                else if (contact.status === 'later') row.classList.add('later-row');
                else if (contact.status === 'skip') row.classList.add('skip-row');
                tbody.appendChild(row);
                // Restore notes
                const noteField = document.getElementById(`note-${contact.id}`);
                if (noteField && contact.notes) noteField.value = contact.notes;
            });

            addGroupHeaders(tbody);
            paginationState['all'] = 1;
            applyPagination('all');
            updateAllEmptyStates();
        }

        function getStatusClass(status) {
            if (!status) return '';
            return `status-${status}`;
        }

        function createStatusBadge(contact) {
            if (contact.status === 'contacted' && contact.contactedAt) {
                return `<span class="contacted-badge">Contacted ${formatDateShort(contact.contactedAt)}</span>`;
            }
            if (contact.status === 'later') {
                return `<span class="later-badge"><i class="ti ti-clock"></i> Saved for later</span><span class="bot-note">Slack bot may reactivate</span>`;
            }
            if (contact.status === 'skip') {
                return `<span class="skip-badge"><i class="ti ti-ban"></i> Skipped</span><span class="bot-note">Slack bot won't reactivate</span>`;
            }
            return '';
        }

        function createContactRow(contact) {
            const row = document.createElement('tr');
            row.className = `priority-${contact.priority}`;
            row.dataset.contactId = contact.id;

            const tenantLink = `https://app.osaas.io/admin/tenant/${contact.tenantName}`;
            const grafanaLink = `https://ops-ui.osaas.io/d/45a4f896-1072-4957-ad18-9b4f0c1e77ef/tenant?orgId=1&from=now-24h&to=now&timezone=browser&var-tenant=${encodeURIComponent(contact.tenantName || '')}&refresh=5m`;
            const slackLink = contact.slackChannelId
                ? `https://eyevinn.slack.com/archives/${contact.slackChannelId}`
                : null;

            const statusKey = contact.status || '';
            const statusInfo = STATUS_INFO[statusKey] || STATUS_INFO[''];
            const priorityInfo = PRIORITY_INFO[contact.priority] || PRIORITY_INFO['low'];

            const statusOptionsHtml = Object.entries(STATUS_INFO).map(([v, info]) => `
                <div class="status-option${statusKey === v ? ' selected' : ''}" data-value="${v}" onclick="pickStatus('${contact.id}', '${v}')">
                    <span class="status-swatch" style="background:${info.color}"></span>
                    <span>${info.label}</span>
                    ${statusKey === v ? '<i class="ti ti-check status-option-check"></i>' : ''}
                </div>`).join('');

            const priorityOptionsHtml = Object.entries(PRIORITY_INFO).map(([v, info]) => `
                <div class="status-option${contact.priority === v ? ' selected' : ''}" data-value="${v}" onclick="pickPriority('${contact.id}', '${v}')">
                    <span class="status-swatch" style="background:${info.color}"></span>
                    <span>${info.label}</span>
                    ${contact.priority === v ? '<i class="ti ti-check status-option-check"></i>' : ''}
                </div>`).join('');

            row.innerHTML = `
                <td style="width:30px; padding: 0 4px;">
                    <span class="drag-handle" title="Drag to reorder"><i class="ti ti-grip-vertical"></i></span>
                </td>
                <td class="status-td" data-label="Status" data-status="${contact.status || 'active'}">
                    <button class="status-btn" type="button" onclick="toggleStatusDropdown('${contact.id}', this)" title="Change status">
                        <span class="status-btn-label">${statusInfo.label}</span>
                        <i class="ti ti-chevron-down status-btn-chevron"></i>
                    </button>
                    <div class="status-dropdown" id="status-dd-${contact.id}" popover="auto">
                        ${statusOptionsHtml}
                    </div>
                    <select id="status-select-${contact.id}" style="display:none"
                            onchange="updateStatus('${contact.id}', this)"
                            data-contact-id="${contact.id}">
                        <option value="" ${!contact.status ? 'selected' : ''}>Active</option>
                        <option value="contacted" ${contact.status === 'contacted' ? 'selected' : ''}>Contacted</option>
                        <option value="later" ${contact.status === 'later' ? 'selected' : ''}>Later</option>
                        <option value="skip" ${contact.status === 'skip' ? 'selected' : ''}>Skip</option>
                    </select>
                    <span id="status-badge-${contact.id}" style="display:none"></span>
                </td>
                <td class="priority-td" data-label="Priority" data-priority="${contact.priority}">
                    <button class="priority-btn" type="button" onclick="togglePriorityDropdown('${contact.id}', this)" title="Change priority">
                        <span class="priority-btn-label">${priorityInfo.label}</span>
                        <i class="ti ti-chevron-down status-btn-chevron"></i>
                    </button>
                    <div class="priority-dropdown" id="priority-dd-${contact.id}" popover="auto">
                        ${priorityOptionsHtml}
                    </div>
                    <select id="priority-select-${contact.id}" class="priority-select ${contact.priority}" style="display:none"
                            onchange="updatePriority('${contact.id}', this)">
                        <option value="focus" ${contact.priority === 'focus' ? 'selected' : ''}>In Focus</option>
                        <option value="high" ${contact.priority === 'high' ? 'selected' : ''}>High</option>
                        <option value="medium" ${contact.priority === 'medium' ? 'selected' : ''}>Medium</option>
                        <option value="low" ${contact.priority === 'low' ? 'selected' : ''}>Low</option>
                    </select>
                    ${contact.isNew ? '<span class="new-badge">NEW</span>' : ''}
                </td>
                <td data-label="Name">
                    <strong>${escapeHtml(contact.name)}</strong><br>
                    ${contact.organization ? `<span style="font-size:12px;color:var(--color-text-muted)">${escapeHtml(contact.organization)}</span><br>` : ''}
                    <span class="tenant-name">Tenant: <a href="${tenantLink}" target="_blank" class="tenant-link">${escapeHtml(contact.tenantName || '—')}</a></span>
                </td>
                <td data-label="Email">${escapeHtml(contact.email || '—')}</td>
                <td data-label="Activity" class="activity-summary">${contact.activitySummary || ''}</td>
                <td data-label="Notes" class="notes-cell">
                    <button class="expand-button" onclick="openNoteModal('${contact.id}', '${escapeAttr(contact.name)}', '${escapeAttr(contact.email || '')}')" title="Expand note editor">Expand</button>
                    <span class="note-save-status" id="note-status-${contact.id}"></span>
                    <textarea class="notes-field" id="note-${contact.id}"
                              placeholder="Add notes here..."
                              onchange="saveNote('${contact.id}', this.value)"></textarea>
                </td>
                <td data-label="First Seen">${contact.firstSeen || '—'}</td>
                <td data-label="Links">
                    <a href="${grafanaLink}" class="slack-link" target="_blank">Grafana ↗</a>
                    ${slackLink ? `<a href="${slackLink}" class="slack-link" target="_blank">Slack ↗</a>` : ''}
                    <button class="edit-row-btn" onclick="openEditModal('${contact.id}')">Edit</button>
                    <button class="track-btn" id="track-btn-${contact.id}" onclick="trackFromContact('${contact.id}')"><i class="ti ti-pin"></i> Track</button>
                </td>
            `;

            return row;
        }

        // Escape HTML to prevent XSS
        function escapeHtml(text) {
            if (text == null) return '';
            const div = document.createElement('div');
            div.textContent = String(text);
            return div.innerHTML;
        }

        // Escape for use inside HTML attribute values (single-quoted JS strings in onclick etc.)
        function escapeAttr(text) {
            if (text == null) return '';
            return String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        }

        // Save note to API with visual feedback
        async function saveNote(contactId, value) {
            const statusEl = document.getElementById(`note-status-${contactId}`);
            try {
                const response = await fetch(`/api/contacts/${contactId}/notes`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ notes: value })
                });

                if (!response.ok) throw new Error('Save failed');

                if (contactsData) {
                    const contact = contactsData.contacts.find(c => c.id === contactId);
                    if (contact) contact.notes = value;
                }

                if (statusEl) {
                    statusEl.textContent = 'Saved';
                    statusEl.className = 'note-save-status saved visible';
                    setTimeout(() => { statusEl.className = 'note-save-status saved'; }, 2000);
                }
            } catch (err) {
                console.error('Failed to save note:', err);
                if (statusEl) {
                    statusEl.textContent = 'Save failed';
                    statusEl.className = 'note-save-status error visible';
                    setTimeout(() => { statusEl.className = 'note-save-status error'; }, 3000);
                }
            }
        }

        async function updatePriority(contactId, selectEl) {
            const priority = selectEl.value;
            selectEl.className = `priority-select ${priority}`;
            const row = selectEl.closest('tr');
            row.className = row.className.replace(/priority-\w+/, `priority-${priority}`);

            // Update TD data attribute for Monday.com full-cell coloring
            const priorityTd = selectEl.closest('td');
            if (priorityTd) priorityTd.dataset.priority = priority;

            // Update custom button label
            const btnLabel = priorityTd?.querySelector('.priority-btn-label');
            if (btnLabel) btnLabel.textContent = PRIORITY_INFO[priority]?.label || priority;

            // Update dropdown checkmarks
            const dd = document.getElementById(`priority-dd-${contactId}`);
            if (dd) {
                dd.querySelectorAll('.status-option').forEach(opt => {
                    const sel = opt.dataset.value === priority;
                    opt.classList.toggle('selected', sel);
                    let check = opt.querySelector('.status-option-check');
                    if (sel && !check) {
                        const icon = document.createElement('i');
                        icon.className = 'ti ti-check status-option-check';
                        opt.appendChild(icon);
                    } else if (!sel && check) {
                        check.remove();
                    }
                });
            }

            if (contactsData) {
                const contact = contactsData.contacts.find(c => c.id === contactId);
                if (contact) contact.priority = priority;
            }

            await fetch(`/api/contacts/${contactId}/priority`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ priority })
            });

            // Re-render group headers after priority change (row moves to new group)
            const tbody = row.closest('tbody');
            if (tbody) {
                addGroupHeaders(tbody);
                applyPagination(tbody.id.replace('-table-body', ''));
            }

            // Flash the row so user can see where it went
            row.classList.remove('priority-flash');
            void row.offsetWidth; // force reflow to restart animation
            row.classList.add('priority-flash');
            setTimeout(() => row.classList.remove('priority-flash'), 1500);
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // =========================================
        // MONDAY.COM GROUP HEADERS
        // =========================================

        const GROUP_COLORS = { focus: '#a25afd', high: '#e2445c', medium: '#fdab3d', low: '#00c875' };
        const GROUP_LABELS = { focus: 'In Focus', high: 'High Priority', medium: 'Medium Priority', low: 'Low Priority' };

        function addGroupHeaders(tbody) {
            // Remove existing group headers
            tbody.querySelectorAll('tr.group-header').forEach(r => r.remove());
            tbody.querySelectorAll('tr').forEach(r => r.classList.remove('group-collapsed-row'));

            const rows = Array.from(tbody.querySelectorAll('tr[data-contact-id]'));
            if (rows.length === 0) return;

            // Group rows by priority
            const groups = {};
            rows.forEach(row => {
                const p = row.className.match(/priority-(\w+)/)?.[1] || 'low';
                if (!groups[p]) groups[p] = [];
                groups[p].push(row);
            });

            // Insert a header row before the first row of each group
            ['focus', 'high', 'medium', 'low'].forEach(p => {
                if (!groups[p] || groups[p].length === 0) return;
                const firstRow = groups[p][0];
                const header = document.createElement('tr');
                header.className = 'group-header';
                header.dataset.group = p;
                header.innerHTML = `<td colspan="9">
                    <span class="group-header-arrow">▼</span>
                    <span class="group-header-dot" style="background:${GROUP_COLORS[p]}"></span>
                    ${GROUP_LABELS[p]}
                    <span class="group-header-count">${groups[p].length} item${groups[p].length !== 1 ? 's' : ''}</span>
                </td>`;
                header.addEventListener('click', () => toggleGroup(tbody, p));
                tbody.insertBefore(header, firstRow);
            });
        }

        function toggleGroup(tbody, priority) {
            const header = tbody.querySelector(`tr.group-header[data-group="${priority}"]`);
            if (!header) return;
            const collapsed = header.classList.toggle('collapsed');
            tbody.querySelectorAll(`tr.priority-${priority}[data-contact-id]`).forEach(row => {
                row.classList.toggle('group-collapsed-row', collapsed);
            });
        }

        function addGroupHeadersToAllTabs() {
            ['active-table-body', 'archived-table-body', 'later-table-body', 'skip-table-body', 'all-table-body'].forEach(id => {
                const tbody = document.getElementById(id);
                if (tbody) addGroupHeaders(tbody);
            });
        }

        // =========================================
        // CONTACT SEARCH (Feature 1)
        // =========================================

        let contactSearchQuery = '';
        let contactSearchTimer = null;

        function onContactSearch(value) {
            clearTimeout(contactSearchTimer);
            contactSearchTimer = setTimeout(() => {
                contactSearchQuery = value.trim();
                const clearBtn = document.getElementById('contact-search-clear');
                if (clearBtn) clearBtn.style.display = contactSearchQuery ? 'flex' : 'none';
                applyContactSearch();
            }, 200);
        }

        function clearContactSearch() {
            contactSearchQuery = '';
            const input = document.getElementById('contact-search');
            if (input) input.value = '';
            const clearBtn = document.getElementById('contact-search-clear');
            if (clearBtn) clearBtn.style.display = 'none';
            applyContactSearch();
        }

        function applyContactSearch() {
            if (!contactsData) return;

            const q = contactSearchQuery.toLowerCase();

            // For each table body, show/hide rows based on query
            ['active-table-body', 'archived-table-body', 'later-table-body', 'skip-table-body', 'all-table-body'].forEach(tbodyId => {
                const tbody = document.getElementById(tbodyId);
                if (!tbody) return;

                let visibleCount = 0;
                tbody.querySelectorAll('tr[data-contact-id]').forEach(row => {
                    if (!q) {
                        row.classList.remove('search-hidden');
                        visibleCount++;
                        return;
                    }
                    const id = row.dataset.contactId;
                    const contact = contactsData.contacts.find(c => c.id === id);
                    if (!contact) { row.classList.add('search-hidden'); return; }

                    const matches =
                        (contact.name || '').toLowerCase().includes(q) ||
                        (contact.email || '').toLowerCase().includes(q) ||
                        (contact.tenantName || '').toLowerCase().includes(q) ||
                        (contact.organization || '').toLowerCase().includes(q);

                    row.classList.toggle('search-hidden', !matches);
                    if (matches) visibleCount++;
                });

                // Show "no results" message if needed
                let noResultsRow = tbody.querySelector('tr.search-no-results');
                if (!q || visibleCount > 0) {
                    if (noResultsRow) noResultsRow.remove();
                } else {
                    if (!noResultsRow) {
                        noResultsRow = document.createElement('tr');
                        noResultsRow.className = 'search-no-results';
                        noResultsRow.innerHTML = `<td colspan="9" class="search-no-results-cell">No contacts match "<strong>${escapeHtml(contactSearchQuery)}</strong>"</td>`;
                        tbody.appendChild(noResultsRow);
                    }
                }

                // Re-render group headers to skip hidden rows
                if (!q) {
                    addGroupHeaders(tbody);
                } else {
                    tbody.querySelectorAll('tr.group-header').forEach(r => r.remove());
                }
            });
        }

