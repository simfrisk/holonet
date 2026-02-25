        // =========================================
        // STATUS MANAGEMENT
        // =========================================

        async function updateStatus(contactId, selectEl) {
            const status = selectEl.value || null; // empty string -> null (Active)
            const row = selectEl.closest('tr');

            // Update select styling
            selectEl.className = `status-select ${status ? 'status-' + status : ''}`;

            // Update TD data attribute for Monday.com full-cell coloring
            const statusTd = selectEl.closest('td');
            if (statusTd) statusTd.dataset.status = status || 'active';

            // Update custom button label
            const btnLabel = statusTd?.querySelector('.status-btn-label');
            if (btnLabel) btnLabel.textContent = STATUS_INFO[status || '']?.label || 'Active';

            // Update dropdown checkmarks
            const dd = document.getElementById(`status-dd-${contactId}`);
            if (dd) {
                dd.querySelectorAll('.status-option').forEach(opt => {
                    const sel = opt.dataset.value === (status || '');
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

            // Update in-memory data
            let contactedAt = null;
            if (contactsData) {
                const contact = contactsData.contacts.find(c => c.id === contactId);
                if (contact) {
                    contact.status = status;
                    if (status === 'contacted' && !contact.contactedAt) {
                        contact.contactedAt = new Date().toISOString();
                    }
                    contactedAt = contact.contactedAt || null;
                }
            }

            // Save to API
            try {
                const response = await fetch(`/api/contacts/${contactId}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status })
                });
                if (response.ok) {
                    const result = await response.json();
                    contactedAt = result.contactedAt || contactedAt;
                    // Update in-memory contactedAt from server response
                    if (contactsData && result.contactedAt) {
                        const contact = contactsData.contacts.find(c => c.id === contactId);
                        if (contact) contact.contactedAt = result.contactedAt;
                    }
                }
            } catch (err) {
                console.error('Failed to save status:', err);
            }

            // Update badge
            const badgeEl = document.getElementById(`status-badge-${contactId}`);
            if (badgeEl) {
                if (status === 'contacted' && contactedAt) {
                    badgeEl.innerHTML = `<span class="contacted-badge">Contacted ${formatDateShort(contactedAt)}</span>`;
                } else if (status === 'later') {
                    badgeEl.innerHTML = `<span class="later-badge"><i class="ti ti-clock"></i> Saved for later</span><span class="bot-note">Slack bot may reactivate</span>`;
                } else if (status === 'skip') {
                    badgeEl.innerHTML = `<span class="skip-badge"><i class="ti ti-ban"></i> Skipped</span><span class="bot-note">Slack bot won't reactivate</span>`;
                } else {
                    badgeEl.innerHTML = '';
                }
            }

            // Move row to correct tab
            if (!status) {
                moveToActive(row);
            } else if (status === 'contacted') {
                moveToArchive(row);
            } else if (status === 'later') {
                moveToLater(row);
            } else if (status === 'skip') {
                moveToSkip(row);
            }

            updateStats();
            updateTabCounts();
            addGroupHeadersToAllTabs();
        }

        function moveToActive(row) {
            row.classList.remove('archived-row', 'later-row', 'skip-row');
            document.getElementById('active-table-body').appendChild(row);
            updateAllEmptyStates();
        }

        function moveToArchive(row) {
            row.classList.remove('later-row', 'skip-row');
            row.classList.add('archived-row');
            document.getElementById('archived-table-body').appendChild(row);
            updateAllEmptyStates();
        }

        function moveToLater(row) {
            row.classList.remove('archived-row', 'skip-row');
            row.classList.add('later-row');
            document.getElementById('later-table-body').appendChild(row);
            updateAllEmptyStates();
        }

        function moveToSkip(row) {
            row.classList.remove('archived-row', 'later-row');
            row.classList.add('skip-row');
            document.getElementById('skip-table-body').appendChild(row);
            updateAllEmptyStates();
        }

        function applyContactStatuses() {
            if (!contactsData) return;

            contactsData.contacts.forEach(contact => {
                const row = document.querySelector(`[data-contact-id="${contact.id}"]`);
                if (!row) return;

                // Move to correct tab
                if (contact.status === 'contacted') {
                    moveToArchive(row);
                } else if (contact.status === 'later') {
                    moveToLater(row);
                } else if (contact.status === 'skip') {
                    moveToSkip(row);
                }
                // null status stays in active (already there)

                // Restore notes
                const noteField = document.querySelector(`#note-${contact.id}`);
                if (noteField && contact.notes) {
                    noteField.value = contact.notes;
                }
            });
        }

        function updateStats() {
            const total = document.querySelectorAll('[data-contact-id]').length;
            const active = document.getElementById('active-table-body').children.length;
            const contacted = document.getElementById('archived-table-body').children.length;
            const later = document.getElementById('later-table-body').children.length;
            const skip = document.getElementById('skip-table-body').children.length;
            // Count "In Focus" priority contacts across all visible rows
            const focusCount = document.querySelectorAll('[data-contact-id].priority-focus').length;

            document.getElementById('stat-total').textContent = total;
            document.getElementById('stat-focus').textContent = focusCount;
            document.getElementById('stat-pending').textContent = active;
            document.getElementById('stat-contacted').textContent = contacted;
            document.getElementById('stat-later').textContent = later;
            document.getElementById('stat-skip').textContent = skip;
        }

        function updateTabCounts() {
            const activeCount = document.getElementById('active-table-body').children.length;
            const archivedCount = document.getElementById('archived-table-body').children.length;
            const laterCount = document.getElementById('later-table-body').children.length;
            const skipCount = document.getElementById('skip-table-body').children.length;

            document.getElementById('active-count').textContent = activeCount;
            document.getElementById('archived-count').textContent = archivedCount;
            document.getElementById('later-count').textContent = laterCount;
            document.getElementById('skip-count').textContent = skipCount;

            // Update primary nav badge (show active contact count)
            document.getElementById('contacts-section-count').textContent = activeCount;
        }

        function updateAllEmptyStates() {
            const tabs = ['active', 'archived', 'later', 'skip'];
            tabs.forEach(tab => {
                const body = document.getElementById(`${tab}-table-body`);
                const empty = document.getElementById(`${tab}-empty`);
                if (!body || !empty) return;
                if (body.children.length === 0) {
                    body.style.display = 'none';
                    empty.style.display = 'block';
                } else {
                    body.style.display = '';
                    empty.style.display = 'none';
                }
            });
        }
