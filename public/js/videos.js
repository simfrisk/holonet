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

        function renderVideoKanban() {
            const total = videosData.length;
            document.getElementById('videos-count').textContent = total;

            VIDEO_STATUSES.forEach(status => {
                const cards = videosData.filter(v => v.status === status);
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

        // ---- Modal ----

        function openVideoModal(videoId) {
            const modal = document.getElementById('videoModal');
            const titleEl = document.getElementById('video-modal-title');
            const editIdEl = document.getElementById('video-edit-id');
            const deleteBtn = document.getElementById('video-delete-btn');
            const statusSelect = document.getElementById('video-status');

            // Reset
            document.getElementById('video-title').value = '';
            document.getElementById('video-description').value = '';
            document.getElementById('video-notes').value = '';
            document.getElementById('video-week').value = '';
            document.getElementById('video-brand').value = '';
            statusSelect.value = 'idea';
            ['youtube', 'instagram', 'tiktok', 'facebook'].forEach(p => {
                document.getElementById(`plat-${p}`).checked = false;
                document.getElementById(`posted-${p}`).checked = false;
            });
            document.getElementById('video-posted-on-section').style.display = 'none';

            if (videoId) {
                const video = videosData.find(v => v.id === videoId);
                if (!video) return;
                titleEl.textContent = 'Edit Video';
                editIdEl.value = videoId;
                deleteBtn.style.display = '';
                document.getElementById('video-title').value = video.title;
                document.getElementById('video-description').value = video.description || '';
                document.getElementById('video-notes').value = video.notes || '';
                document.getElementById('video-week').value = video.week || '';
                document.getElementById('video-brand').value = video.brand || '';
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
            } else {
                titleEl.textContent = 'Add Video';
                editIdEl.value = '';
                deleteBtn.style.display = 'none';
            }

            // Show/hide postedOn when status changes
            statusSelect.onchange = () => {
                document.getElementById('video-posted-on-section').style.display =
                    statusSelect.value === 'posted' ? '' : 'none';
            };

            modal.style.display = 'flex';
            document.getElementById('video-title').focus();
        }

        function closeVideoModal() {
            document.getElementById('videoModal').style.display = 'none';
        }

        async function saveVideo() {
            const editId = document.getElementById('video-edit-id').value;
            const title = document.getElementById('video-title').value.trim();
            if (!title) return;

            const description = document.getElementById('video-description').value.trim();
            const notes = document.getElementById('video-notes').value;
            const week = document.getElementById('video-week').value.trim();
            const brand = document.getElementById('video-brand').value;
            const status = document.getElementById('video-status').value;
            const platforms = ['youtube', 'instagram', 'tiktok', 'facebook'].filter(p =>
                document.getElementById(`plat-${p}`).checked
            );
            const postedOn = ['youtube', 'instagram', 'tiktok', 'facebook'].filter(p =>
                document.getElementById(`posted-${p}`).checked
            );

            const body = { title, description, notes, week, brand, platforms, status, postedOn };

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
