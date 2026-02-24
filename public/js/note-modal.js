        // =========================================
        // NOTE MODAL
        // =========================================
        let currentContactId = null;

        function openNoteModal(contactId, contactName, contactEmail) {
            currentContactId = contactId;
            document.getElementById('modalContactName').textContent = contactName;
            document.getElementById('modalContactInfo').textContent = contactEmail;
            const noteField = document.getElementById(`note-${contactId}`);
            document.getElementById('modalNoteTextarea').value = noteField ? noteField.value : '';
            document.getElementById('noteModal').style.display = 'block';
            document.getElementById('modalNoteTextarea').focus();
            updateCharCount();
        }

        function closeNoteModal() {
            document.getElementById('noteModal').style.display = 'none';
        }

        async function saveModalNote() {
            const modalTextarea = document.getElementById('modalNoteTextarea');
            const saveBtn = document.getElementById('saveModalNoteBtn');
            const value = modalTextarea.value;

            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';

            try {
                await saveNote(currentContactId, value);
                const inlineTextarea = document.getElementById(`note-${currentContactId}`);
                if (inlineTextarea) inlineTextarea.value = value;
                closeNoteModal();
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save & Close';
            }
        }

        function updateCharCount() {
            const modalTextarea = document.getElementById('modalNoteTextarea');
            document.getElementById('charCount').textContent = `${modalTextarea.value.length} characters`;
        }
