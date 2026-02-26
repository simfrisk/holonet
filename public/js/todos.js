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

        function buildTodoItemHtml(todo) {
            const priorityClass = todo.priority ? `priority-${todo.priority}` : '';
            const doneClass     = todo.done ? 'done-item' : '';

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

            return `<div class="todo-item ${priorityClass} ${doneClass}" data-todo-id="${escapeHtml(todo.id)}" draggable="true">
                <span class="todo-drag-handle" title="Drag to reorder">&#x2807;</span>
                <input type="checkbox" class="todo-checkbox" ${todo.done ? 'checked' : ''}
                       onchange="toggleTodoDone('${escapeAttr(todo.id)}', this.checked)">
                <div class="todo-text-wrap">
                    <input type="text" class="todo-text" value="${escapeHtml(todo.text)}"
                           onblur="saveTodoText('${escapeAttr(todo.id)}', this.value)"
                           onkeydown="if(event.key==='Enter'){this.blur();}if(event.key==='Escape'){this.value=todosData.find(t=>t.id==='${escapeAttr(todo.id)}')?.text||this.value;this.blur();}">
                    ${metaHtml ? `<div class="todo-meta">${metaHtml}</div>` : ''}
                </div>
                <div class="todo-actions">
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
            this.classList.add('todo-item-dragging');
            e.dataTransfer.effectAllowed = 'move';
        }

        function onTodoDragEnd() {
            todoDragSrcId = null;
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
