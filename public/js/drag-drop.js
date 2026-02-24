        // =========================================
        // DRAG AND DROP
        // =========================================
        let dragState = null;
        let rafId = null;

        function initDragAndDrop() {
            const tbody = document.getElementById('active-table-body');
            tbody.addEventListener('pointerdown', onDragPointerDown);
        }

        function onDragPointerDown(e) {
            const handle = e.target.closest('.drag-handle');
            if (!handle) return;
            const row = handle.closest('tr');
            if (!row) return;

            e.preventDefault();

            const tbody = document.getElementById('active-table-body');
            const rowRect = row.getBoundingClientRect();

            const table = document.createElement('table');
            table.className = 'drag-ghost';
            table.style.width = rowRect.width + 'px';
            table.style.top = rowRect.top + 'px';
            table.style.left = rowRect.left + 'px';
            const ghostTbody = document.createElement('tbody');
            const ghostRow = row.cloneNode(true);
            const liveCells = row.querySelectorAll('td');
            const ghostCells = ghostRow.querySelectorAll('td');
            liveCells.forEach((cell, i) => {
                ghostCells[i].style.width = cell.getBoundingClientRect().width + 'px';
            });
            ghostTbody.appendChild(ghostRow);
            table.appendChild(ghostTbody);
            document.body.appendChild(table);

            const placeholder = document.createElement('tr');
            placeholder.className = 'drag-placeholder';
            const placeholderTd = document.createElement('td');
            placeholderTd.colSpan = 9;
            placeholderTd.style.height = rowRect.height + 'px';
            placeholder.appendChild(placeholderTd);
            row.parentNode.insertBefore(placeholder, row);

            row.classList.add('drag-source');
            document.body.classList.add('dragging-active');

            dragState = {
                row, tbody, ghost: table, placeholder,
                startY: e.clientY, offsetY: e.clientY - rowRect.top, latestY: e.clientY,
            };

            handle.setPointerCapture(e.pointerId);
            document.addEventListener('pointermove', onDragPointerMove);
            document.addEventListener('pointerup', onDragPointerUp);
        }

        function onDragPointerMove(e) {
            if (!dragState) return;
            dragState.latestY = e.clientY;
            if (!rafId) rafId = requestAnimationFrame(updateDragFrame);
        }

        function updateDragFrame() {
            rafId = null;
            if (!dragState) return;
            const { ghost, placeholder, tbody, offsetY, latestY } = dragState;
            ghost.style.top = (latestY - offsetY) + 'px';
            const rows = Array.from(tbody.querySelectorAll('tr:not(.drag-source):not(.drag-placeholder)'));
            let insertBefore = null;
            for (const r of rows) {
                const rect = r.getBoundingClientRect();
                if (latestY < rect.top + rect.height / 2) { insertBefore = r; break; }
            }
            if (insertBefore) tbody.insertBefore(placeholder, insertBefore);
            else tbody.appendChild(placeholder);
        }

        function onDragPointerUp() {
            if (!dragState) return;
            const { row, ghost, placeholder, tbody } = dragState;
            placeholder.replaceWith(row);
            ghost.remove();
            row.classList.remove('drag-source');
            document.body.classList.remove('dragging-active');
            document.removeEventListener('pointermove', onDragPointerMove);
            document.removeEventListener('pointerup', onDragPointerUp);
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            dragState = null;
            saveRowOrder(tbody);
        }

        async function saveRowOrder(tbody) {
            const rows = Array.from(tbody.querySelectorAll('tr:not(.drag-placeholder)'));
            const order = rows.map((row, index) => ({
                id: row.dataset.contactId,
                sortOrder: index
            })).filter(item => item.id);

            try {
                await fetch('/api/contacts/reorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order })
                });
            } catch (err) {
                console.error('Failed to save row order:', err);
            }
        }
