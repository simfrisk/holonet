        // ==================== VIDEO PLANNER ====================

        const VIDEO_STATUSES = ['idea', 'scripted', 'filmed', 'edited', 'posted'];
        const PLATFORM_ICONS = {
            youtube: 'ti-brand-youtube',
            instagram: 'ti-brand-instagram',
            tiktok: 'ti-brand-tiktok',
            facebook: 'ti-brand-facebook'
        };
        const PLATFORM_LABELS = {
            youtube: 'YT',
            instagram: 'IG',
            tiktok: 'TT',
            facebook: 'FB'
        };
        const PLATFORMS = ['youtube', 'instagram', 'tiktok', 'facebook'];
        let videoEditMode = false;
        let videoEditDirty = false;
        let archivedVideos = [];
        let archiveLoaded = false;
        let archiveVisible = false;

        async function loadVideosTab() {
            try {
                const response = await fetch('/api/videos');
                if (!response.ok) throw new Error('Failed to load');
                const data = await response.json();
                videosData = data.videos || [];
                videosLoaded = true;
                renderVideoKanban();
            } catch (err) {
                console.error('Error loading videos:', err);
            }
        }

        let activeVideosView = 'kanban';

        function switchVideosView(view) {
            activeVideosView = view;
            document.querySelectorAll('.videos-subnav-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.videosView === view);
            });
            document.getElementById('videos-kanban-view').style.display = view === 'kanban' ? '' : 'none';
            document.getElementById('videos-archive-view').style.display = view === 'archive' ? '' : 'none';
            document.getElementById('videos-add-btn').style.display = view === 'kanban' ? '' : 'none';
            if (view === 'archive') renderArchiveList();
        }

        function renderVideoKanban() {
            // Separate archived from active
            const active = videosData.filter(v => v.status !== 'archived');
            archivedVideos = videosData.filter(v => v.status === 'archived');
            const total = active.length;
            document.getElementById('videos-count').textContent = total;
            const countBadge = document.getElementById('videos-count-badge');
            if (countBadge) countBadge.textContent = total;

            // Update archive count badge
            const archCountEl = document.getElementById('video-archive-count');
            if (archCountEl) archCountEl.textContent = archivedVideos.length ? `(${archivedVideos.length})` : '';

            // If archive view is active, re-render it
            if (activeVideosView === 'archive') renderArchiveList();

            VIDEO_STATUSES.forEach(status => {
                const cards = active.filter(v => v.status === status);
                const container = document.getElementById(`kanban-${status}`);
                const countEl = document.getElementById(`kanban-count-${status}`);
                countEl.textContent = cards.length;

                container.innerHTML = '';
                if (cards.length === 0) {
                    container.innerHTML = '<div class="kanban-empty">Drop here</div>';
                } else {
                    cards.forEach(v => {
                        container.insertAdjacentHTML('beforeend', renderVideoCard(v));
                    });
                }
            });

            initKanbanDragDrop();
        }

        function renderVideoCard(v) {
            const platformBadges = (v.platforms || []).map(p => {
                const isPosted = (v.postedOn || []).includes(p);
                const postedClass = isPosted ? ' platform-badge-posted' : '';
                return `<span class="platform-badge platform-badge-${p}${postedClass}" title="${p}${isPosted ? ' (posted)' : ' — click to mark posted'}" onclick="event.stopPropagation();togglePlatformPosted('${v.id}','${p}')">
                    <i class="ti ${PLATFORM_ICONS[p]}"></i>${isPosted ? '<i class="ti ti-check" style="font-size:10px;margin-left:2px;"></i>' : ''}
                </span>`;
            }).join('');

            const desc = v.description ? `<div class="video-card-desc">${escapeHtml(v.description).substring(0, 80)}${v.description.length > 80 ? '...' : ''}</div>` : '';

            const brandBadge = v.brand ? `<span class="video-brand-badge video-brand-${v.brand}">${v.brand === 'liivo' ? 'Liivo' : 'OSC'}</span>` : '';
            const weekBadge = v.week ? `<span class="video-week-badge">${escapeHtml(v.week)}</span>` : '';

            return `<div class="video-card" draggable="true" data-video-id="${v.id}" onclick="openVideoModal('${v.id}')">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;margin-bottom:2px;">
                    <div class="video-card-title" style="margin-bottom:0;">${escapeHtml(v.title)}</div>
                    <div style="display:flex;gap:4px;flex-shrink:0;">${brandBadge}${weekBadge}</div>
                </div>
                ${desc}
                <div class="video-card-platforms">${platformBadges || '<span class="video-card-no-platforms">No platforms</span>'}</div>
            </div>`;
        }

        // ---- Drag & Drop between Kanban columns ----

        function initKanbanDragDrop() {
            document.querySelectorAll('.video-card').forEach(card => {
                card.addEventListener('dragstart', e => {
                    e.dataTransfer.setData('text/plain', card.dataset.videoId);
                    card.classList.add('video-card-dragging');
                });
                card.addEventListener('dragend', () => {
                    card.classList.remove('video-card-dragging');
                    document.querySelectorAll('.kanban-cards').forEach(col => col.classList.remove('kanban-drop-over'));
                });
            });

            document.querySelectorAll('.kanban-cards').forEach(col => {
                col.addEventListener('dragover', e => {
                    e.preventDefault();
                    col.classList.add('kanban-drop-over');
                });
                col.addEventListener('dragleave', () => {
                    col.classList.remove('kanban-drop-over');
                });
                col.addEventListener('drop', async e => {
                    e.preventDefault();
                    col.classList.remove('kanban-drop-over');
                    const videoId = e.dataTransfer.getData('text/plain');
                    const newStatus = col.closest('.kanban-column').dataset.status;

                    const video = videosData.find(v => v.id === videoId);
                    if (!video || video.status === newStatus) return;

                    video.status = newStatus;
                    renderVideoKanban();

                    try {
                        await fetch(`/api/videos/${videoId}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: newStatus })
                        });
                    } catch (err) {
                        console.error('Failed to update video status:', err);
                    }
                });
            });
        }

        // ---- Collapsible sections ----

        function toggleVmSection(name) {
            const sec = document.getElementById(`vm-sec-${name}`);
            if (sec) sec.classList.toggle('collapsed');
        }

        function updateSectionHints(video) {
            const hints = {
                hook: video.hook ? video.hook.substring(0, 40) + (video.hook.length > 40 ? '...' : '') : '',
                context: video.context ? 'has content' : '',
                manuscript: video.manuscript ? `${video.manuscript.split('\n').length} lines` : '',
                recording: (video.codexPrompts || []).length ? `${video.codexPrompts.length} prompt(s)` : '',
                editing: (video.editingTimeline || []).length ? `${video.editingTimeline.length} row(s)` : '',
                captions: Object.values(video.captions || {}).filter(Boolean).length ? `${Object.values(video.captions || {}).filter(Boolean).length} platform(s)` : ''
            };
            for (const [key, val] of Object.entries(hints)) {
                const el = document.getElementById(`vm-hint-${key}`);
                if (el) el.textContent = val;
            }
        }

        // ---- Codex Prompts ----

        function addCodexPrompt(label = '', prompt = '') {
            const list = document.getElementById('video-codexPrompts-list');
            const idx = list.children.length;
            const card = document.createElement('div');
            card.className = 'vm-prompt-card';
            card.innerHTML = `
                <button class="vm-prompt-remove" onclick="this.parentElement.remove()" title="Remove">&times;</button>
                <input type="text" class="vm-input codex-label" placeholder="Label (e.g. Codex prompt 1)" value="${escapeHtml(label)}" style="margin-bottom:6px;" />
                <div style="position:relative;">
                    <textarea class="vm-input vm-mono codex-prompt" rows="4" placeholder="Paste the prompt text here...">${escapeHtml(prompt)}</textarea>
                    <button class="vm-copy-btn" style="position:absolute;top:6px;right:6px;" onclick="copyPromptText(this)">Copy</button>
                </div>`;
            list.appendChild(card);
        }

        function copyPromptText(btn) {
            const textarea = btn.parentElement.querySelector('.codex-prompt');
            navigator.clipboard.writeText(textarea.value);
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = 'Copy', 1500);
        }

        function getCodexPrompts() {
            const list = document.getElementById('video-codexPrompts-list');
            return Array.from(list.children).map(card => ({
                label: card.querySelector('.codex-label').value,
                prompt: card.querySelector('.codex-prompt').value
            })).filter(p => p.prompt);
        }

        // ---- Editing Timeline ----

        function addTimelineRow(time = '', action = '', overlay = '') {
            const list = document.getElementById('video-editingTimeline-list');
            // Create table if needed
            let table = list.querySelector('.vm-timeline-table');
            if (!table) {
                table = document.createElement('table');
                table.className = 'vm-timeline-table';
                table.innerHTML = '<tr><th style="width:90px">Time</th><th>Action</th><th style="width:160px">Text overlay</th><th style="width:28px"></th></tr>';
                list.appendChild(table);
            }
            const row = table.insertRow(-1);
            row.innerHTML = `
                <td><input type="text" class="tl-time" value="${escapeHtml(time)}" placeholder="0:00-0:03" /></td>
                <td><input type="text" class="tl-action" value="${escapeHtml(action)}" placeholder="Face cam hook..." /></td>
                <td><input type="text" class="tl-overlay" value="${escapeHtml(overlay)}" placeholder="Text on screen" /></td>
                <td><button class="vm-timeline-remove" onclick="removeTimelineRow(this)" title="Remove">&times;</button></td>`;
        }

        function removeTimelineRow(btn) {
            const row = btn.closest('tr');
            const table = row.closest('table');
            row.remove();
            // Remove table if empty (only header left)
            if (table && table.rows.length <= 1) table.remove();
        }

        function getEditingTimeline() {
            const list = document.getElementById('video-editingTimeline-list');
            const table = list.querySelector('.vm-timeline-table');
            if (!table) return [];
            return Array.from(table.rows).slice(1).map(row => ({
                time: row.querySelector('.tl-time').value,
                action: row.querySelector('.tl-action').value,
                overlay: row.querySelector('.tl-overlay').value
            })).filter(r => r.time || r.action);
        }

        // ---- Modal ----

        function openVideoModal(videoId) {
            const modal = document.getElementById('videoModal');
            const titleEl = document.getElementById('video-modal-title');
            const editIdEl = document.getElementById('video-edit-id');
            const deleteBtn = document.getElementById('video-delete-btn');
            const statusSelect = document.getElementById('video-status');

            // Reset basic fields
            document.getElementById('video-title').value = '';
            document.getElementById('video-description').value = '';
            document.getElementById('video-notes').value = '';
            document.getElementById('video-week').value = '';
            document.getElementById('video-brand').value = '';
            document.getElementById('video-duration').value = '';
            document.getElementById('video-cameraType').value = '';
            statusSelect.value = 'idea';
            PLATFORMS.forEach(p => {
                document.getElementById(`plat-${p}`).checked = false;
                document.getElementById(`posted-${p}`).checked = false;
            });
            document.getElementById('video-posted-on-section').style.display = 'none';

            // Reset structured fields
            document.getElementById('video-hook').value = '';
            document.getElementById('video-context').value = '';
            document.getElementById('video-directorNotes').value = '';
            document.getElementById('video-manuscript').value = '';
            document.getElementById('video-recordingInstructions').value = '';
            document.getElementById('video-editingNotes').value = '';
            document.getElementById('video-codexPrompts-list').innerHTML = '';
            document.getElementById('video-editingTimeline-list').innerHTML = '';
            PLATFORMS.forEach(p => {
                document.getElementById(`video-caption-${p}`).value = '';
                document.getElementById(`video-postingnote-${p}`).value = '';
            });

            // Reset section hints
            ['hook', 'context', 'manuscript', 'recording', 'editing', 'captions'].forEach(s => {
                const el = document.getElementById(`vm-hint-${s}`);
                if (el) el.textContent = '';
            });

            // Hide legacy notes
            document.getElementById('video-notes-section').style.display = 'none';

            // Collapse all sections by default for new videos
            document.querySelectorAll('.vm-section').forEach(s => s.classList.add('collapsed'));

            if (videoId) {
                const video = videosData.find(v => v.id === videoId);
                if (!video) return;
                titleEl.textContent = 'Edit Video';
                editIdEl.value = videoId;
                deleteBtn.style.display = '';
                const archiveBtn = document.getElementById('video-archive-btn');
                archiveBtn.style.display = '';
                if (video.status === 'archived') {
                    archiveBtn.innerHTML = '<i class="ti ti-archive-off"></i> Unarchive';
                } else {
                    archiveBtn.innerHTML = '<i class="ti ti-archive"></i> Archive';
                }

                // Basic fields
                document.getElementById('video-title').value = video.title;
                document.getElementById('video-description').value = video.description || '';
                document.getElementById('video-week').value = video.week || '';
                document.getElementById('video-brand').value = video.brand || '';
                document.getElementById('video-duration').value = video.duration || '';
                document.getElementById('video-cameraType').value = video.cameraType || '';
                statusSelect.value = video.status || 'idea';
                (video.platforms || []).forEach(p => {
                    const el = document.getElementById(`plat-${p}`);
                    if (el) el.checked = true;
                });
                (video.postedOn || []).forEach(p => {
                    const el = document.getElementById(`posted-${p}`);
                    if (el) el.checked = true;
                });
                if (video.status === 'posted') {
                    document.getElementById('video-posted-on-section').style.display = '';
                }

                // Structured fields
                document.getElementById('video-hook').value = video.hook || '';
                document.getElementById('video-context').value = video.context || '';
                document.getElementById('video-directorNotes').value = video.directorNotes || '';
                document.getElementById('video-manuscript').value = video.manuscript || '';
                document.getElementById('video-recordingInstructions').value = video.recordingInstructions || '';
                document.getElementById('video-editingNotes').value = video.editingNotes || '';

                // Codex prompts
                (video.codexPrompts || []).forEach(p => addCodexPrompt(p.label, p.prompt));

                // Editing timeline
                (video.editingTimeline || []).forEach(r => addTimelineRow(r.time, r.action, r.overlay));

                // Captions
                const captions = video.captions || {};
                const postingNotes = video.postingNotes || {};
                PLATFORMS.forEach(p => {
                    document.getElementById(`video-caption-${p}`).value = captions[p] || '';
                    document.getElementById(`video-postingnote-${p}`).value = postingNotes[p] || '';
                });

                // Legacy notes (show only if it has content and no structured fields)
                if (video.notes && !video.hook && !video.manuscript) {
                    document.getElementById('video-notes').value = video.notes;
                    document.getElementById('video-notes-section').style.display = '';
                }

                // Expand sections that have content
                updateSectionHints(video);
                if (video.hook) document.getElementById('vm-sec-hook').classList.remove('collapsed');
                if (video.context || video.directorNotes) document.getElementById('vm-sec-context').classList.remove('collapsed');
                if (video.manuscript) document.getElementById('vm-sec-manuscript').classList.remove('collapsed');
                if (video.recordingInstructions || (video.codexPrompts || []).length) document.getElementById('vm-sec-recording').classList.remove('collapsed');
                if ((video.editingTimeline || []).length || video.editingNotes) document.getElementById('vm-sec-editing').classList.remove('collapsed');
                if (Object.values(video.captions || {}).some(Boolean)) document.getElementById('vm-sec-captions').classList.remove('collapsed');
            } else {
                titleEl.textContent = 'Add Video';
                editIdEl.value = '';
                deleteBtn.style.display = 'none';
                // Expand all sections for new video creation
                document.querySelectorAll('.vm-section').forEach(s => s.classList.remove('collapsed'));
            }

            // Show/hide postedOn when status changes
            statusSelect.onchange = () => {
                document.getElementById('video-posted-on-section').style.display =
                    statusSelect.value === 'posted' ? '' : 'none';
            };

            // Set edit mode: new videos start editable, existing start read-only
            if (videoId) {
                setVideoEditMode(false);
                document.getElementById('video-edit-toggle').style.display = '';
            } else {
                setVideoEditMode(true);
                document.getElementById('video-edit-toggle').style.display = 'none';
            }

            modal.style.display = 'flex';
            if (!videoId) document.getElementById('video-title').focus();
        }

        // ---- Read/Edit mode ----

        function setVideoEditMode(editing) {
            videoEditMode = editing;
            videoEditDirty = false;
            const modal = document.getElementById('videoModal');
            const editBtn = document.getElementById('video-edit-toggle');

            if (editing) {
                modal.classList.remove('vm-readonly');
                editBtn.classList.add('active');
                editBtn.innerHTML = '<i class="ti ti-pencil"></i> Editing';
                document.getElementById('video-footer-read').style.display = 'none';
                document.getElementById('video-footer-edit').style.display = 'flex';
                // Track changes
                modal.querySelectorAll('input, textarea, select').forEach(el => {
                    el.addEventListener('input', markVideoDirty, { once: true });
                    el.addEventListener('change', markVideoDirty, { once: true });
                });
            } else {
                modal.classList.add('vm-readonly');
                editBtn.classList.remove('active');
                editBtn.innerHTML = '<i class="ti ti-pencil"></i> Edit';
                document.getElementById('video-footer-read').style.display = 'flex';
                document.getElementById('video-footer-edit').style.display = 'none';
            }
        }

        function markVideoDirty() {
            videoEditDirty = true;
        }

        function toggleVideoEditMode() {
            if (videoEditMode) {
                // Switching from edit to read — warn if dirty
                if (videoEditDirty && !confirm('You have unsaved changes. Discard them?')) return;
                // Reload the video data to discard changes
                const editId = document.getElementById('video-edit-id').value;
                if (editId) openVideoModal(editId);
            } else {
                setVideoEditMode(true);
            }
        }

        function cancelVideoEdit() {
            if (videoEditDirty && !confirm('Discard unsaved changes?')) return;
            const editId = document.getElementById('video-edit-id').value;
            if (editId) {
                // Reload to discard changes
                openVideoModal(editId);
            } else {
                closeVideoModal();
            }
        }

        function closeVideoModal() {
            if (videoEditMode && videoEditDirty) {
                if (!confirm('You have unsaved changes. Close anyway?')) return;
            }
            document.getElementById('videoModal').style.display = 'none';
            videoEditMode = false;
            videoEditDirty = false;
        }

        async function saveVideo() {
            const editId = document.getElementById('video-edit-id').value;
            const title = document.getElementById('video-title').value.trim();
            if (!title) return;

            const body = {
                title,
                description: document.getElementById('video-description').value.trim(),
                notes: document.getElementById('video-notes').value,
                week: document.getElementById('video-week').value.trim(),
                brand: document.getElementById('video-brand').value,
                duration: document.getElementById('video-duration').value.trim(),
                cameraType: document.getElementById('video-cameraType').value.trim(),
                status: document.getElementById('video-status').value,
                platforms: PLATFORMS.filter(p => document.getElementById(`plat-${p}`).checked),
                postedOn: PLATFORMS.filter(p => document.getElementById(`posted-${p}`).checked),
                // Structured fields
                hook: document.getElementById('video-hook').value,
                context: document.getElementById('video-context').value,
                directorNotes: document.getElementById('video-directorNotes').value,
                manuscript: document.getElementById('video-manuscript').value,
                recordingInstructions: document.getElementById('video-recordingInstructions').value,
                codexPrompts: getCodexPrompts(),
                editingTimeline: getEditingTimeline(),
                editingNotes: document.getElementById('video-editingNotes').value,
                captions: {},
                postingNotes: {}
            };
            PLATFORMS.forEach(p => {
                body.captions[p] = document.getElementById(`video-caption-${p}`).value;
                body.postingNotes[p] = document.getElementById(`video-postingnote-${p}`).value;
            });

            try {
                if (editId) {
                    const resp = await fetch(`/api/videos/${editId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    if (resp.ok) {
                        const v = videosData.find(v => v.id === editId);
                        if (v) Object.assign(v, body);
                    }
                } else {
                    const resp = await fetch('/api/videos', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    if (resp.ok) {
                        const data = await resp.json();
                        videosData.push(data.video);
                    }
                }
                renderVideoKanban();
                closeVideoModal();
            } catch (err) {
                console.error('Failed to save video:', err);
            }
        }

        async function togglePlatformPosted(videoId, platform) {
            const video = videosData.find(v => v.id === videoId);
            if (!video) return;

            const postedOn = video.postedOn || [];
            const idx = postedOn.indexOf(platform);
            if (idx >= 0) {
                postedOn.splice(idx, 1);
            } else {
                postedOn.push(platform);
            }
            video.postedOn = postedOn;
            renderVideoKanban();

            try {
                await fetch(`/api/videos/${videoId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ postedOn })
                });
            } catch (err) {
                console.error('Failed to toggle platform posted:', err);
            }
        }

        async function deleteVideo() {
            const editId = document.getElementById('video-edit-id').value;
            if (!editId) return;

            try {
                const resp = await fetch(`/api/videos/${editId}`, { method: 'DELETE' });
                if (resp.ok) {
                    videosData = videosData.filter(v => v.id !== editId);
                    renderVideoKanban();
                    closeVideoModal();
                }
            } catch (err) {
                console.error('Failed to delete video:', err);
            }
        }

        // ---- Archive ----

        async function archiveVideo() {
            const editId = document.getElementById('video-edit-id').value;
            if (!editId) return;

            const video = videosData.find(v => v.id === editId);
            if (!video) return;

            // If already archived, unarchive back to posted
            const newStatus = video.status === 'archived' ? 'posted' : 'archived';

            try {
                const resp = await fetch(`/api/videos/${editId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: newStatus })
                });
                if (resp.ok) {
                    video.status = newStatus;
                    renderVideoKanban();
                    videoEditMode = false;
                    videoEditDirty = false;
                    closeVideoModal();
                }
            } catch (err) {
                console.error('Failed to archive video:', err);
            }
        }

        function renderArchiveList() {
            const list = document.getElementById('video-archive-list');
            if (archivedVideos.length === 0) {
                list.innerHTML = '<div style="text-align:center;color:var(--color-text-subtle);padding:20px;font-size:13px;">No archived videos</div>';
                return;
            }
            list.innerHTML = '<div class="vm-archive-grid">' +
                archivedVideos.map(v => renderVideoCard(v)).join('') +
                '</div>';
            // Re-init click handlers (drag not needed for archived)
        }
