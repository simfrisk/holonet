        // =========================================
        // ADD / EDIT CONTACT MODAL
        // =========================================

        function openAddContactModal() {
            editingContactId = null;
            document.getElementById('ac-name').value = '';
            document.getElementById('ac-email').value = '';
            document.getElementById('ac-tenant').value = '';
            document.getElementById('ac-priority').value = 'medium';
            document.getElementById('ac-activity').value = '';
            document.getElementById('ac-notes').value = '';
            document.getElementById('addContactModalTitle').textContent = 'Add Contact Manually';
            const submitBtn = document.getElementById('addContactSubmitBtn');
            submitBtn.textContent = 'Add Contact';
            submitBtn.disabled = false;
            document.getElementById('ac-error').style.display = 'none';
            document.getElementById('addContactModal').style.display = 'block';
            document.getElementById('ac-name').focus();
        }

        function openEditModal(contactId) {
            const contact = contactsData && contactsData.contacts.find(c => c.id === contactId);
            if (!contact) return;
            editingContactId = contactId;
            document.getElementById('ac-name').value = contact.name || '';
            document.getElementById('ac-email').value = contact.email || '';
            document.getElementById('ac-tenant').value = contact.tenantName || '';
            document.getElementById('ac-priority').value = contact.priority || 'medium';
            document.getElementById('ac-activity').value = contact.activitySummary || '';
            document.getElementById('ac-notes').value = contact.notes || '';
            document.getElementById('addContactModalTitle').textContent = 'Edit Contact';
            const submitBtn = document.getElementById('addContactSubmitBtn');
            submitBtn.textContent = 'Save Changes';
            submitBtn.disabled = false;
            document.getElementById('ac-error').style.display = 'none';
            document.getElementById('addContactModal').style.display = 'block';
            document.getElementById('ac-name').focus();
        }

        function closeAddContactModal() {
            document.getElementById('addContactModal').style.display = 'none';
            editingContactId = null;
        }

        async function submitAddContact() {
            const name = document.getElementById('ac-name').value.trim();
            const email = document.getElementById('ac-email').value.trim();
            const tenantName = document.getElementById('ac-tenant').value.trim();
            const priority = document.getElementById('ac-priority').value;
            const activitySummary = document.getElementById('ac-activity').value.trim();
            const notes = document.getElementById('ac-notes').value.trim();
            const errorEl = document.getElementById('ac-error');
            const submitBtn = document.getElementById('addContactSubmitBtn');

            if (!name) {
                errorEl.textContent = 'Name is required.';
                errorEl.style.display = 'block';
                return;
            }

            errorEl.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving...';

            if (editingContactId) {
                try {
                    const response = await fetch(`/api/contacts/${editingContactId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, email, tenantName, priority, activitySummary, notes })
                    });
                    if (!response.ok) throw new Error('Failed to update contact');

                    if (contactsData) {
                        const contact = contactsData.contacts.find(c => c.id === editingContactId);
                        if (contact) {
                            contact.name = name; contact.email = email; contact.tenantName = tenantName;
                            contact.priority = priority; contact.activitySummary = activitySummary; contact.notes = notes;
                        }
                    }

                    const existingRow = document.querySelector(`[data-contact-id="${editingContactId}"]`);
                    if (existingRow) {
                        const updatedContact = contactsData.contacts.find(c => c.id === editingContactId);
                        const newRow = createContactRow(updatedContact);
                        // Preserve tab-specific classes
                        if (existingRow.classList.contains('archived-row')) newRow.classList.add('archived-row');
                        if (existingRow.classList.contains('later-row')) newRow.classList.add('later-row');
                        if (existingRow.classList.contains('skip-row')) newRow.classList.add('skip-row');
                        existingRow.replaceWith(newRow);
                        const noteField = document.getElementById(`note-${editingContactId}`);
                        if (noteField) noteField.value = notes;
                    }
                    closeAddContactModal();
                } catch (err) {
                    errorEl.textContent = 'Error updating contact. Please try again.';
                    errorEl.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Save Changes';
                }
            } else {
                try {
                    const response = await fetch('/api/contacts', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, email, tenantName, priority, activitySummary })
                    });
                    if (!response.ok) throw new Error('Failed to create contact');
                    const result = await response.json();
                    const contact = result.contact;

                    if (contactsData) contactsData.contacts.unshift(contact);
                    const row = createContactRow(contact);
                    const tbody = document.getElementById('active-table-body');
                    tbody.insertBefore(row, tbody.firstChild);

                    if (notes) {
                        saveNote(contact.id, notes);
                        const noteField = document.getElementById(`note-${contact.id}`);
                        if (noteField) noteField.value = notes;
                    }

                    saveRowOrder(tbody);
                    updateStats();
                    updateTabCounts();
                    updateAllEmptyStates();
                    closeAddContactModal();
                } catch (err) {
                    errorEl.textContent = 'Error saving contact. Please try again.';
                    errorEl.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Add Contact';
                }
            }
        }
