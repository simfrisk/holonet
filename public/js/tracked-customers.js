        // =========================================
        // TRACKED CUSTOMERS
        // =========================================

        // Category definitions: order matters — focus > paying > trial > null
        const TRACKED_CATEGORIES = [
            { key: 'focus',  zoneId: 'tracked-focus-zone',  emptyId: 'tracked-focus-empty'  },
            { key: 'paying', zoneId: 'tracked-paying-zone', emptyId: 'tracked-paying-empty' },
            { key: 'trial',  zoneId: 'tracked-trial-zone',  emptyId: 'tracked-trial-empty'  },
            { key: null,     zoneId: 'tracked-grid',        emptyId: null                   }
        ];

        async function loadTrackedTab() {
            try {
                const response = await fetch('/api/tracked');
                if (!response.ok) throw new Error('Failed to load');
                const data = await response.json();
                trackedCustomers = data.tracked || [];
                trackedLoaded = true;
                renderTrackedGrid();
            } catch (err) {
                console.error('Error loading tracked customers:', err);
            }
        }

        function renderTrackedGrid() {
            document.getElementById('tracked-count').textContent = trackedCustomers.length;

            // Split into the four category buckets
            const focusCards   = trackedCustomers.filter(c => c.category === 'focus');
            const payingCards  = trackedCustomers.filter(c => c.category === 'paying');
            const trialCards   = trackedCustomers.filter(c => c.category === 'trial');
            const regularCards = trackedCustomers.filter(c => !c.category || (c.category !== 'focus' && c.category !== 'paying' && c.category !== 'trial'));

            // --- Render focus zone ---
            const focusZone  = document.getElementById('tracked-focus-zone');
            const focusEmpty = document.getElementById('tracked-focus-empty');
            Array.from(focusZone.querySelectorAll('.tracked-card')).forEach(el => el.remove());
            if (focusCards.length === 0) {
                if (focusEmpty) focusEmpty.style.display = '';
            } else {
                if (focusEmpty) focusEmpty.style.display = 'none';
                focusCards.forEach(c => {
                    focusZone.insertAdjacentHTML('beforeend', renderTrackedCard(c));
                });
            }

            // --- Render paying zone ---
            const payingZone  = document.getElementById('tracked-paying-zone');
            const payingEmpty = document.getElementById('tracked-paying-empty');
            Array.from(payingZone.querySelectorAll('.tracked-card')).forEach(el => el.remove());
            if (payingCards.length === 0) {
                if (payingEmpty) payingEmpty.style.display = '';
            } else {
                if (payingEmpty) payingEmpty.style.display = 'none';
                payingCards.forEach(c => {
                    payingZone.insertAdjacentHTML('beforeend', renderTrackedCard(c));
                });
            }

            // --- Render trial zone ---
            const trialZone  = document.getElementById('tracked-trial-zone');
            const trialEmpty = document.getElementById('tracked-trial-empty');
            Array.from(trialZone.querySelectorAll('.tracked-card')).forEach(el => el.remove());
            if (trialCards.length === 0) {
                if (trialEmpty) trialEmpty.style.display = '';
            } else {
                if (trialEmpty) trialEmpty.style.display = 'none';
                trialCards.forEach(c => {
                    trialZone.insertAdjacentHTML('beforeend', renderTrackedCard(c));
                });
            }

            // --- Render regular grid ---
            const grid = document.getElementById('tracked-grid');
            if (regularCards.length === 0) {
                grid.innerHTML = `
                    <div class="tracked-empty">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                        <h3>No tracked customers yet</h3>
                        <p>Add customers you're actively managing, or use the Track button from the Contact List.</p>
                    </div>`;
            } else {
                grid.innerHTML = regularCards.map(c => renderTrackedCard(c)).join('');
            }

            // sync track buttons in contact list
            syncTrackButtons();
            // Wire up drag-and-drop handlers
            initTrackedDragDrop();
        }

        function healthLabel(health) {
            const labels = { good: 'Good', 'at-risk': 'At Risk', 'needs-attention': 'Needs Attention', unknown: 'Unknown' };
            return labels[health] || health;
        }
        function touchpointIcon(type) {
            const icons = { email: '<i class="ti ti-mail"></i>', call: '<i class="ti ti-phone"></i>', slack: '<i class="ti ti-brand-slack"></i>', meeting: '<i class="ti ti-calendar-event"></i>', other: '<i class="ti ti-note"></i>' };
            return icons[type] || '<i class="ti ti-note"></i>';
        }

        function renderTrackedCard(c) {
            const category = c.category || null;
            const categoryClass = category ? ` tracked-card-category-${category}` : '';
            const tenantLink = c.tenantName
                ? `<a href="https://app.osaas.io/admin/tenant/${c.tenantName}" class="tracked-card-tenant" target="_blank">${c.tenantName} ↗</a>`
                : '';
            const lastTp = (c.touchpoints || [])[0];
            const lastTpHtml = lastTp
                ? `<div class="tracked-meta-row"><span class="tracked-meta-icon">${touchpointIcon(lastTp.type)}</span><span>${lastTp.note.substring(0, 60)}${lastTp.note.length > 60 ? '…' : ''} <span style="color:var(--color-text-subtle)">${lastTp.date}</span></span></div>`
                : '';
            const followUpHtml = c.nextFollowUp
                ? (() => {
                    const today = new Date().toISOString().split('T')[0];
                    const overdue = c.nextFollowUp < today;
                    return `<div class="tracked-meta-row ${overdue ? 'tracked-meta-overdue' : ''}"><span class="tracked-meta-icon"><i class="ti ti-calendar"></i></span><span>Follow-up: ${c.nextFollowUp}${overdue ? ' (overdue)' : ''}</span></div>`;
                  })()
                : '';
            const notesPreview = c.notes ? `<div class="tracked-card-notes-preview">${c.notes}</div>` : '';

            return `
                <div class="tracked-card${categoryClass}" draggable="true" data-tracked-id="${c.id}" data-category="${category || ''}" onclick="openTrackedModal('${c.id}')">
                    <div class="tracked-card-top">
                        <span class="tracked-drag-handle" title="Drag to reorder" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()">⠿</span>
                        <div class="tracked-card-badges">
                            <span class="health-badge health-${c.health || 'unknown'}">
                                <span class="health-dot"></span>${healthLabel(c.health || 'unknown')}
                            </span>
                            <span class="stage-badge">${c.stage || 'Onboarding'}</span>
                        </div>
                        <button class="tracked-card-remove" title="Remove from tracking" onclick="event.stopPropagation();removeTracked('${c.id}')">×</button>
                    </div>
                    <div>
                        <p class="tracked-card-name">${c.name}</p>
                        ${c.organization ? `<p class="tracked-card-org">${c.organization}</p>` : ''}
                        ${tenantLink}
                    </div>
                    <div class="tracked-card-meta">
                        ${followUpHtml}
                        ${lastTpHtml}
                    </div>
                    ${notesPreview}
                </div>`;
        }

        function syncTrackButtons() {
            const trackedContactIds = new Set(trackedCustomers.filter(c => c.contactId).map(c => c.contactId));
            document.querySelectorAll('.track-btn').forEach(btn => {
                const contactId = btn.id.replace('track-btn-', '');
                if (trackedContactIds.has(contactId)) {
                    btn.innerHTML = '<i class="ti ti-circle-check"></i> Tracked';
                    btn.classList.add('tracked');
                } else {
                    btn.innerHTML = '<i class="ti ti-pin"></i> Track';
                    btn.classList.remove('tracked');
                }
            });
        }

        async function trackFromContact(contactId) {
            // If already tracked, open the tracked modal instead
            const existing = trackedCustomers.find(c => c.contactId === contactId);
            if (existing) {
                switchSection('tracked');
                openTrackedModal(existing.id);
                return;
            }

            const contact = contactsData && contactsData.contacts.find(c => c.id === contactId);
            if (!contact) return;

            try {
                const response = await fetch('/api/tracked', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contactId: contact.id,
                        name: contact.name || '(Unknown)',
                        organization: contact.organization || null,
                        tenantName: contact.tenantName || null,
                        email: contact.email || null,
                        health: 'unknown',
                        stage: 'Onboarding',
                        notes: ''
                    })
                });
                if (!response.ok) throw new Error('Failed to add');
                const data = await response.json();
                trackedCustomers.unshift(data.tracked);
                trackedLoaded = true;
                document.getElementById('tracked-count').textContent = trackedCustomers.length;
                syncTrackButtons();

                // Switch to tracked tab and open the new card's detail modal
                switchSection('tracked');
                renderTrackedGrid();
                openTrackedModal(data.id);
            } catch (err) {
                console.error('Error tracking customer:', err);
                alert('Failed to add to tracked customers.');
            }
        }

        async function removeTracked(trackedId) {
            if (!confirm('Remove this customer from tracking?')) return;
            try {
                const response = await fetch(`/api/tracked/${trackedId}`, { method: 'DELETE' });
                if (!response.ok) throw new Error('Failed');
                trackedCustomers = trackedCustomers.filter(c => c.id !== trackedId);
                renderTrackedGrid();
            } catch (err) {
                console.error('Error removing tracked customer:', err);
            }
        }

        // ---- Tracked modal ----
        let trackedModalId = null;

        function openTrackedModal(trackedId) {
            trackedModalId = trackedId;
            const modal = document.getElementById('trackedModal');
            const bodyEl = document.getElementById('tracked-modal-body');

            if (trackedId) {
                const c = trackedCustomers.find(t => t.id === trackedId);
                if (!c) return;
                document.getElementById('tracked-modal-title').textContent = c.name;
                document.getElementById('tracked-modal-subtitle').textContent = [c.organization, c.tenantName, c.email].filter(Boolean).join(' · ');
                bodyEl.innerHTML = buildTrackedModalBody(c);
            } else {
                // New tracked customer (manual add)
                document.getElementById('tracked-modal-title').textContent = 'Add Tracked Customer';
                document.getElementById('tracked-modal-subtitle').textContent = '';
                bodyEl.innerHTML = buildTrackedModalBody(null);
            }

            modal.style.display = 'block';
            // Focus first input
            setTimeout(() => { const f = bodyEl.querySelector('input, textarea'); if (f) f.focus(); }, 50);
        }

        function closeTrackedModal() {
            document.getElementById('trackedModal').style.display = 'none';
            trackedModalId = null;
        }

        function buildTrackedModalBody(c) {
            const health = c ? (c.health || 'unknown') : 'unknown';
            const stage = c ? (c.stage || '') : '';
            const notes = c ? (c.notes || '') : '';
            const nextFollowUp = c ? (c.nextFollowUp || '') : '';
            const touchpoints = c ? (c.touchpoints || []) : [];
            const today = new Date().toISOString().split('T')[0];

            const tpListHtml = touchpoints.length > 0
                ? touchpoints.map(tp => `
                    <div class="touchpoint-item" id="tp-${tp.id}">
                        <span class="touchpoint-icon">${touchpointIcon(tp.type)}</span>
                        <div class="touchpoint-body">
                            <div class="touchpoint-note">${tp.note}</div>
                            <div class="touchpoint-meta">
                                <span class="touchpoint-type-badge">${tp.type}</span>
                                ${tp.date}
                            </div>
                        </div>
                        <button class="touchpoint-delete" title="Delete" onclick="deleteTouchpoint('${tp.id}')">×</button>
                    </div>`).join('')
                : '<p style="font-size:13px;color:var(--color-text-subtle);margin:0">No touchpoints yet — log your first interaction below.</p>';

            // Always show name/org/email/tenant (editable for both new and existing)
            const nameRow = `
                <div class="tracked-form-row">
                    <div>
                        <label class="tracked-label">Name *</label>
                        <input class="tracked-input" id="tm-name" placeholder="Full name" value="${escapeHtml(c ? (c.name || '') : '')}">
                    </div>
                    <div>
                        <label class="tracked-label">Organization</label>
                        <input class="tracked-input" id="tm-org" placeholder="Company name" value="${escapeHtml(c ? (c.organization || '') : '')}">
                    </div>
                </div>
                <div class="tracked-form-row">
                    <div>
                        <label class="tracked-label">Tenant Name</label>
                        <input class="tracked-input" id="tm-tenant" placeholder="e.g. acme-corp" value="${escapeHtml(c ? (c.tenantName || '') : '')}">
                    </div>
                    <div>
                        <label class="tracked-label">Email</label>
                        <input class="tracked-input" id="tm-email" type="email" placeholder="email@example.com" value="${escapeHtml(c ? (c.email || '') : '')}">
                    </div>
                </div>`;

            return `
                ${nameRow}
                <div class="tracked-form-row">
                    <div>
                        <label class="tracked-label">Health</label>
                        <select class="tracked-select health-${health}" id="tm-health" onchange="this.className='tracked-select health-'+this.value">
                            <option value="good" ${health==='good'?'selected':''}>Good</option>
                            <option value="needs-attention" ${health==='needs-attention'?'selected':''}>Needs Attention</option>
                            <option value="at-risk" ${health==='at-risk'?'selected':''}>At Risk</option>
                            <option value="unknown" ${health==='unknown'?'selected':''}>Unknown</option>
                        </select>
                    </div>
                    <div>
                        <label class="tracked-label">Stage</label>
                        <input class="tracked-input" id="tm-stage" placeholder="e.g. Onboarding, Active, Churned…" value="${stage}">
                    </div>
                </div>
                <div class="tracked-form-row">
                    <div>
                        <label class="tracked-label">Next Follow-up</label>
                        <input class="tracked-input" type="date" id="tm-followup" value="${nextFollowUp}">
                    </div>
                </div>
                <div>
                    <label class="tracked-label">Notes</label>
                    <textarea class="tracked-textarea" id="tm-notes" placeholder="Customer context, open issues, goals…">${notes}</textarea>
                </div>

                <div class="touchpoints-section">
                    <p class="touchpoints-title">Touchpoints</p>
                    <div class="touchpoint-list" id="tp-list">${tpListHtml}</div>
                    <div class="add-touchpoint-form">
                        <select class="tracked-select" id="tp-type" style="width:110px;flex-shrink:0">
                            <option value="email">Email</option>
                            <option value="call">Call</option>
                            <option value="slack">Slack</option>
                            <option value="meeting">Meeting</option>
                            <option value="other">Other</option>
                        </select>
                        <input class="tracked-input" type="date" id="tp-date" value="${today}" style="width:145px;flex-shrink:0">
                        <input class="tracked-input" id="tp-note" placeholder="What happened? (press Enter to add)">
                        <button class="add-tp-btn" onclick="addTouchpoint()">Add</button>
                    </div>
                </div>

                <div style="display:flex;justify-content:flex-end;gap:10px;padding-top:4px;border-top:1px solid var(--color-border)">
                    <button class="cancel-button" onclick="closeTrackedModal()">Cancel</button>
                    <button class="save-button" onclick="saveTrackedModal()">Save</button>
                </div>`;
        }

        // Enter key on touchpoint note field
        document.addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.target.id === 'tp-note') {
                e.preventDefault();
                addTouchpoint();
            }
        });

        async function saveTrackedModal() {
            const health = document.getElementById('tm-health')?.value;
            const stage = document.getElementById('tm-stage')?.value || '';
            const notes = document.getElementById('tm-notes')?.value || '';
            const nextFollowUp = document.getElementById('tm-followup')?.value || null;

            if (!trackedModalId) {
                // New manual customer
                const name = document.getElementById('tm-name')?.value?.trim();
                if (!name) { alert('Name is required.'); return; }
                const org = document.getElementById('tm-org')?.value?.trim() || null;
                const tenant = document.getElementById('tm-tenant')?.value?.trim() || null;
                const email = document.getElementById('tm-email')?.value?.trim() || null;
                try {
                    const response = await fetch('/api/tracked', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, organization: org, tenantName: tenant, email, health, stage, notes, nextFollowUp })
                    });
                    if (!response.ok) throw new Error('Failed');
                    const data = await response.json();
                    trackedCustomers.unshift(data.tracked);
                    trackedLoaded = true;
                    renderTrackedGrid();
                    closeTrackedModal();
                } catch (err) { alert('Failed to save.'); }
            } else {
                const name = document.getElementById('tm-name')?.value?.trim();
                if (!name) { alert('Name is required.'); return; }
                const org = document.getElementById('tm-org')?.value?.trim() || null;
                const tenant = document.getElementById('tm-tenant')?.value?.trim() || null;
                const email = document.getElementById('tm-email')?.value?.trim() || null;
                try {
                    const response = await fetch(`/api/tracked/${trackedModalId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, organization: org, tenantName: tenant, email, health, stage, notes, nextFollowUp: nextFollowUp || null })
                    });
                    if (!response.ok) throw new Error('Failed');
                    const idx = trackedCustomers.findIndex(c => c.id === trackedModalId);
                    if (idx !== -1) {
                        trackedCustomers[idx] = { ...trackedCustomers[idx], name, organization: org, tenantName: tenant, email, health, stage, notes, nextFollowUp: nextFollowUp || null };
                    }
                    // Update modal header
                    document.getElementById('tracked-modal-title').textContent = name;
                    document.getElementById('tracked-modal-subtitle').textContent = [org, tenant, email].filter(Boolean).join(' · ');
                    document.getElementById('tracked-count').textContent = trackedCustomers.length;
                    renderTrackedGrid();
                    closeTrackedModal();
                } catch (err) { alert('Failed to save.'); }
            }
        }

        async function addTouchpoint() {
            if (!trackedModalId) return;
            const type = document.getElementById('tp-type')?.value || 'other';
            const date = document.getElementById('tp-date')?.value || new Date().toISOString().split('T')[0];
            const note = document.getElementById('tp-note')?.value?.trim();
            if (!note) return;

            try {
                const response = await fetch(`/api/tracked/${trackedModalId}/touchpoints`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, date, note })
                });
                if (!response.ok) throw new Error('Failed');
                const data = await response.json();
                const tp = data.touchpoint;

                // Update in-memory cache
                const idx = trackedCustomers.findIndex(c => c.id === trackedModalId);
                if (idx !== -1) {
                    trackedCustomers[idx].touchpoints = trackedCustomers[idx].touchpoints || [];
                    trackedCustomers[idx].touchpoints.unshift(tp);
                }

                // Inject into UI
                const listEl = document.getElementById('tp-list');
                const item = document.createElement('div');
                item.className = 'touchpoint-item';
                item.id = `tp-${tp.id}`;
                item.innerHTML = `
                    <span class="touchpoint-icon">${touchpointIcon(tp.type)}</span>
                    <div class="touchpoint-body">
                        <div class="touchpoint-note">${tp.note}</div>
                        <div class="touchpoint-meta"><span class="touchpoint-type-badge">${tp.type}</span>${tp.date}</div>
                    </div>
                    <button class="touchpoint-delete" title="Delete" onclick="deleteTouchpoint('${tp.id}')">×</button>`;
                // Remove empty state if present
                const emptyMsg = listEl.querySelector('p');
                if (emptyMsg) emptyMsg.remove();
                listEl.insertBefore(item, listEl.firstChild);
                document.getElementById('tp-note').value = '';
            } catch (err) { alert('Failed to add touchpoint.'); }
        }

        async function deleteTouchpoint(tpId) {
            if (!trackedModalId) return;
            try {
                const response = await fetch(`/api/tracked/${trackedModalId}/touchpoints/${tpId}`, { method: 'DELETE' });
                if (!response.ok) throw new Error('Failed');
                const idx = trackedCustomers.findIndex(c => c.id === trackedModalId);
                if (idx !== -1) {
                    trackedCustomers[idx].touchpoints = (trackedCustomers[idx].touchpoints || []).filter(tp => tp.id !== tpId);
                }
                document.getElementById(`tp-${tpId}`)?.remove();
                const listEl = document.getElementById('tp-list');
                if (listEl && listEl.children.length === 0) {
                    listEl.innerHTML = '<p style="font-size:13px;color:var(--color-text-subtle);margin:0">No touchpoints yet — log your first interaction below.</p>';
                }
            } catch (err) { alert('Failed to delete touchpoint.'); }
        }

        // =========================================
        // TRACKED CARD DRAG-AND-DROP (4 sections)
        // =========================================

        let trackedDragSrcId = null;

        // Map zone element IDs to category keys
        const ZONE_TO_CATEGORY = {
            'tracked-focus-zone':  'focus',
            'tracked-paying-zone': 'paying',
            'tracked-trial-zone':  'trial',
            'tracked-grid':        null
        };

        // CSS class applied to each zone when dragging over it
        const ZONE_OVER_CLASS = {
            'tracked-focus-zone':  'tracked-zone-over',
            'tracked-paying-zone': 'tracked-zone-over',
            'tracked-trial-zone':  'tracked-zone-over',
            'tracked-grid':        'tracked-zone-over'
        };

        function initTrackedDragDrop() {
            // Wire up all draggable cards
            document.querySelectorAll('.tracked-card[draggable]').forEach(card => {
                card.addEventListener('dragstart', onTrackedDragStart);
                card.addEventListener('dragend',   onTrackedDragEnd);
                card.addEventListener('dragover',  onTrackedCardDragOver);
                card.addEventListener('dragleave', onTrackedCardDragLeave);
                card.addEventListener('drop',      onTrackedCardDrop);
            });

            // Wire up all four zone containers as drop targets
            Object.keys(ZONE_TO_CATEGORY).forEach(zoneId => {
                const zone = document.getElementById(zoneId);
                if (!zone) return;
                zone.addEventListener('dragover',  onZoneDragOver);
                zone.addEventListener('dragleave', onZoneDragLeave);
                zone.addEventListener('drop',      onZoneDrop);
            });
        }

        function onTrackedDragStart(e) {
            trackedDragSrcId = this.dataset.trackedId;
            this.classList.add('tracked-card-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', trackedDragSrcId);
        }

        function onTrackedDragEnd() {
            trackedDragSrcId = null;
            document.querySelectorAll('.tracked-card').forEach(c => {
                c.classList.remove('tracked-card-dragging', 'tracked-card-drag-over');
            });
            Object.keys(ZONE_TO_CATEGORY).forEach(zoneId => {
                const zone = document.getElementById(zoneId);
                if (zone) zone.classList.remove('tracked-zone-over');
            });
        }

        // Card → card: reorder within same section OR move to different section
        function onTrackedCardDragOver(e) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            if (this.dataset.trackedId !== trackedDragSrcId) {
                this.classList.add('tracked-card-drag-over');
            }
        }

        function onTrackedCardDragLeave() {
            this.classList.remove('tracked-card-drag-over');
        }

        async function onTrackedCardDrop(e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.remove('tracked-card-drag-over');

            const targetId = this.dataset.trackedId;
            if (!trackedDragSrcId || trackedDragSrcId === targetId) return;

            const srcCustomer = trackedCustomers.find(c => c.id === trackedDragSrcId);
            const tgtCustomer = trackedCustomers.find(c => c.id === targetId);
            if (!srcCustomer || !tgtCustomer) return;

            const oldCategory = srcCustomer.category || null;
            const newCategory = tgtCustomer.category || null;

            // Reorder in-memory array
            const srcIdx = trackedCustomers.findIndex(c => c.id === trackedDragSrcId);
            const tgtIdx = trackedCustomers.findIndex(c => c.id === targetId);
            const moved = trackedCustomers.splice(srcIdx, 1)[0];
            trackedCustomers.splice(tgtIdx, 0, moved);

            // Update category to match the target card's section
            moved.category = newCategory;

            renderTrackedGrid();

            // Persist category change if it changed
            if (oldCategory !== newCategory) {
                try {
                    await fetch(`/api/tracked/${moved.id}/category`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ category: newCategory })
                    });
                } catch (err) {
                    console.error('Failed to persist category:', err);
                }
            }

            await persistTrackedOrder();
        }

        // Zone → drop on the zone background (empty zone or between cards)
        function onZoneDragOver(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this.classList.add('tracked-zone-over');
        }

        function onZoneDragLeave(e) {
            // Only remove highlight when truly leaving the zone (not entering a child)
            if (!this.contains(e.relatedTarget)) {
                this.classList.remove('tracked-zone-over');
            }
        }

        async function onZoneDrop(e) {
            e.preventDefault();
            this.classList.remove('tracked-zone-over');

            if (!trackedDragSrcId) return;
            const srcCustomer = trackedCustomers.find(c => c.id === trackedDragSrcId);
            if (!srcCustomer) return;

            const zoneId    = this.id;
            const newCategory = ZONE_TO_CATEGORY[zoneId];
            const oldCategory = srcCustomer.category || null;

            if (oldCategory === newCategory) return; // same section — no category change needed; card drop handles ordering

            srcCustomer.category = newCategory;

            // Move the card to the end of the target group in the array
            const srcIdx = trackedCustomers.findIndex(c => c.id === trackedDragSrcId);
            const moved = trackedCustomers.splice(srcIdx, 1)[0];

            // Insert after all existing cards in the new category
            const lastInCategory = [...trackedCustomers].reverse().findIndex(c => (c.category || null) === newCategory);
            if (lastInCategory === -1) {
                // No cards in that category yet — find first card of next category group
                const categoryOrder = ['focus', 'paying', 'trial', null];
                const newRank = categoryOrder.indexOf(newCategory);
                const insertBefore = trackedCustomers.findIndex(c => categoryOrder.indexOf(c.category || null) > newRank);
                if (insertBefore === -1) {
                    trackedCustomers.push(moved);
                } else {
                    trackedCustomers.splice(insertBefore, 0, moved);
                }
            } else {
                const insertIdx = trackedCustomers.length - lastInCategory;
                trackedCustomers.splice(insertIdx, 0, moved);
            }

            renderTrackedGrid();

            try {
                await fetch(`/api/tracked/${moved.id}/category`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ category: newCategory })
                });
            } catch (err) {
                console.error('Failed to persist category:', err);
            }

            await persistTrackedOrder();
        }

        async function persistTrackedOrder() {
            // Persist order: assign cardOrder based on current array positions
            const order = trackedCustomers.map((c, i) => ({ id: c.id, cardOrder: i }));
            order.forEach(({ id, cardOrder }) => {
                const c = trackedCustomers.find(x => x.id === id);
                if (c) c.cardOrder = cardOrder;
            });

            try {
                await fetch('/api/tracked/reorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order })
                });
            } catch (err) {
                console.error('Failed to persist tracked card order:', err);
            }
        }
