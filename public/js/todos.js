        // =========================================
        // TODOS
        // =========================================

        let todosData = [];
        // Per-list filter state: { [listId]: 'active' | 'done' }
        let todoFilters = {};
        let todosLoaded = false;

        // =========================================
        // TODO LISTS
        // =========================================

        let todoLists = [];
        let todoListsLoaded = false;

        async function loadTodosTab() {
            try {
                // Load lists first, then todos
                const [listsRes, todosRes] = await Promise.all([
                    fetch('/api/todolists'),
                    fetch('/api/todos')
                ]);

                if (listsRes.ok) {
                    const listsData = await listsRes.json();
                    todoLists = listsData.lists || [];
                    // Ensure default list is present in memory even if DB hasn't refreshed yet
                    if (!todoLists.find(l => l.id === 'todolist-default')) {
                        todoLists.unshift({ id: 'todolist-default', name: 'Default', sortOrder: 0 });
                    }
                    todoListsLoaded = true;
                }

                if (todosRes.ok) {
                    const data = await todosRes.json();
                    todosData = data.todos || [];
                    // Ensure all todos have a listId
                    todosData.forEach(t => { if (!t.listId) t.listId = 'todolist-default'; });
                }

                todosLoaded = true;
                renderAllTodoColumns();
                updateTodosCount();
            } catch (err) {
                console.error('Failed to load todos:', err);
            }
        }

        function updateTodosCount() {
            const el = document.getElementById('todos-count');
            if (el) el.textContent = todosData.filter(t => !t.done).length;
        }

        // =========================================
        // RENDER ALL LISTS AS COLUMNS
        // =========================================

        function renderAllTodoColumns() {
            const grid = document.getElementById('todo-columns-grid');
            if (!grid) return;

            // Render a column for each list
            grid.innerHTML = todoLists.map(list => buildColumnHtml(list)).join('');

            // Wire up drag-and-drop for each list's items
            todoLists.forEach(list => {
                initTodoDragDropForList(list.id);
            });
        }

        function buildColumnHtml(list) {
            const listId = list.id;
            const filter = todoFilters[listId] || 'active';
            const isDefault = listId === 'todolist-default';
            const listTodos = todosData.filter(t => (t.listId || 'todolist-default') === listId);
            const doneCount = listTodos.filter(t => t.done).length;

            const deleteBtn = isDefault ? '' :
                `<button class="todo-column-del-btn" title="Delete list"
                         onclick="deleteTodoList('${escapeAttr(listId)}')">&#x2715;</button>`;

            const itemsHtml = buildTodoItemsHtml(listId, filter);

            return `<div class="todo-column" id="todo-column-${escapeHtml(listId)}">
                <div class="todo-column-header">
                    <h3 class="todo-column-title">${escapeHtml(list.name)}</h3>
                    ${deleteBtn}
                </div>

                <div class="todo-filters">
                    <button class="todo-filter-btn ${filter === 'active' ? 'active' : ''}"
                            data-filter="active"
                            onclick="filterTodos('active', '${escapeAttr(listId)}')">Active</button>
                    <button class="todo-filter-btn ${filter === 'done' ? 'active' : ''}"
                            data-filter="done"
                            onclick="filterTodos('done', '${escapeAttr(listId)}')">Archived</button>
                    <button class="todo-clear-done" onclick="clearDoneTodos('${escapeAttr(listId)}')" ${doneCount === 0 ? 'disabled' : ''}>Clear done</button>
                </div>

                <div class="todo-list" id="todo-list-${escapeHtml(listId)}">${itemsHtml}</div>

                <button class="todo-new-btn" onclick="quickAddTodo('${escapeAttr(listId)}')">+ New</button>
            </div>`;
        }

        function buildTodoItemsHtml(listId, filter) {
            let filtered = todosData.filter(t => (t.listId || 'todolist-default') === listId);
            if (filter === 'active') filtered = filtered.filter(t => !t.done);
            else if (filter === 'done') filtered = filtered.filter(t => t.done);

            // Sort by sortOrder (if set), then by createdAt
            filtered.sort((a, b) => {
                const aSort = a.sortOrder != null ? a.sortOrder : Infinity;
                const bSort = b.sortOrder != null ? b.sortOrder : Infinity;
                if (aSort !== bSort) return aSort - bSort;
                return (a.createdAt || '').localeCompare(b.createdAt || '');
            });

            if (filtered.length === 0) {
                const msgs = {
                    active: ['All done!', 'No active tasks.'],
                    done:   ['Nothing completed yet', 'Finish a task and it will show up here.']
                };
                const [title, sub] = msgs[filter] || ['Nothing here yet', 'Type a task above and press Enter.'];
                return `<div class="todo-empty">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <h3>${title}</h3><p>${sub}</p>
                </div>`;
            }

            return filtered.map(todo => buildTodoItemHtml(todo)).join('');
        }

        // Re-render just the list div for a specific list (without rebuilding the whole column)
        function rerenderTodoListDiv(listId) {
            const listEl = document.getElementById(`todo-list-${listId}`);
            if (!listEl) return;
            const filter = todoFilters[listId] || 'active';
            listEl.innerHTML = buildTodoItemsHtml(listId, filter);
            initTodoDragDropForList(listId);
        }

        function filterTodos(filter, listId) {
            todoFilters[listId] = filter;
            // Update filter button states within this column
            const col = document.getElementById(`todo-column-${listId}`);
            if (col) {
                col.querySelectorAll('.todo-filter-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.filter === filter);
                });
            }
            rerenderTodoListDiv(listId);
        }

        // =========================================
        // ADD / MANAGE LISTS
        // =========================================

        async function addTodoList() {
            const input = document.getElementById('todo-list-name-input');
            if (!input) return;
            const name = (input.value || '').trim();
            if (!name) { input.focus(); return; }

            try {
                const res = await fetch('/api/todolists', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
                if (!res.ok) throw new Error('Failed');
                const data = await res.json();
                todoLists.push(data.list);
                input.value = '';
                renderAllTodoColumns();
            } catch (err) {
                console.error('Failed to create list:', err);
            }
        }

        async function deleteTodoList(listId) {
            if (!confirm('Delete this list? Its todos will be moved to Default.')) return;
            try {
                const res = await fetch(`/api/todolists/${listId}`, { method: 'DELETE' });
                if (!res.ok) throw new Error('Failed');
                todoLists = todoLists.filter(l => l.id !== listId);
                // Move todos in memory to default
                todosData.forEach(t => { if (t.listId === listId) t.listId = 'todolist-default'; });
                delete todoFilters[listId];
                renderAllTodoColumns();
            } catch (err) {
                console.error('Failed to delete list:', err);
            }
        }

        // =========================================
        // RENDER TODO ITEMS
        // =========================================

        function todoHasContent(todo) {
            return todo.content && Array.isArray(todo.content) && todo.content.length > 0;
        }

        function todoContentHasMeaningfulContent(contentBlocks) {
            if (!contentBlocks || !Array.isArray(contentBlocks)) return false;
            return contentBlocks.some(block => {
                if (block.type === 'text') {
                    return Boolean(todoBlockValueToPlainText(block.value).trim() || /<img\b/i.test(block.value || ''));
                }
                if (block.type === 'checklist') {
                    return Array.isArray(block.items) && block.items.some(item => (item.text || '').trim());
                }
                return false;
            });
        }

        function isEmptyDraftTodo(todo, title, contentBlocks) {
            if (!todo || !todo._isDraft) return false;
            const normalizedTitle = (title || '').trim();
            const hasCustomTitle = normalizedTitle && normalizedTitle !== 'Untitled';
            return !hasCustomTitle
                && !todo.priority
                && !todo.dueDate
                && !todoContentHasMeaningfulContent(contentBlocks);
        }

        // Strip HTML tags + markdown image syntax to a plain-text preview.
        function todoBlockValueToPlainText(value) {
            if (!value) return '';
            // Remove markdown image syntax first.
            let s = String(value).replace(/!\[[^\]]*\]\([^\s)]+\)/g, '');
            // If it looks like HTML, parse and read textContent.
            if (/<[a-z][\s\S]*>/i.test(s)) {
                const tpl = document.createElement('template');
                tpl.innerHTML = s;
                s = tpl.content.textContent || '';
            }
            return s.replace(/\s+/g, ' ').trim();
        }

        function buildContentIndicatorsHtml(contentBlocks) {
            if (!contentBlocks || contentBlocks.length === 0) return '';
            let noteCount = 0;
            let checkDone = 0;
            let checkTotal = 0;

            for (const block of contentBlocks) {
                if (block.type === 'text' && block.value && (todoBlockValueToPlainText(block.value).trim() || /<img\b/i.test(block.value))) {
                    noteCount++;
                } else if (block.type === 'checklist' && block.items) {
                    checkTotal += block.items.length;
                    checkDone += block.items.filter(i => i.done).length;
                }
            }

            let indicators = '';
            if (noteCount > 0) {
                indicators += `<span class="content-inline-indicator"><i class="ti ti-notes"></i> ${noteCount}</span>`;
            }
            if (checkTotal > 0) {
                const allDone = checkDone === checkTotal;
                indicators += `<span class="content-inline-indicator ${allDone ? 'checklist-done' : ''}"><i class="ti ti-checkbox"></i> ${checkDone}/${checkTotal}</span>`;
            }

            return indicators
                ? `<span class="content-inline-indicators"><button class="content-toggle-btn" onclick="event.stopPropagation(); toggleContentPreview(this)" title="Show content">&#x25BE;</button>${indicators}</span>`
                : '';
        }

        function buildClickPreviewHtml(contentBlocks) {
            if (!contentBlocks || contentBlocks.length === 0) return '';
            const MAX_ITEMS = 4;
            let lines = [];

            for (const block of contentBlocks) {
                if (lines.length >= MAX_ITEMS) break;
                if (block.type === 'text' && block.value && block.value.trim()) {
                    // Strip HTML tags & markdown image syntax for the click-preview text.
                    const plain = todoBlockValueToPlainText(block.value).trim();
                    if (!plain) continue;
                    const truncated = plain.length > 90
                        ? escapeHtml(plain.slice(0, 90)) + '…'
                        : escapeHtml(plain);
                    lines.push(`<div class="click-preview-text">${truncated}</div>`);
                } else if (block.type === 'checklist' && block.items) {
                    for (const item of block.items) {
                        if (lines.length >= MAX_ITEMS) break;
                        const doneClass = item.done ? 'done' : '';
                        lines.push(`<div class="click-preview-check ${doneClass}"><input type="checkbox" tabindex="-1" ${item.done ? 'checked' : ''} disabled><span>${escapeHtml(item.text || '')}</span></div>`);
                    }
                }
            }

            return lines.length > 0 ? `<div class="click-preview">${lines.join('')}</div>` : '';
        }

        function toggleContentPreview(btn) {
            const preview = btn.closest('.todo-text-wrap').querySelector('.click-preview');
            if (!preview) return;
            const isOpen = preview.classList.toggle('open');
            btn.classList.toggle('expanded', isOpen);
            btn.title = isOpen ? 'Hide content' : 'Show content';
        }

        function buildTodoItemHtml(todo) {
            const priorityClass = todo.priority ? `priority-${todo.priority}` : '';
            const doneClass     = todo.done ? 'done-item' : '';
            const hasContent    = todoHasContent(todo);

            let metaHtml = '';
            if (todo.priority) {
                metaHtml += `<span class="todo-priority-badge badge-${todo.priority}">${todo.priority}</span>`;
            }
            if (todo.dueDate) {
                const today = new Date().toISOString().split('T')[0];
                const isOverdue = !todo.done && todo.dueDate < today;
                metaHtml += `<span class="todo-due-chip ${isOverdue ? 'overdue' : ''}">
                    \u{1F4C5} ${formatDueDate(todo.dueDate)}${isOverdue ? ' \u2014 overdue' : ''}
                </span>`;
            }

            const inlineIndicators = hasContent ? buildContentIndicatorsHtml(todo.content) : '';
            const clickPreview = hasContent ? buildClickPreviewHtml(todo.content) : '';

            return `<div class="todo-item ${priorityClass} ${doneClass} ${hasContent ? 'has-content' : ''}" data-todo-id="${escapeHtml(todo.id)}" draggable="true"
                         onclick="if(!todoDragJustFinished && event.target.closest('.todo-checkbox, .todo-delete-btn, .todo-drag-handle')){}else if(!todoDragJustFinished){openTodoDetailModal('${escapeAttr(todo.id)}')}">
                <span class="todo-drag-handle" title="Drag to reorder">&#x2807;</span>
                <input type="checkbox" class="todo-checkbox" ${todo.done ? 'checked' : ''}
                       onchange="event.stopPropagation(); toggleTodoDone('${escapeAttr(todo.id)}', this.checked)">
                <div class="todo-text-wrap">
                    <span class="todo-text">${escapeHtml(todo.text)}</span>
                    ${metaHtml || inlineIndicators ? `<div class="todo-meta">${metaHtml}${inlineIndicators}</div>` : ''}
                    ${clickPreview}
                </div>
                <div class="todo-actions">
                    <button class="todo-action-btn todo-delete-btn"
                            onclick="event.stopPropagation(); deleteTodoItem('${escapeAttr(todo.id)}')"
                            title="Delete">&#x2715;</button>
                </div>
            </div>`;
        }

        function formatDueDate(dateStr) {
            if (!dateStr) return '';
            const d = new Date(dateStr + 'T00:00:00');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }

        // =========================================
        // ADD / EDIT / DELETE TODOS
        // =========================================

        async function quickAddTodo(listId) {
            try {
                const res = await fetch('/api/todos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: 'Untitled',
                        priority: null,
                        dueDate: null,
                        listId: listId
                    })
                });
                if (!res.ok) throw new Error('Failed');
                const data = await res.json();
                data.todo._isDraft = true;
                todosData.unshift(data.todo);
                updateTodosCount();
                rerenderTodoListDiv(listId);
                openTodoDetailModal(data.todo.id);
                // Focus the title so user can start typing immediately
                setTimeout(() => {
                    const titleEl = document.getElementById('todo-modal-title');
                    if (titleEl) { titleEl.select(); titleEl.focus(); }
                }, 100);
            } catch (err) {
                console.error('Failed to add todo:', err);
            }
        }

        async function toggleTodoDone(id, done) {
            try {
                const res = await fetch(`/api/todos/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ done })
                });
                if (!res.ok) throw new Error('Failed');
                const todo = todosData.find(t => t.id === id);
                if (todo) { todo.done = done; todo.doneAt = done ? new Date().toISOString() : null; }
                updateTodosCount();
                const listId = todo ? (todo.listId || 'todolist-default') : null;
                if (listId) rerenderTodoListDiv(listId);
            } catch (err) {
                console.error('Failed to toggle todo:', err);
            }
        }

        async function saveTodoText(id, text) {
            const trimmed = (text || '').trim();
            if (!trimmed) return;
            const todo = todosData.find(t => t.id === id);
            if (todo && todo.text === trimmed) return;
            try {
                await fetch(`/api/todos/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: trimmed })
                });
                if (todo) todo.text = trimmed;
            } catch (err) {
                console.error('Failed to save todo text:', err);
            }
        }

        function deleteTodoItem(id) {
            const itemEl = document.querySelector(`.todo-item[data-todo-id="${id}"]`);
            if (!itemEl || itemEl.querySelector('.todo-delete-overlay')) return;

            const overlay = document.createElement('div');
            overlay.className = 'todo-delete-overlay';
            overlay.innerHTML = `
                <button class="todo-delete-cancel" onclick="event.stopPropagation(); this.closest('.todo-delete-overlay').remove()">Cancel</button>
                <button class="todo-delete-confirm" onclick="event.stopPropagation(); confirmDeleteTodo('${escapeAttr(id)}')">Delete</button>
            `;
            overlay.onclick = (e) => e.stopPropagation();
            itemEl.appendChild(overlay);
        }

        async function confirmDeleteTodo(id) {
            const todo = todosData.find(t => t.id === id);
            const listId = todo ? (todo.listId || 'todolist-default') : null;
            try {
                const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
                if (!res.ok) throw new Error('Failed');
                todosData = todosData.filter(t => t.id !== id);
                updateTodosCount();
                if (listId) rerenderTodoListDiv(listId);
            } catch (err) {
                console.error('Failed to delete todo:', err);
            }
        }

        async function clearDoneTodos(listId) {
            const done = todosData.filter(t => t.done && (t.listId || 'todolist-default') === listId);
            if (done.length === 0) return;
            if (!confirm(`Delete ${done.length} completed task${done.length > 1 ? 's' : ''}?`)) return;
            try {
                await Promise.all(done.map(t => fetch(`/api/todos/${t.id}`, { method: 'DELETE' })));
                todosData = todosData.filter(t => !(t.done && (t.listId || 'todolist-default') === listId));
                updateTodosCount();
                rerenderTodoListDiv(listId);
            } catch (err) {
                console.error('Failed to clear done todos:', err);
            }
        }

        // =========================================
        // TODO DRAG-AND-DROP REORDER
        // =========================================

        let todoDragSrcId = null;
        let todoDragJustFinished = false;

        function initTodoDragDropForList(listId) {
            const listEl = document.getElementById(`todo-list-${listId}`);
            if (!listEl) return;

            listEl.querySelectorAll('.todo-item[draggable]').forEach(item => {
                item.addEventListener('dragstart', onTodoDragStart);
                item.addEventListener('dragend',   onTodoDragEnd);
                item.addEventListener('dragover',  onTodoDragOver);
                item.addEventListener('dragleave', onTodoDragLeave);
                item.addEventListener('drop',      onTodoDrop);
            });

            // Column-level handlers for dropping on empty space / below items / cross-list
            listEl.addEventListener('dragover', onTodoListDragOver);
            listEl.addEventListener('dragleave', onTodoListDragLeave);
            listEl.addEventListener('drop', onTodoListDrop);

            if (typeof initMobileCardDrag === 'function') {
                initMobileCardDrag({
                    handleSelector: `#todo-list-${CSS.escape(listId)} .todo-drag-handle`,
                    itemSelector: '.todo-item',
                    containerSelector: '.todo-list',
                    containerHighlightSelector: '.todo-column',
                    itemOverClass: 'todo-item-drag-over',
                    containerOverClass: 'todo-column-drag-over',
                    onDrop: async ({ source, targetItem, targetContainer, position }) => {
                        const srcTodo = todosData.find(t => t.id === source.dataset.todoId);
                        if (!srcTodo || !targetContainer) return;
                        const targetListId = targetContainer.id.replace('todo-list-', '');
                        const beforeId = getMobileBeforeId(targetContainer, targetItem, source, 'todoId', position);
                        await moveTodoTo(srcTodo, targetListId, beforeId);
                    }
                });
            }
        }

        // Legacy aliases so other files calling the old function names still work
        function initTodoDragDrop() {
            todoLists.forEach(l => initTodoDragDropForList(l.id));
        }
        function renderTodoLists() { renderAllTodoColumns(); }
        function renderTodoList()  { renderAllTodoColumns(); }

        function onTodoDragStart(e) {
            todoDragSrcId = this.dataset.todoId;
            todoDragJustFinished = false;
            this.classList.add('todo-item-dragging');
            e.dataTransfer.effectAllowed = 'move';
        }

        function onTodoDragEnd() {
            todoDragSrcId = null;
            todoDragJustFinished = true;
            setTimeout(() => { todoDragJustFinished = false; }, 200);
            document.querySelectorAll('.todo-item').forEach(i => {
                i.classList.remove('todo-item-dragging', 'todo-item-drag-over');
            });
            document.querySelectorAll('.todo-column-drag-over').forEach(c => {
                c.classList.remove('todo-column-drag-over');
            });
        }

        function onTodoDragOver(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (this.dataset.todoId !== todoDragSrcId) {
                this.classList.add('todo-item-drag-over');
            }
        }

        function onTodoDragLeave() {
            this.classList.remove('todo-item-drag-over');
        }

        async function onTodoDrop(e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.remove('todo-item-drag-over');

            const targetId = this.dataset.todoId;
            if (!todoDragSrcId || todoDragSrcId === targetId) return;

            const srcTodo = todosData.find(t => t.id === todoDragSrcId);
            if (!srcTodo) return;

            const targetListEl = this.closest('.todo-list');
            if (!targetListEl) return;
            const targetListId = targetListEl.id.replace('todo-list-', '');

            await moveTodoTo(srcTodo, targetListId, targetId);
        }

        function onTodoListDragOver(e) {
            if (!todoDragSrcId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const col = this.closest('.todo-column');
            if (col) col.classList.add('todo-column-drag-over');
        }

        function onTodoListDragLeave(e) {
            const col = this.closest('.todo-column');
            if (!col) return;
            // Only clear when truly leaving the column (relatedTarget is outside)
            if (!e.relatedTarget || !col.contains(e.relatedTarget)) {
                col.classList.remove('todo-column-drag-over');
            }
        }

        async function onTodoListDrop(e) {
            const col = this.closest('.todo-column');
            if (col) col.classList.remove('todo-column-drag-over');

            // If the drop landed on an item, the item handler already ran (stopPropagation)
            if (e.target.closest('.todo-item[draggable]')) return;

            e.preventDefault();
            if (!todoDragSrcId) return;

            const srcTodo = todosData.find(t => t.id === todoDragSrcId);
            if (!srcTodo) return;

            const targetListId = this.id.replace('todo-list-', '');
            await moveTodoTo(srcTodo, targetListId, null);
        }

        // Move srcTodo into targetListId, inserting before beforeId (or at end if null).
        // Reorders the target list and persists listId + new sort order.
        async function moveTodoTo(srcTodo, targetListId, beforeId) {
            const srcListId = srcTodo.listId || 'todolist-default';
            const sameList = srcListId === targetListId;
            const filter = todoFilters[targetListId] || 'active';

            // Build the visible list of the target column (excluding src)
            const targetTodos = todosData
                .filter(t => t.id !== srcTodo.id && (t.listId || 'todolist-default') === targetListId);
            let visible;
            if (filter === 'active') visible = targetTodos.filter(t => !t.done);
            else if (filter === 'done') visible = targetTodos.filter(t => t.done);
            else visible = [...targetTodos];

            visible.sort((a, b) => {
                const aSort = a.sortOrder != null ? a.sortOrder : Infinity;
                const bSort = b.sortOrder != null ? b.sortOrder : Infinity;
                if (aSort !== bSort) return aSort - bSort;
                return (a.createdAt || '').localeCompare(b.createdAt || '');
            });

            // If the source is in a different list and currently archived (done) but target column is showing 'active',
            // moving still works — we just place by listId; filter only affects visible ordering.
            const insertIdx = beforeId ? visible.findIndex(t => t.id === beforeId) : -1;
            if (insertIdx === -1) visible.push(srcTodo);
            else visible.splice(insertIdx, 0, srcTodo);

            // Update src in memory
            srcTodo.listId = targetListId;

            // Reassign sort orders for the visible target column
            const order = visible.map((t, i) => ({ id: t.id, sortOrder: i * 10 }));
            order.forEach(({ id, sortOrder }) => {
                const t = todosData.find(x => x.id === id);
                if (t) t.sortOrder = sortOrder;
            });

            // Re-render affected columns
            if (!sameList) rerenderTodoListDiv(srcListId);
            rerenderTodoListDiv(targetListId);
            updateTodosCount();

            try {
                if (!sameList) {
                    await fetch(`/api/todos/${srcTodo.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ listId: targetListId })
                    });
                }
                await fetch('/api/todos/reorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order })
                });
            } catch (err) {
                console.error('Failed to persist todo move:', err);
            }
        }

        // =========================================
        // TODO DETAIL MODAL (Notion-like)
        // =========================================

        let todoModalCurrentId = null;
        let todoModalSaveTimer = null;
        let todoModalTitleTimer = null;

        function openTodoDetailModal(todoId) {
            const todo = todosData.find(t => t.id === todoId);
            if (!todo) return;
            todoModalCurrentId = todoId;

            // Set title
            const titleEl = document.getElementById('todo-modal-title');
            titleEl.value = todo.text || '';

            // Set priority and date
            document.getElementById('todo-modal-priority').value = todo.priority || '';
            document.getElementById('todo-modal-duedate').value = todo.dueDate || '';

            // Clear save status
            updateTodoModalSaveStatus('');

            // Show modal first so scrollHeight is accurate when sizing textareas
            document.getElementById('todoDetailModal').style.display = 'block';

            // Render content blocks (textareas auto-size to fit full content)
            renderTodoDetailBlocks(todo.content || []);

            // Resize title after modal is visible so scrollHeight is accurate
            autoResizeTodoTitle(titleEl);

            // Wire up title auto-save
            titleEl.oninput = () => {
                autoResizeTodoTitle(titleEl);
                clearTimeout(todoModalTitleTimer);
                updateTodoModalSaveStatus('Unsaved changes');
                todoModalTitleTimer = setTimeout(() => {
                    const newText = titleEl.value.trim();
                    if (newText && newText !== todo.text) {
                        saveTodoText(todoId, newText);
                        todo.text = newText;
                        updateTodoModalSaveStatus('Saved');
                        rerenderTodoListDiv(todo.listId || 'todolist-default');
                    }
                }, 800);
            };
        }

        async function closeTodoDetailModal() {
            const closingId = todoModalCurrentId;
            const todo = todosData.find(t => t.id === closingId);
            const titleEl = document.getElementById('todo-modal-title');
            const newText = titleEl ? titleEl.value.trim() : '';
            const content = collectContentBlocksFromDOM();

            // Stop pending auto-saves so close can decide whether this is a real todo.
            if (todoModalSaveTimer) {
                clearTimeout(todoModalSaveTimer);
                todoModalSaveTimer = null;
            }
            if (todoModalTitleTimer) {
                clearTimeout(todoModalTitleTimer);
                todoModalTitleTimer = null;
            }

            if (isEmptyDraftTodo(todo, newText, content)) {
                await discardEmptyDraftTodo(closingId);
                document.getElementById('todoDetailModal').style.display = 'none';
                todoModalCurrentId = null;
                return;
            }

            if (todo) {
                if (newText && newText !== todo.text) {
                    await saveTodoText(closingId, newText);
                    todo.text = newText;
                }
                if (todo._isDraft) delete todo._isDraft;
            }

            if (closingId) {
                await saveTodoModalContentNow();
            }

            document.getElementById('todoDetailModal').style.display = 'none';

            // Re-render the list to show updated content indicators
            if (todo) rerenderTodoListDiv(todo.listId || 'todolist-default');

            todoModalCurrentId = null;
        }

        async function discardEmptyDraftTodo(id) {
            const todo = todosData.find(t => t.id === id);
            const listId = todo ? (todo.listId || 'todolist-default') : null;
            try {
                await fetch(`/api/todos/${id}`, { method: 'DELETE' });
            } catch (err) {
                console.error('Failed to discard empty draft todo:', err);
            }
            todosData = todosData.filter(t => t.id !== id);
            updateTodosCount();
            if (listId) rerenderTodoListDiv(listId);
        }

        function updateTodoModalSaveStatus(text) {
            const el = document.getElementById('todo-modal-save-status');
            if (el) el.textContent = text;
        }

        async function saveTodoModalProp() {
            if (!todoModalCurrentId) return;
            const todo = todosData.find(t => t.id === todoModalCurrentId);
            if (!todo) return;
            const priority = document.getElementById('todo-modal-priority').value || null;
            const dueDate = document.getElementById('todo-modal-duedate').value || null;
            todo.priority = priority;
            todo.dueDate = dueDate;
            try {
                updateTodoModalSaveStatus('Saving...');
                await fetch(`/api/todos/${todoModalCurrentId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ priority, dueDate })
                });
                updateTodoModalSaveStatus('Saved');
            } catch (err) {
                console.error('Failed to save todo props:', err);
                updateTodoModalSaveStatus('Save failed');
            }
        }

        // ---- Content block rendering ----

        function renderTodoDetailBlocks(content) {
            const blocksEl = document.getElementById('todo-detail-blocks');
            const emptyEl = document.getElementById('todo-detail-empty');

            if (!content || content.length === 0) {
                emptyEl.style.display = 'block';
                blocksEl.innerHTML = '';
                return;
            }

            emptyEl.style.display = 'none';
            blocksEl.innerHTML = content.map((block, idx) => {
                if (block.type === 'text') return buildTextBlockHtml(block, idx);
                if (block.type === 'checklist') return buildChecklistBlockHtml(block, idx);
                return '';
            }).join('');

            // Auto-resize all textareas (legacy textarea blocks, if any)
            blocksEl.querySelectorAll('.todo-block-textarea').forEach(autoResizeTextarea);

            // Initialize contenteditable text blocks (convert any legacy markdown images to <img>)
            content.forEach((block, idx) => {
                if (block.type === 'text') initTodoBlockEditor(idx);
            });
        }

        function buildTextBlockHtml(block, idx) {
            // Stored value may be either raw text/markdown (legacy) or HTML (new).
            // We pass it through as data and let initTodoBlockEditor convert markdown -> <img>.
            const storedValue = block.value || '';
            return `<div class="todo-content-block todo-block-text" data-block-idx="${idx}">
                <div class="todo-block-header">
                    <span class="todo-block-type-label"><i class="ti ti-text-size"></i> Text</span>
                    <div class="todo-block-header-actions">
                        <button class="todo-block-image-btn" onclick="openImagePickerForBlock(${idx})" title="Attach image">
                            <i class="ti ti-photo"></i>
                        </button>
                        <button class="todo-block-delete" onclick="deleteTodoContentBlock(${idx})" title="Remove block">&#x2715;</button>
                    </div>
                </div>
                <div class="todo-block-editor"
                    contenteditable="true"
                    data-block-idx="${idx}"
                    data-placeholder="Write something... (paste, drop, or attach an image)"
                    onpaste="handleTodoEditorPaste(event, ${idx})"
                    ondragenter="handleTodoEditorDragEnter(event)"
                    ondragover="handleTodoEditorDragOver(event)"
                    ondragleave="handleTodoEditorDragLeave(event)"
                    ondrop="handleTodoEditorDrop(event, ${idx})"
                    onclick="handleTodoEditorClick(event)"
                    onkeydown="handleTodoEditorKeydown(event, ${idx})"
                    oninput="handleTodoEditorInput(event, ${idx})"
                    data-initial-value="${escapeHtml(storedValue)}"></div>
            </div>`;
        }

        function buildChecklistBlockHtml(block, idx) {
            const items = block.items || [];
            const itemsHtml = items.map((item, itemIdx) => buildChecklistItemHtml(idx, itemIdx, item)).join('');
            return `<div class="todo-content-block todo-block-checklist" data-block-idx="${idx}">
                <div class="todo-block-header">
                    <span class="todo-block-type-label"><i class="ti ti-list-check"></i> Checklist</span>
                    <button class="todo-block-delete" onclick="deleteTodoContentBlock(${idx})" title="Remove block">&#x2715;</button>
                </div>
                <div class="todo-checklist-items" data-block-idx="${idx}">
                    ${itemsHtml}
                </div>
                <button class="todo-checklist-add-btn" onclick="addChecklistItem(${idx})">+ Add item</button>
            </div>`;
        }

        function buildChecklistItemHtml(blockIdx, itemIdx, item) {
            return `<div class="todo-checklist-item" data-block-idx="${blockIdx}" data-item-idx="${itemIdx}">
                <input type="checkbox" class="todo-checklist-checkbox" ${item.done ? 'checked' : ''}
                       onchange="scheduleTodoModalSave()">
                <input type="text" class="todo-checklist-text ${item.done ? 'checked-text' : ''}" value="${escapeHtml(item.text || '')}"
                       placeholder="To-do item..."
                       oninput="scheduleTodoModalSave()"
                       onkeydown="handleChecklistKeydown(event, ${blockIdx}, ${itemIdx})">
                <button class="todo-checklist-item-delete" onclick="deleteChecklistItem(${blockIdx}, ${itemIdx})" title="Remove">&#x2715;</button>
            </div>`;
        }

        function autoResizeTextarea(el) {
            el.style.height = 'auto';
            el.style.height = el.scrollHeight + 'px';
        }

        function autoResizeTodoTitle(el) {
            el.style.height = 'auto';
            el.style.height = el.scrollHeight + 'px';
        }

        // ---- Content block actions ----

        function addTodoContentBlock(type) {
            syncContentToMemory();
            const todo = todosData.find(t => t.id === todoModalCurrentId);
            if (!todo) return;
            if (!todo.content) todo.content = [];

            if (type === 'text') {
                todo.content.push({ type: 'text', id: 'block-' + Date.now(), value: '' });
            } else if (type === 'checklist') {
                todo.content.push({ type: 'checklist', id: 'block-' + Date.now(), items: [{ id: 'item-' + Date.now(), text: '', done: false }] });
            }

            renderTodoDetailBlocks(todo.content);
            scheduleTodoModalSave();

            // Focus the new block
            const blocksEl = document.getElementById('todo-detail-blocks');
            const lastBlock = blocksEl.lastElementChild;
            if (lastBlock) {
                const input = lastBlock.querySelector('textarea, .todo-checklist-text');
                if (input) input.focus();
            }
        }

        function deleteTodoContentBlock(idx) {
            syncContentToMemory();
            const todo = todosData.find(t => t.id === todoModalCurrentId);
            if (!todo || !todo.content) return;
            todo.content.splice(idx, 1);
            renderTodoDetailBlocks(todo.content);
            scheduleTodoModalSave();
        }

        function addChecklistItem(blockIdx) {
            syncContentToMemory();
            const todo = todosData.find(t => t.id === todoModalCurrentId);
            if (!todo || !todo.content || !todo.content[blockIdx]) return;
            const block = todo.content[blockIdx];
            if (!block.items) block.items = [];
            block.items.push({ id: 'item-' + Date.now(), text: '', done: false });
            renderTodoDetailBlocks(todo.content);
            scheduleTodoModalSave();

            // Focus the new item
            const blockEl = document.querySelector(`.todo-block-checklist[data-block-idx="${blockIdx}"]`);
            if (blockEl) {
                const items = blockEl.querySelectorAll('.todo-checklist-text');
                const lastItem = items[items.length - 1];
                if (lastItem) lastItem.focus();
            }
        }

        function deleteChecklistItem(blockIdx, itemIdx) {
            syncContentToMemory();
            const todo = todosData.find(t => t.id === todoModalCurrentId);
            if (!todo || !todo.content || !todo.content[blockIdx]) return;
            const block = todo.content[blockIdx];
            if (!block.items) return;
            block.items.splice(itemIdx, 1);
            renderTodoDetailBlocks(todo.content);
            scheduleTodoModalSave();
        }

        function handleChecklistKeydown(event, blockIdx, itemIdx) {
            if (event.key === 'Enter') {
                event.preventDefault();
                syncContentToMemory();
                addChecklistItem(blockIdx);
            }
            if (event.key === 'Backspace' && event.target.value === '') {
                event.preventDefault();
                syncContentToMemory();
                deleteChecklistItem(blockIdx, itemIdx);
            }
        }

        // Sync current DOM content into in-memory todo.content before re-renders
        function syncContentToMemory() {
            const todo = todosData.find(t => t.id === todoModalCurrentId);
            if (!todo) return;
            todo.content = collectContentBlocksFromDOM();
        }

        // ---- Auto-save ----

        function scheduleTodoModalSave() {
            clearTimeout(todoModalSaveTimer);
            updateTodoModalSaveStatus('Unsaved changes');
            todoModalSaveTimer = setTimeout(() => saveTodoModalContentNow(), 800);
        }

        function collectContentBlocksFromDOM() {
            const blocks = [];
            const blockEls = document.querySelectorAll('#todo-detail-blocks .todo-content-block');
            blockEls.forEach(el => {
                const idx = parseInt(el.dataset.blockIdx);
                if (el.classList.contains('todo-block-text')) {
                    const editor = el.querySelector('.todo-block-editor');
                    const textarea = el.querySelector('.todo-block-textarea');
                    let value;
                    if (editor) {
                        value = serializeTodoEditor(editor);
                    } else if (textarea) {
                        value = textarea.value;
                    } else {
                        value = '';
                    }
                    blocks.push({ type: 'text', id: 'block-' + idx, value });
                } else if (el.classList.contains('todo-block-checklist')) {
                    const items = [];
                    el.querySelectorAll('.todo-checklist-item').forEach(itemEl => {
                        const checkbox = itemEl.querySelector('.todo-checklist-checkbox');
                        const textInput = itemEl.querySelector('.todo-checklist-text');
                        items.push({
                            id: 'item-' + itemEl.dataset.itemIdx,
                            text: textInput ? textInput.value : '',
                            done: checkbox ? checkbox.checked : false
                        });
                    });
                    blocks.push({ type: 'checklist', id: 'block-' + idx, items });
                }
            });
            return blocks;
        }

        async function saveTodoModalContentNow() {
            todoModalSaveTimer = null;
            if (!todoModalCurrentId) return;

            const content = collectContentBlocksFromDOM();
            const todo = todosData.find(t => t.id === todoModalCurrentId);

            try {
                updateTodoModalSaveStatus('Saving...');
                await fetch(`/api/todos/${todoModalCurrentId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content })
                });
                if (todo) todo.content = content;
                updateTodoModalSaveStatus('Saved');
            } catch (err) {
                console.error('Failed to save todo content:', err);
                updateTodoModalSaveStatus('Save failed');
            }
        }

        // Close modal on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.getElementById('todoDetailModal').style.display === 'block') {
                closeTodoDetailModal();
            }
        });

        // =========================================
        // TODO TEXT BLOCK — INLINE IMAGE EDITOR (Notion-like)
        // =========================================

        const TODO_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
        const TODO_SAFE_URL_RE = /^(\/api\/uploads\/|https?:\/\/)/i;

        function getTodoBlockEditor(blockIdx) {
            const blockEl = document.querySelector(`.todo-content-block[data-block-idx="${blockIdx}"]`);
            return blockEl ? blockEl.querySelector('.todo-block-editor') : null;
        }

        // Convert legacy stored value (which may contain plain text + ![alt](url) markdown)
        // into HTML safe to set as the editor's content. New stored values may already
        // be HTML; we detect that and pass it through (with sanitization).
        function todoStoredValueToHtml(value) {
            if (!value) return '';
            const looksLikeHtml = /<(img|p|div|br)\b/i.test(value);
            if (looksLikeHtml) {
                return sanitizeTodoEditorHtml(value);
            }
            // Plain text / markdown path: escape, then replace markdown image syntax with <img>.
            // Also preserve newlines as <br> for visual continuity with old textarea content.
            const escaped = escapeHtml(value);
            const withImages = escaped.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, (m, altRaw, urlRaw) => {
                // altRaw and urlRaw are already escaped because we ran escapeHtml first.
                // Validate the URL against the safe pattern (decode entities first).
                const url = decodeHtmlEntities(urlRaw);
                if (!TODO_SAFE_URL_RE.test(url)) return m; // leave as text if unsafe
                const alt = decodeHtmlEntities(altRaw);
                return buildInlineImageHtml(url, alt);
            });
            return withImages.replace(/\n/g, '<br>');
        }

        function decodeHtmlEntities(s) {
            const t = document.createElement('textarea');
            t.innerHTML = s;
            return t.value;
        }

        function buildInlineImageHtml(url, alt) {
            // Wrapper makes it easier to attach a delete button + click-to-enlarge.
            return `<span class="todo-inline-image-wrap" contenteditable="false" data-image-url="${escapeAttr(url)}">`
                + `<img class="todo-inline-image" src="${escapeAttr(url)}" alt="${escapeAttr(alt || '')}" loading="lazy" draggable="false">`
                + `<button type="button" class="todo-inline-image-delete" title="Remove image" tabindex="-1">&#x2715;</button>`
                + `</span>`;
        }

        // Light DOM-based sanitizer: strip <script>, on* attributes, javascript: URLs,
        // and only allow <img> tags whose src matches the safe pattern.
        function sanitizeTodoEditorHtml(html) {
            const tpl = document.createElement('template');
            tpl.innerHTML = html;
            const walk = (node) => {
                // Snapshot children because we mutate during iteration.
                Array.from(node.childNodes).forEach(child => {
                    if (child.nodeType === 1) { // element
                        const tag = child.tagName.toLowerCase();
                        if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object') {
                            child.remove();
                            return;
                        }
                        // Strip event handlers and dangerous attrs
                        Array.from(child.attributes).forEach(attr => {
                            const name = attr.name.toLowerCase();
                            if (name.startsWith('on')) child.removeAttribute(attr.name);
                            if ((name === 'src' || name === 'href') && /^\s*javascript:/i.test(attr.value)) {
                                child.removeAttribute(attr.name);
                            }
                        });
                        if (tag === 'img') {
                            const src = child.getAttribute('src') || '';
                            if (!TODO_SAFE_URL_RE.test(src)) {
                                child.remove();
                                return;
                            }
                            // Normalize: ensure it's wrapped in our inline-image-wrap so the
                            // delete control + lightbox handlers work uniformly.
                            if (!child.parentElement || !child.parentElement.classList.contains('todo-inline-image-wrap')) {
                                const wrap = document.createElement('span');
                                wrap.className = 'todo-inline-image-wrap';
                                wrap.setAttribute('contenteditable', 'false');
                                wrap.dataset.imageUrl = src;
                                const newImg = document.createElement('img');
                                newImg.className = 'todo-inline-image';
                                newImg.src = src;
                                newImg.alt = child.getAttribute('alt') || '';
                                newImg.loading = 'lazy';
                                newImg.draggable = false;
                                const del = document.createElement('button');
                                del.type = 'button';
                                del.className = 'todo-inline-image-delete';
                                del.title = 'Remove image';
                                del.tabIndex = -1;
                                del.innerHTML = '&#x2715;';
                                wrap.appendChild(newImg);
                                wrap.appendChild(del);
                                child.replaceWith(wrap);
                                return; // do not recurse into a removed node
                            }
                        }
                        if (tag === 'span' && child.classList.contains('todo-inline-image-wrap')) {
                            // Ensure it has the right structure.
                            child.setAttribute('contenteditable', 'false');
                        }
                        walk(child);
                    } else if (child.nodeType === 8) { // comment
                        child.remove();
                    }
                });
            };
            walk(tpl.content);
            return tpl.innerHTML;
        }

        // Serialize editor content for storage. We keep HTML (sanitized) as the value.
        function serializeTodoEditor(editor) {
            // Clone so we can strip transient classes (drag-over highlight, etc.) without affecting the live DOM.
            const clone = editor.cloneNode(true);
            // Remove any leftover transient elements
            clone.querySelectorAll('.todo-inline-image-delete').forEach(b => b.remove());
            // Sanitize again on output.
            return sanitizeTodoEditorHtml(clone.innerHTML);
        }

        function initTodoBlockEditor(blockIdx) {
            const editor = getTodoBlockEditor(blockIdx);
            if (!editor) return;
            const initial = editor.dataset.initialValue || '';
            editor.removeAttribute('data-initial-value');
            editor.innerHTML = todoStoredValueToHtml(initial);
            updateTodoEditorEmptyState(editor);
        }

        function updateTodoEditorEmptyState(editor) {
            // contenteditable doesn't honour the placeholder attribute natively;
            // we expose an :empty / :only-child=<br> CSS hook via a class.
            const isEmpty = editor.textContent.trim().length === 0
                && editor.querySelectorAll('.todo-inline-image-wrap').length === 0;
            editor.classList.toggle('is-empty', isEmpty);
        }

        // ---- Caret / selection helpers ----

        function placeCaretAtCoords(x, y) {
            // Try standard API first.
            if (document.caretPositionFromPoint) {
                const pos = document.caretPositionFromPoint(x, y);
                if (pos) {
                    const range = document.createRange();
                    range.setStart(pos.offsetNode, pos.offset);
                    range.collapse(true);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                    return true;
                }
            }
            if (document.caretRangeFromPoint) {
                const range = document.caretRangeFromPoint(x, y);
                if (range) {
                    range.collapse(true);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                    return true;
                }
            }
            return false;
        }

        function getEditorRange(editor) {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return null;
            const range = sel.getRangeAt(0);
            // Only honour the range if it's inside this editor.
            if (!editor.contains(range.commonAncestorContainer)) return null;
            return range;
        }

        function insertNodeAtCaret(editor, node) {
            let range = getEditorRange(editor);
            if (!range) {
                // Fallback: append at end.
                editor.appendChild(node);
                // Place caret after node.
                const newRange = document.createRange();
                newRange.setStartAfter(node);
                newRange.collapse(true);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(newRange);
                return;
            }
            range.deleteContents();
            range.insertNode(node);
            // Move caret right after the inserted node.
            const newRange = document.createRange();
            newRange.setStartAfter(node);
            newRange.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(newRange);
        }

        // ---- File upload ----

        function fileToBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const result = reader.result || '';
                    const commaIdx = String(result).indexOf(',');
                    resolve(commaIdx >= 0 ? String(result).slice(commaIdx + 1) : '');
                };
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });
        }

        // Insert a placeholder span at the caret (or at a specific range) and return it.
        function insertPlaceholderAtCaret(editor, range) {
            const placeholder = document.createElement('span');
            placeholder.className = 'todo-inline-image-placeholder';
            placeholder.setAttribute('contenteditable', 'false');
            placeholder.textContent = 'Uploading image…';
            if (range) {
                range.deleteContents();
                range.insertNode(placeholder);
            } else {
                insertNodeAtCaret(editor, placeholder);
            }
            // Ensure caret moves after the placeholder.
            const after = document.createRange();
            after.setStartAfter(placeholder);
            after.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(after);
            return placeholder;
        }

        async function uploadTodoImageFile(file, blockIdx, range) {
            if (!TODO_IMAGE_MIME.includes(file.type)) {
                console.warn('Skipping non-image file:', file.type);
                return;
            }
            const editor = getTodoBlockEditor(blockIdx);
            if (!editor) return;

            const placeholder = insertPlaceholderAtCaret(editor, range);
            updateTodoEditorEmptyState(editor);

            try {
                const data = await fileToBase64(file);
                const resp = await fetch('/api/uploads', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filename: file.name || 'image',
                        contentType: file.type,
                        data
                    })
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.error || `Upload failed (${resp.status})`);
                }
                const json = await resp.json();
                const url = json.url || json.path || (json.markdown && json.markdown.match(/\(([^)]+)\)/) ? json.markdown.match(/\(([^)]+)\)/)[1] : null);
                if (!url || !TODO_SAFE_URL_RE.test(url)) {
                    throw new Error('Server returned an unsafe upload URL');
                }
                // Replace placeholder with real <img> wrapper.
                const wrapper = document.createElement('span');
                wrapper.innerHTML = buildInlineImageHtml(url, file.name || '');
                const imgWrap = wrapper.firstChild;
                placeholder.replaceWith(imgWrap);
                // Place caret right after the inserted image.
                const after = document.createRange();
                after.setStartAfter(imgWrap);
                after.collapse(true);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(after);

                updateTodoEditorEmptyState(editor);
                scheduleTodoModalSave();
            } catch (err) {
                console.error('Image upload failed:', err);
                placeholder.textContent = `Upload failed: ${file.name || 'image'}`;
                placeholder.classList.add('todo-inline-image-placeholder-failed');
                updateTodoModalSaveStatus('Upload failed');
            }
        }

        // ---- Editor event handlers ----

        function handleTodoEditorInput(event, blockIdx) {
            const editor = event.currentTarget;
            updateTodoEditorEmptyState(editor);
            scheduleTodoModalSave();
        }

        function handleTodoEditorKeydown(event, blockIdx) {
            // Allow Backspace/Delete to remove a selected image wrap as a whole.
            const editor = event.currentTarget;
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            if (!editor.contains(range.commonAncestorContainer)) return;

            if ((event.key === 'Backspace' || event.key === 'Delete') && range.collapsed) {
                // Find an adjacent image wrap to remove cleanly.
                const node = event.key === 'Backspace'
                    ? findPrevSiblingImage(range)
                    : findNextSiblingImage(range);
                if (node) {
                    event.preventDefault();
                    node.remove();
                    updateTodoEditorEmptyState(editor);
                    scheduleTodoModalSave();
                }
            }
        }

        function findPrevSiblingImage(range) {
            const { startContainer, startOffset } = range;
            if (startContainer.nodeType === 3) {
                // Text node: only at offset 0 do we look at the previous sibling.
                if (startOffset === 0) {
                    let n = startContainer.previousSibling;
                    while (n && n.nodeType === 3 && n.textContent.length === 0) n = n.previousSibling;
                    if (n && n.nodeType === 1 && n.classList && n.classList.contains('todo-inline-image-wrap')) return n;
                }
                return null;
            }
            // Element container: look at the child immediately before startOffset.
            const node = startContainer.childNodes[startOffset - 1];
            if (node && node.nodeType === 1 && node.classList && node.classList.contains('todo-inline-image-wrap')) return node;
            return null;
        }

        function findNextSiblingImage(range) {
            const { startContainer, startOffset } = range;
            if (startContainer.nodeType === 3) {
                if (startOffset === startContainer.textContent.length) {
                    let n = startContainer.nextSibling;
                    while (n && n.nodeType === 3 && n.textContent.length === 0) n = n.nextSibling;
                    if (n && n.nodeType === 1 && n.classList && n.classList.contains('todo-inline-image-wrap')) return n;
                }
                return null;
            }
            const node = startContainer.childNodes[startOffset];
            if (node && node.nodeType === 1 && node.classList && node.classList.contains('todo-inline-image-wrap')) return node;
            return null;
        }

        function handleTodoEditorClick(event) {
            const editor = event.currentTarget;
            const target = event.target;
            // Click on the small × delete button on an inline image.
            if (target.classList && target.classList.contains('todo-inline-image-delete')) {
                event.preventDefault();
                const wrap = target.closest('.todo-inline-image-wrap');
                if (wrap) {
                    wrap.remove();
                    updateTodoEditorEmptyState(editor);
                    scheduleTodoModalSave();
                }
                return;
            }
            // Click on the image itself: open lightbox.
            if (target.classList && target.classList.contains('todo-inline-image')) {
                event.preventDefault();
                const url = target.getAttribute('src');
                const alt = target.getAttribute('alt') || '';
                if (url) openTodoImageLightbox(url, alt);
            }
        }

        function handleTodoEditorPaste(event, blockIdx) {
            const items = event.clipboardData && event.clipboardData.items;
            if (!items) return;
            const imageFiles = [];
            for (const item of items) {
                if (item.kind === 'file') {
                    const file = item.getAsFile();
                    if (file && TODO_IMAGE_MIME.includes(file.type)) imageFiles.push(file);
                }
            }
            if (imageFiles.length > 0) {
                event.preventDefault();
                imageFiles.forEach(file => uploadTodoImageFile(file, blockIdx));
                return;
            }
            // For non-image pastes, force plain-text to avoid pulling in foreign HTML.
            const text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
            if (text) {
                event.preventDefault();
                const editor = event.currentTarget;
                // Insert as text node (preserving newlines as <br>).
                const range = getEditorRange(editor);
                const frag = document.createDocumentFragment();
                const lines = text.split(/\r?\n/);
                lines.forEach((line, i) => {
                    if (i > 0) frag.appendChild(document.createElement('br'));
                    frag.appendChild(document.createTextNode(line));
                });
                if (range) {
                    range.deleteContents();
                    range.insertNode(frag);
                    range.collapse(false);
                } else {
                    editor.appendChild(frag);
                }
                updateTodoEditorEmptyState(editor);
                scheduleTodoModalSave();
            }
        }

        function handleTodoEditorDragEnter(event) {
            event.preventDefault();
            event.currentTarget.classList.add('todo-block-editor-dragover');
        }

        function handleTodoEditorDragOver(event) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            // Live-update caret position so the drop lands where the cursor is hovering.
            placeCaretAtCoords(event.clientX, event.clientY);
        }

        function handleTodoEditorDragLeave(event) {
            event.currentTarget.classList.remove('todo-block-editor-dragover');
        }

        function handleTodoEditorDrop(event, blockIdx) {
            event.preventDefault();
            event.currentTarget.classList.remove('todo-block-editor-dragover');
            const files = event.dataTransfer && event.dataTransfer.files;
            if (!files || files.length === 0) return;
            // Drop the caret exactly where the user released the mouse.
            placeCaretAtCoords(event.clientX, event.clientY);
            const range = getEditorRange(event.currentTarget);
            // Use the same range for each file so multiple drops stack correctly.
            for (const file of files) {
                if (TODO_IMAGE_MIME.includes(file.type)) {
                    uploadTodoImageFile(file, blockIdx, range ? range.cloneRange() : null);
                }
            }
        }

        function openImagePickerForBlock(blockIdx) {
            const editor = getTodoBlockEditor(blockIdx);
            // Capture the current caret range BEFORE the file dialog steals focus.
            const savedRange = editor ? getEditorRange(editor) : null;
            const savedRangeClone = savedRange ? savedRange.cloneRange() : null;

            const input = document.createElement('input');
            input.type = 'file';
            input.accept = TODO_IMAGE_MIME.join(',');
            input.multiple = true;
            input.style.display = 'none';
            input.onchange = () => {
                const files = Array.from(input.files || []);
                files.forEach(file => uploadTodoImageFile(file, blockIdx, savedRangeClone ? savedRangeClone.cloneRange() : null));
                input.remove();
            };
            document.body.appendChild(input);
            input.click();
        }

        // =========================================
        // TODO IMAGE LIGHTBOX
        // =========================================

        function openTodoImageLightbox(url, alt) {
            // Re-use a single overlay element if possible.
            let overlay = document.getElementById('todo-image-lightbox');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'todo-image-lightbox';
                overlay.className = 'todo-image-lightbox';
                overlay.innerHTML = `
                    <button type="button" class="todo-image-lightbox-close" title="Close (Esc)">&#x2715;</button>
                    <img class="todo-image-lightbox-img" alt="">
                `;
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay || e.target.classList.contains('todo-image-lightbox-close')) {
                        closeTodoImageLightbox();
                    }
                });
                document.body.appendChild(overlay);
            }
            const img = overlay.querySelector('.todo-image-lightbox-img');
            img.src = url;
            img.alt = alt || '';
            overlay.classList.add('open');
            // Lock background scroll while open.
            document.body.classList.add('todo-image-lightbox-open');
        }

        function closeTodoImageLightbox() {
            const overlay = document.getElementById('todo-image-lightbox');
            if (!overlay) return;
            overlay.classList.remove('open');
            document.body.classList.remove('todo-image-lightbox-open');
            const img = overlay.querySelector('.todo-image-lightbox-img');
            if (img) img.src = '';
        }

        // Esc closes the lightbox (in addition to closing the modal when not in lightbox).
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const overlay = document.getElementById('todo-image-lightbox');
            if (overlay && overlay.classList.contains('open')) {
                e.stopPropagation();
                closeTodoImageLightbox();
            }
        }, true); // capture so we run before the modal-close handler
