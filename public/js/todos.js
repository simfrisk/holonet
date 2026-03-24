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

            const deleteBtn = isDefault ? '' :
                `<button class="todo-column-del-btn" title="Delete list"
                         onclick="deleteTodoList('${escapeAttr(listId)}')">&#x2715;</button>`;

            const itemsHtml = buildTodoItemsHtml(listId, filter);

            return `<div class="todo-column" id="todo-column-${escapeHtml(listId)}">
                <div class="todo-column-header">
                    <h3 class="todo-column-title">${escapeHtml(list.name)}</h3>
                    ${deleteBtn}
                </div>

                <form class="todo-add-form" onsubmit="addTodo(event, '${escapeAttr(listId)}')">
                    <input type="text" class="todo-add-text" id="todo-add-text-${escapeHtml(listId)}"
                           placeholder="Add a to-do…" autocomplete="off">
                    <select class="todo-add-priority" id="todo-add-priority-${escapeHtml(listId)}" title="Priority">
                        <option value="">— priority</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                    </select>
                    <input type="date" class="todo-add-date" id="todo-add-date-${escapeHtml(listId)}" title="Due date">
                    <button type="submit" class="todo-add-btn">Add</button>
                </form>

                <div class="todo-filters">
                    <button class="todo-filter-btn ${filter === 'active' ? 'active' : ''}"
                            data-filter="active"
                            onclick="filterTodos('active', '${escapeAttr(listId)}')">Active</button>
                    <button class="todo-filter-btn ${filter === 'done' ? 'active' : ''}"
                            data-filter="done"
                            onclick="filterTodos('done', '${escapeAttr(listId)}')">Archived</button>
                    <button class="todo-clear-done" onclick="clearDoneTodos('${escapeAttr(listId)}')">Clear done</button>
                </div>

                <div class="todo-list" id="todo-list-${escapeHtml(listId)}">${itemsHtml}</div>
            </div>`;
        }

        function buildTodoItemsHtml(listId, filter) {
            let filtered = todosData.filter(t => (t.listId || 'todolist-default') === listId);
            if (filter === 'active') filtered = filtered.filter(t => !t.done);
            else if (filter === 'done') filtered = filtered.filter(t => t.done);

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

            const contentIndicator = hasContent
                ? `<span class="todo-has-content-badge" title="Has notes/checklist"><i class="ti ti-notes"></i></span>`
                : '';

            return `<div class="todo-item ${priorityClass} ${doneClass} ${hasContent ? 'has-content' : ''}" data-todo-id="${escapeHtml(todo.id)}" draggable="true">
                <span class="todo-drag-handle" title="Drag to reorder">&#x2807;</span>
                <input type="checkbox" class="todo-checkbox" ${todo.done ? 'checked' : ''}
                       onchange="toggleTodoDone('${escapeAttr(todo.id)}', this.checked)">
                <div class="todo-text-wrap" onclick="if(!todoDragJustFinished){openTodoDetailModal('${escapeAttr(todo.id)}')}" style="cursor:pointer;">
                    <div class="todo-text-row">
                        <input type="text" class="todo-text" value="${escapeHtml(todo.text)}"
                               onclick="event.stopPropagation()"
                               onblur="saveTodoText('${escapeAttr(todo.id)}', this.value)"
                               onkeydown="if(event.key==='Enter'){this.blur();}if(event.key==='Escape'){this.value=todosData.find(t=>t.id==='${escapeAttr(todo.id)}')?.text||this.value;this.blur();}">
                        ${contentIndicator}
                    </div>
                    ${metaHtml ? `<div class="todo-meta">${metaHtml}</div>` : ''}
                </div>
                <div class="todo-actions">
                    <button class="todo-action-btn todo-open-btn"
                            onclick="openTodoDetailModal('${escapeAttr(todo.id)}')"
                            title="Open details"><i class="ti ti-arrow-bar-right"></i></button>
                    <button class="todo-action-btn todo-delete-btn"
                            onclick="deleteTodoItem('${escapeAttr(todo.id)}')"
                            title="Delete">\u{1F5D1}</button>
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

        async function addTodo(event, listId) {
            event.preventDefault();
            const textEl     = document.getElementById(`todo-add-text-${listId}`);
            const priorityEl = document.getElementById(`todo-add-priority-${listId}`);
            const dateEl     = document.getElementById(`todo-add-date-${listId}`);
            if (!textEl) return;
            const text = (textEl.value || '').trim();
            if (!text) { textEl.focus(); return; }

            try {
                const res = await fetch('/api/todos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text,
                        priority: priorityEl ? (priorityEl.value || null) : null,
                        dueDate:  dateEl     ? (dateEl.value     || null) : null,
                        listId:   listId
                    })
                });
                if (!res.ok) throw new Error('Failed');
                const data = await res.json();
                todosData.unshift(data.todo);
                textEl.value = '';
                if (priorityEl) priorityEl.value = '';
                if (dateEl) dateEl.value = '';
                textEl.focus();
                updateTodosCount();
                rerenderTodoListDiv(listId);
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

        async function deleteTodoItem(id) {
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
            this.classList.remove('todo-item-drag-over');

            const targetId = this.dataset.todoId;
            if (!todoDragSrcId || todoDragSrcId === targetId) return;

            // Determine which list this drop is in
            const srcTodo = todosData.find(t => t.id === todoDragSrcId);
            if (!srcTodo) return;
            const listId = srcTodo.listId || 'todolist-default';
            const filter = todoFilters[listId] || 'active';

            // Work only on todos in the current list + filter
            const listTodos = todosData.filter(t => (t.listId || 'todolist-default') === listId);
            let filtered;
            if (filter === 'active') filtered = listTodos.filter(t => !t.done);
            else if (filter === 'done') filtered = listTodos.filter(t => t.done);
            else filtered = [...listTodos];

            const srcIdx = filtered.findIndex(t => t.id === todoDragSrcId);
            const tgtIdx = filtered.findIndex(t => t.id === targetId);
            if (srcIdx === -1 || tgtIdx === -1) return;

            const moved = filtered.splice(srcIdx, 1)[0];
            filtered.splice(tgtIdx, 0, moved);

            // Assign new sortOrder values
            const order = filtered.map((t, i) => ({ id: t.id, sortOrder: i * 10 }));
            order.forEach(({ id, sortOrder }) => {
                const t = todosData.find(x => x.id === id);
                if (t) t.sortOrder = sortOrder;
            });

            rerenderTodoListDiv(listId);

            try {
                await fetch('/api/todos/reorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order })
                });
            } catch (err) {
                console.error('Failed to persist todo order:', err);
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

            // Set meta info
            const metaEl = document.getElementById('todo-modal-meta');
            const listName = todoLists.find(l => l.id === (todo.listId || 'todolist-default'))?.name || 'Default';
            let metaParts = [listName];
            if (todo.priority) metaParts.push(todo.priority + ' priority');
            if (todo.dueDate) metaParts.push('Due ' + formatDueDate(todo.dueDate));
            metaEl.textContent = metaParts.join(' \u00b7 ');

            // Render content blocks
            renderTodoDetailBlocks(todo.content || []);

            // Clear save status
            updateTodoModalSaveStatus('');

            // Show modal
            document.getElementById('todoDetailModal').style.display = 'block';

            // Wire up title auto-save
            titleEl.oninput = () => {
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

        function closeTodoDetailModal() {
            // Flush any pending saves
            if (todoModalSaveTimer) {
                clearTimeout(todoModalSaveTimer);
                saveTodoModalContentNow();
            }
            if (todoModalTitleTimer) {
                clearTimeout(todoModalTitleTimer);
                const titleEl = document.getElementById('todo-modal-title');
                const todo = todosData.find(t => t.id === todoModalCurrentId);
                if (todo && titleEl) {
                    const newText = titleEl.value.trim();
                    if (newText && newText !== todo.text) {
                        saveTodoText(todoModalCurrentId, newText);
                        todo.text = newText;
                    }
                }
            }

            document.getElementById('todoDetailModal').style.display = 'none';

            // Re-render the list to show updated content indicators
            const todo = todosData.find(t => t.id === todoModalCurrentId);
            if (todo) rerenderTodoListDiv(todo.listId || 'todolist-default');

            todoModalCurrentId = null;
        }

        function updateTodoModalSaveStatus(text) {
            const el = document.getElementById('todo-modal-save-status');
            if (el) el.textContent = text;
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

            // Auto-resize all textareas
            blocksEl.querySelectorAll('.todo-block-textarea').forEach(autoResizeTextarea);
        }

        function buildTextBlockHtml(block, idx) {
            return `<div class="todo-content-block todo-block-text" data-block-idx="${idx}">
                <div class="todo-block-header">
                    <span class="todo-block-type-label"><i class="ti ti-text-size"></i> Text</span>
                    <button class="todo-block-delete" onclick="deleteTodoContentBlock(${idx})" title="Remove block">&#x2715;</button>
                </div>
                <textarea class="todo-block-textarea" placeholder="Write something..."
                    oninput="autoResizeTextarea(this); scheduleTodoModalSave();">${escapeHtml(block.value || '')}</textarea>
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
                event.target.blur();
                scheduleTodoModalSave();
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
                    const textarea = el.querySelector('.todo-block-textarea');
                    blocks.push({ type: 'text', id: 'block-' + idx, value: textarea ? textarea.value : '' });
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
