        // customers.js - Customers tab with rich profile view

        let allCustomers = [];         // All contacts loaded from server
        let filteredCustomers = [];    // After search/filter
        let currentProfileId = null;   // Currently open profile
        let sortField = 'name';
        let sortDir = 'asc';

        // ===== LOAD =====

        async function loadCustomers() {
            try {
                const res = await fetch('/api/contacts');
                const data = await res.json();
                allCustomers = (data.contacts || []).map(c => {
                    // contacts endpoint returns id not _id
                    return { _id: c.id || c._id, ...c };
                });
                applyCustomersFilters();
                populateIndustryFilter();
            } catch (err) {
                console.error('Failed to load customers:', err);
            }
        }

        // ===== FILTERS & SEARCH =====

        function applyCustomersFilters() {
            const query = document.getElementById('customers-search').value.toLowerCase().trim();
            const statusFilter = document.getElementById('customers-filter-status').value;
            const industryFilter = document.getElementById('customers-filter-industry').value;

            filteredCustomers = allCustomers.filter(c => {
                // Status filter
                if (statusFilter !== '') {
                    const contactStatus = c.status || null;
                    if (statusFilter === 'null') {
                        if (contactStatus !== null && contactStatus !== undefined && contactStatus !== '') return false;
                    } else {
                        if (contactStatus !== statusFilter) return false;
                    }
                }
                // Industry filter
                if (industryFilter && (c.industry || '').toLowerCase() !== industryFilter.toLowerCase()) return false;
                // Text search
                if (query) {
                    const searchable = [
                        c.name, c.email, c.tenantName, c.company, c.role, c.industry,
                        (c.tags || []).join(' '), c.activitySummary, c.notes
                    ].join(' ').toLowerCase();
                    if (!searchable.includes(query)) return false;
                }
                return true;
            });

            sortCustomers();
            renderCustomersTable();
        }

        function sortCustomers() {
            filteredCustomers.sort((a, b) => {
                let valA, valB;
                if (sortField === 'status') {
                    valA = a.status || 'active';
                    valB = b.status || 'active';
                } else if (sortField === 'contactedAt') {
                    valA = a.contactedAt || '';
                    valB = b.contactedAt || '';
                } else {
                    valA = (a[sortField] || '').toString().toLowerCase();
                    valB = (b[sortField] || '').toString().toLowerCase();
                }
                const cmp = valA.localeCompare(valB);
                return sortDir === 'asc' ? cmp : -cmp;
            });
        }

        function populateIndustryFilter() {
            const select = document.getElementById('customers-filter-industry');
            const industries = [...new Set(allCustomers.map(c => c.industry).filter(Boolean))].sort();
            select.innerHTML = '<option value="">All industries</option>';
            industries.forEach(ind => {
                const opt = document.createElement('option');
                opt.value = ind;
                opt.textContent = ind;
                select.appendChild(opt);
            });
        }

        // ===== RENDER TABLE =====

        function renderCustomersTable() {
            const tbody = document.getElementById('customers-tbody');
            const empty = document.getElementById('customers-empty');
            const count = document.getElementById('customers-count');

            count.textContent = `${filteredCustomers.length} customer${filteredCustomers.length !== 1 ? 's' : ''}`;

            if (filteredCustomers.length === 0) {
                tbody.innerHTML = '';
                empty.style.display = 'block';
                return;
            }
            empty.style.display = 'none';

            tbody.innerHTML = filteredCustomers.map(c => {
                const status = c.status || null;
                const statusLabel = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Active';
                const statusClass = status ? `cust-status-${status}` : 'cust-status-active';
                const tags = (c.tags || []).map(t => `<span class="customer-tag">${escapeHtml(t)}</span>`).join('');
                const contactedAt = c.contactedAt ? new Date(c.contactedAt).toLocaleDateString() : '-';
                const company = c.company || '-';
                const role = c.role || '-';
                const industry = c.industry || '-';
                const id = c._id || c.id;

                return `<tr class="customer-row" data-id="${id}">
                    <td class="customer-name-cell">
                        <strong>${escapeHtml(c.name || '-')}</strong>
                        ${c.linkedIn ? `<a href="${escapeHtml(c.linkedIn)}" target="_blank" class="linkedin-link" title="LinkedIn">&#x2197;</a>` : ''}
                    </td>
                    <td>${escapeHtml(company)}</td>
                    <td>${escapeHtml(role)}</td>
                    <td>${escapeHtml(industry)}</td>
                    <td><code class="tenant-code">${escapeHtml(c.tenantName || '-')}</code></td>
                    <td class="cust-email-cell">${escapeHtml(c.email || '-')}</td>
                    <td><span class="cust-status-badge ${statusClass}">${statusLabel}</span></td>
                    <td>${contactedAt}</td>
                    <td class="cust-tags-cell">${tags}</td>
                    <td><button class="open-profile-btn" data-id="${id}">View</button></td>
                </tr>`;
            }).join('');

            // Row click to open profile
            tbody.querySelectorAll('.customer-row').forEach(row => {
                row.addEventListener('click', e => {
                    if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;
                    openProfile(row.dataset.id);
                });
            });
            tbody.querySelectorAll('.open-profile-btn').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    openProfile(btn.dataset.id);
                });
            });
        }

        function escapeHtml(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        // ===== SORTING =====

        function initSortableHeaders() {
            document.querySelectorAll('.customers-table th[data-sort]').forEach(th => {
                th.style.cursor = 'pointer';
                th.addEventListener('click', () => {
                    const field = th.dataset.sort;
                    if (sortField === field) {
                        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
                    } else {
                        sortField = field;
                        sortDir = 'asc';
                    }
                    document.querySelectorAll('.customers-table th[data-sort]').forEach(h => {
                        h.classList.remove('sort-asc', 'sort-desc');
                    });
                    th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
                    applyCustomersFilters();
                });
            });
        }

        // ===== PROFILE MODAL =====

        function openProfile(id) {
            const contact = allCustomers.find(c => (c._id || c.id) === id);
            if (!contact) return;
            currentProfileId = id;

            document.getElementById('profile-modal-name').textContent = contact.name || 'Customer Profile';
            document.getElementById('profile-name').value = contact.name || '';
            document.getElementById('profile-email').value = contact.email || '';
            document.getElementById('profile-tenant').value = contact.tenantName || '';
            document.getElementById('profile-company').value = contact.company || '';
            document.getElementById('profile-role').value = contact.role || '';
            document.getElementById('profile-industry').value = contact.industry || '';
            document.getElementById('profile-linkedin').value = contact.linkedIn || '';
            document.getElementById('profile-tags').value = (contact.tags || []).join(', ');
            document.getElementById('profile-status').value = contact.status || '';
            document.getElementById('profile-priority').value = contact.priority || '';
            document.getElementById('profile-activity').value = contact.activitySummary || '';
            document.getElementById('profile-notes').value = contact.notes || '';
            document.getElementById('profile-first-seen').textContent = contact.firstSeen || '-';
            document.getElementById('profile-contacted-at').textContent = contact.contactedAt ? new Date(contact.contactedAt).toLocaleString() : 'Never';
            document.getElementById('profile-source').textContent = contact.source || '-';

            renderContactHistory(contact.contactHistory || []);
            hideAddHistoryForm();

            document.getElementById('customer-profile-modal').style.display = 'block';
        }

        function closeProfile() {
            document.getElementById('customer-profile-modal').style.display = 'none';
            currentProfileId = null;
        }

        async function saveProfile() {
            if (!currentProfileId) return;

            const tagsRaw = document.getElementById('profile-tags').value;
            const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

            const body = {
                name: document.getElementById('profile-name').value.trim(),
                email: document.getElementById('profile-email').value.trim(),
                tenantName: document.getElementById('profile-tenant').value.trim(),
                company: document.getElementById('profile-company').value.trim(),
                role: document.getElementById('profile-role').value.trim(),
                industry: document.getElementById('profile-industry').value.trim(),
                linkedIn: document.getElementById('profile-linkedin').value.trim(),
                tags,
                status: document.getElementById('profile-status').value || null,
                priority: document.getElementById('profile-priority').value || null,
                activitySummary: document.getElementById('profile-activity').value.trim(),
                notes: document.getElementById('profile-notes').value.trim(),
            };

            try {
                const res = await fetch(`/api/contacts/${currentProfileId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                if (!res.ok) throw new Error('Failed to save');
                await loadCustomers();
                closeProfile();
            } catch (err) {
                alert('Failed to save profile: ' + err.message);
            }
        }

        // ===== CONTACT HISTORY =====

        function renderContactHistory(history) {
            const list = document.getElementById('profile-history-list');
            if (!history || history.length === 0) {
                list.innerHTML = '<p class="no-history">No contact history yet.</p>';
                return;
            }
            const sorted = [...history].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            list.innerHTML = sorted.map(entry => `
                <div class="history-entry" data-id="${entry.id}">
                    <div class="history-entry-meta">
                        <span class="history-date">${escapeHtml(entry.date || '')}</span>
                        <span class="history-method method-${entry.method || 'other'}">${escapeHtml(entry.method || 'other')}</span>
                        ${entry.source ? `<span class="history-source">${escapeHtml(entry.source)}</span>` : ''}
                        <button class="delete-history-btn" data-id="${entry.id}" title="Delete entry">&#x2715;</button>
                    </div>
                    <div class="history-summary">${escapeHtml(entry.summary || '')}</div>
                </div>
            `).join('');

            list.querySelectorAll('.delete-history-btn').forEach(btn => {
                btn.addEventListener('click', () => deleteHistoryEntry(btn.dataset.id));
            });
        }

        function showAddHistoryForm() {
            document.getElementById('add-history-form').style.display = 'flex';
            document.getElementById('history-date').value = new Date().toISOString().slice(0, 10);
            document.getElementById('history-summary').value = '';
            document.getElementById('history-source').value = 'manual';
        }

        function hideAddHistoryForm() {
            document.getElementById('add-history-form').style.display = 'none';
        }

        async function saveHistoryEntry() {
            if (!currentProfileId) return;
            const date = document.getElementById('history-date').value;
            const method = document.getElementById('history-method').value;
            const summary = document.getElementById('history-summary').value.trim();
            const source = document.getElementById('history-source').value.trim() || 'manual';
            if (!summary) { alert('Please enter a summary.'); return; }

            try {
                const res = await fetch(`/api/contacts/${currentProfileId}/history`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ date, method, summary, source })
                });
                if (!res.ok) throw new Error('Failed to save history');
                const updated = await res.json();
                const idx = allCustomers.findIndex(c => (c._id || c.id) === currentProfileId);
                if (idx !== -1) allCustomers[idx] = { _id: updated.id || updated._id, ...updated };
                renderContactHistory(updated.contactHistory || []);
                hideAddHistoryForm();
            } catch (err) {
                alert('Failed to add history: ' + err.message);
            }
        }

        async function deleteHistoryEntry(historyId) {
            if (!currentProfileId) return;
            if (!confirm('Delete this history entry?')) return;
            try {
                const res = await fetch(`/api/contacts/${currentProfileId}/history/${historyId}`, { method: 'DELETE' });
                if (!res.ok) throw new Error('Failed to delete');
                const updated = await res.json();
                const idx = allCustomers.findIndex(c => (c._id || c.id) === currentProfileId);
                if (idx !== -1) allCustomers[idx] = { _id: updated.id || updated._id, ...updated };
                renderContactHistory(updated.contactHistory || []);
            } catch (err) {
                alert('Failed to delete history: ' + err.message);
            }
        }

        // ===== INIT =====

        function initCustomersTab() {
            document.getElementById('customers-search').addEventListener('input', applyCustomersFilters);
            document.getElementById('customers-filter-status').addEventListener('change', applyCustomersFilters);
            document.getElementById('customers-filter-industry').addEventListener('change', applyCustomersFilters);
            document.getElementById('customers-clear-filters').addEventListener('click', () => {
                document.getElementById('customers-search').value = '';
                document.getElementById('customers-filter-status').value = '';
                document.getElementById('customers-filter-industry').value = '';
                applyCustomersFilters();
            });
            document.getElementById('profile-save-btn').addEventListener('click', saveProfile);
            document.getElementById('add-history-btn').addEventListener('click', showAddHistoryForm);
            document.getElementById('save-history-btn').addEventListener('click', saveHistoryEntry);
            document.getElementById('cancel-history-btn').addEventListener('click', hideAddHistoryForm);
            initSortableHeaders();
        }

        window.loadCustomers = loadCustomers;
        window.initCustomersTab = initCustomersTab;
        window.closeProfile = closeProfile;
