        // =========================================
        // TODOS
        // =========================================

        let todosData = [];
        let todoFilter = 'active';
        let todosLoaded = false;

        // =========================================
        // TODO LISTS (Feature 3c)
        // =========================================

        let todoLists = [];
        let activeListId = 'todolist-default';
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
                renderTodoLists();
                renderTodoList();
                updateTodosCount();
            } catch (err) {
                console.error('Failed to load todos:', err);
            }
        }

        function updateTodosCount() {
            const el = document.getElementById('todos-count');
            if (el) el.textContent = todosData.filter(t => !t.done).length;
        }

        function filterTodos(filter) {
            todoFilter = filter;
            document.querySelectorAll('.todo-filter-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.filter === filter);
            });
            renderTodoList();
        }

        // ---- Render the list tabs ----
        function renderTodoLists() {
            const container = document.getElementById('todo-lists-tabs');
            if (!container) return;

            container.innerHTML = todoLists.map((list, i) => `
                <div class="todo-list-tab ${list.id === activeListId ? 'active' : ''}"
                     data-list-id="${list.id}"
                     draggable="true"
                     onclick="switchTodoList('${list.id}')">
                    <span class="todo-list-tab-name"
                          ondblclick="startRenameList('${list.id}', event)">${escapeHtml(list.name)}</span>
                    ${list.id !== 'todolist-default' ? `<button class="todo-list-tab-del" title="Delete list" onclick="event.stopPropagation();deleteTodoList('${list.id}')">×</button>` : ''}
                </div>`
            ).join('');

            // Wire DnD for list tabs
            container.querySelectorAll('.todo-list-tab').forEach(tab => {
                tab.addEventListener('dragstart', onListTabDragStart);
                tab.addEventListener('dragend',   onListTabDragEnd);
                tab.addEventListener('dragover',  onListTabDragOver);
                tab.addEventListener('dragleave', onListTabDragLeave);
                tab.addEventListener('drop',      onListTabDrop);
            });
        }

        function switchTodoList(listId) {
            activeListId = listId;
            renderTodoLists();
            renderTodoList();
        }

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
                activeListId = data.id;
                renderTodoLists();
                renderTodoList();
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
                if (activeListId === listId) activeListId = 'todolist-default';
                renderTodoLists();
                renderTodoList();
            } catch (err) {
                console.error('Failed to delete list:', err);
            }
        }

        function startRenameList(listId, e) {
            e.stopPropagation();
            const tab = document.querySelector(`.todo-list-tab[data-list-id="${listId}"]`);
            if (!tab) return;
            const nameEl = tab.querySelector('.todo-list-tab-name');
            if (!nameEl) return;
            const currentName = nameEl.textContent;
            const inp = document.createElement('input');
            inp.className = 'todo-list-tab-rename';
            inp.value = currentName;
            nameEl.replaceWith(inp);
            inp.focus();
            inp.select();
            const commit = async () => {
                const newName = inp.value.trim();
                if (newName && newName !== currentName) {
                    try {
                        await fetch(`/api/todolists/${listId}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: newName })
                        });
                        const list = todoLists.find(l => l.id === listId);
                        if (list) list.name = newName;
                    } catch (err) { console.error('Rename list failed', err); }
                }
                renderTodoLists();
            };
            inp.addEventListener('blur', commit);
            inp.addEventListener('keydown', ev => {
                if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
                if (ev.key === 'Escape') { inp.value = currentName; inp.blur(); }
            });
        }

        // ---- Todo list tab drag-and-drop ----
        let listTabDragSrcId = null;

        function onListTabDragStart(e) {
            listTabDragSrcId = this.dataset.listId;
            e.dataTransfer.effectAllowed = 'move';
            this.classList.add('todo-list-tab-dragging');
        }
        function onListTabDragEnd() {
            listTabDragSrcId = null;
            document.querySelectorAll('.todo-list-tab').forEach(t => {
                t.classList.remove('todo-list-tab-dragging', 'todo-list-tab-drag-over');
            });
        }
        function onListTabDragOver(e) {
            e.preventDefault();
            if (this.dataset.listId !== listTabDragSrcId) this.classList.add('todo-list-tab-drag-over');
        }
        function onListTabDragLeave() { this.classList.remove('todo-list-tab-drag-over'); }
        async function onListTabDrop(e) {
            e.preventDefault();
            this.classList.remove('todo-list-tab-drag-over');
            const targetId = this.dataset.listId;
            if (!listTabDragSrcId || listTabDragSrcId === targetId) return;

            const srcIdx = todoLists.findIndex(l => l.id === listTabDragSrcId);
            const tgtIdx = todoLists.findIndex(l => l.id === targetId);
            if (srcIdx === -1 || tgtIdx === -1) return;

            const moved = todoLists.splice(srcIdx, 1)[0];
            todoLists.splice(tgtIdx, 0, moved);

            renderTodoLists();

            const order = todoLists.map((l, i) => ({ id: l.id, sortOrder: i }));
            order.forEach(({ id, sortOrder }) => {
                const l = todoLists.find(x => x.id === id);
                if (l) l.sortOrder = sortOrder;
            });

            try {
                await fetch('/api/todolists/reorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order })
                });
            } catch (err) { console.error('Failed to persist list order:', err); }
        }

        // =========================================
        // RENDER TODOS (filtered by active list)
        // =========================================

        function renderTodoList() {
            const list = document.getElementById('todo-list');
            if (!list) return;

            // Filter by active list, then by done/active filter
            let filtered = todosData.filter(t => (t.listId || 'todolist-default') === activeListId);

            if (todoFilter === 'active') filtered = filtered.filter(t => !t.done);
            else if (todoFilter === 'done') filtered = filtered.filter(t => t.done);

            if (filtered.length === 0) {
                const msgs = {
                    all:    ['Nothing here yet', 'Type a task above and press Enter to add your first to-do.'],
                    active: ['All done!', 'No active tasks — enjoy the clear list.'],
                    done:   ['Nothing completed yet', 'Finish a task and it will show up here.']
                };
                const [title, sub] = msgs[todoFilter] || msgs.all;
                list.innerHTML = `<div class="todo-empty">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <h3>${title}</h3><p>${sub}</p>
                </div>`;
                return;
            }

            list.innerHTML = filtered.map(todo => buildTodoItemHtml(todo)).join('');
            initTodoDragDrop();
        }

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
                <span class="todo-drag-handle" title="Drag to reorder">⠿</span>
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

        async function addTodo(event) {
            event.preventDefault();
            const textEl     = document.getElementById('todo-add-text');
            const priorityEl = document.getElementById('todo-add-priority');
            const dateEl     = document.getElementById('todo-add-date');
            const text = (textEl.value || '').trim();
            if (!text) { textEl.focus(); return; }

            try {
                const res = await fetch('/api/todos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text,
                        priority: priorityEl.value || null,
                        dueDate:  dateEl.value     || null,
                        listId:   activeListId
                    })
                });
                if (!res.ok) throw new Error('Failed');
                const data = await res.json();
                todosData.unshift(data.todo);
                textEl.value = '';
                priorityEl.value = '';
                dateEl.value = '';
                textEl.focus();
                updateTodosCount();
                renderTodoList();
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
                renderTodoList();
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
            try {
                const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
                if (!res.ok) throw new Error('Failed');
                todosData = todosData.filter(t => t.id !== id);
                updateTodosCount();
                renderTodoList();
            } catch (err) {
                console.error('Failed to delete todo:', err);
            }
        }

        async function clearDoneTodos() {
            const done = todosData.filter(t => t.done && (t.listId || 'todolist-default') === activeListId);
            if (done.length === 0) return;
            if (!confirm(`Delete ${done.length} completed task${done.length > 1 ? 's' : ''}?`)) return;
            try {
                await Promise.all(done.map(t => fetch(`/api/todos/${t.id}`, { method: 'DELETE' })));
                todosData = todosData.filter(t => !(t.done && (t.listId || 'todolist-default') === activeListId));
                updateTodosCount();
                renderTodoList();
            } catch (err) {
                console.error('Failed to clear done todos:', err);
            }
        }

        // =========================================
        // TODO DRAG-AND-DROP REORDER (Feature 3a)
        // =========================================

        let todoDragSrcId = null;

        function initTodoDragDrop() {
            const list = document.getElementById('todo-list');
            if (!list) return;

            list.querySelectorAll('.todo-item[draggable]').forEach(item => {
                item.addEventListener('dragstart', onTodoDragStart);
                item.addEventListener('dragend',   onTodoDragEnd);
                item.addEventListener('dragover',  onTodoDragOver);
                item.addEventListener('dragleave', onTodoDragLeave);
                item.addEventListener('drop',      onTodoDrop);
            });
        }

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

            // Work only on todos in the current view (active list + current filter)
            const listTodos = todosData.filter(t => (t.listId || 'todolist-default') === activeListId);
            let filtered;
            if (todoFilter === 'active') filtered = listTodos.filter(t => !t.done);
            else if (todoFilter === 'done') filtered = listTodos.filter(t => t.done);
            else filtered = [...listTodos];

            const srcIdx = filtered.findIndex(t => t.id === todoDragSrcId);
            const tgtIdx = filtered.findIndex(t => t.id === targetId);
            if (srcIdx === -1 || tgtIdx === -1) return;

            const moved = filtered.splice(srcIdx, 1)[0];
            filtered.splice(tgtIdx, 0, moved);

            // Assign new sortOrder values to the reordered visible items
            const order = filtered.map((t, i) => ({ id: t.id, sortOrder: i * 10 }));

            // Update in-memory sortOrder
            order.forEach(({ id, sortOrder }) => {
                const t = todosData.find(x => x.id === id);
                if (t) t.sortOrder = sortOrder;
            });

            // Re-render immediately
            renderTodoList();

            // Persist
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
