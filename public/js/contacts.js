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
            high:   { label: 'High',   color: '#e2445c' },
            medium: { label: 'Medium', color: '#fdab3d' },
            low:    { label: 'Low',    color: '#00c875' },
        };

        function toggleStatusDropdown(contactId, btn) {
            const dd = document.getElementById(`status-dd-${contactId}`);
            const isOpen = dd && dd.classList.contains('open');
            closeAllDropdowns();
            if (!isOpen && dd) dd.classList.add('open');
        }

        function togglePriorityDropdown(contactId, btn) {
            const dd = document.getElementById(`priority-dd-${contactId}`);
            const isOpen = dd && dd.classList.contains('open');
            closeAllDropdowns();
            if (!isOpen && dd) dd.classList.add('open');
        }

        function closeAllDropdowns() {
            document.querySelectorAll('.status-dropdown.open, .priority-dropdown.open')
                .forEach(d => d.classList.remove('open'));
        }

        function pickStatus(contactId, value) {
            closeAllDropdowns();
            const select = document.getElementById(`status-select-${contactId}`);
            if (select) {
                select.value = value;
                select.dispatchEvent(new Event('change'));
            }
        }

        function pickPriority(contactId, value) {
            closeAllDropdowns();
            const select = document.getElementById(`priority-select-${contactId}`);
            if (select) {
                select.value = value;
                select.dispatchEvent(new Event('change'));
            }
        }

        // Close dropdowns on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.status-td') && !e.target.closest('.priority-td')) {
                closeAllDropdowns();
            }
        });

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
                    <div class="status-dropdown" id="status-dd-${contact.id}">
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
                    <div class="priority-dropdown" id="priority-dd-${contact.id}">
                        ${priorityOptionsHtml}
                    </div>
                    <select id="priority-select-${contact.id}" class="priority-select ${contact.priority}" style="display:none"
                            onchange="updatePriority('${contact.id}', this)">
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

            // Re-render group headers after priority change
            const tbody = row.closest('tbody');
            if (tbody) addGroupHeaders(tbody);
        }

        // =========================================
        // MONDAY.COM GROUP HEADERS
        // =========================================

        const GROUP_COLORS = { high: '#e2445c', medium: '#fdab3d', low: '#00c875' };
        const GROUP_LABELS = { high: 'High Priority', medium: 'Medium Priority', low: 'Low Priority' };

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
            ['high', 'medium', 'low'].forEach(p => {
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
            ['active-table-body', 'archived-table-body', 'later-table-body', 'skip-table-body'].forEach(id => {
                const tbody = document.getElementById(id);
                if (tbody) addGroupHeaders(tbody);
            });
        }

