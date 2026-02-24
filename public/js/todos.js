        // =========================================
        // TODOS
        // =========================================

        let todosData = [];
        let todoFilter = 'active';
        let todosLoaded = false;

        async function loadTodosTab() {
            try {
                const res = await fetch('/api/todos');
                if (res.ok) {
                    const data = await res.json();
                    todosData = data.todos || [];
                }
                todosLoaded = true;
                updateTodosCount();
                renderTodoList();
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

        function renderTodoList() {
            const list = document.getElementById('todo-list');
            if (!list) return;

            let filtered;
            if (todoFilter === 'active') filtered = todosData.filter(t => !t.done);
            else if (todoFilter === 'done')   filtered = todosData.filter(t => t.done);
            else                              filtered = [...todosData];

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

            return `<div class="todo-item ${priorityClass} ${doneClass}" data-todo-id="${escapeHtml(todo.id)}">
                <input type="checkbox" class="todo-checkbox" ${todo.done ? 'checked' : ''}
                       onchange="toggleTodoDone('${escapeAttr(todo.id)}', this.checked)">
                <div class="todo-text-wrap">
                    <input type="text" class="todo-text" value="${escapeHtml(todo.text)}"
                           onblur="saveTodoText('${escapeAttr(todo.id)}', this.value)"
                           onkeydown="if(event.key==='Enter'){this.blur();}">
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
                        dueDate:  dateEl.value     || null
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
            const done = todosData.filter(t => t.done);
            if (done.length === 0) return;
            if (!confirm(`Delete ${done.length} completed task${done.length > 1 ? 's' : ''}?`)) return;
            try {
                await Promise.all(done.map(t => fetch(`/api/todos/${t.id}`, { method: 'DELETE' })));
                todosData = todosData.filter(t => !t.done);
                updateTodosCount();
                renderTodoList();
            } catch (err) {
                console.error('Failed to clear done todos:', err);
            }
        }
