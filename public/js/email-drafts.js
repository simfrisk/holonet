        // =========================================
        // EMAIL DRAFTS
        // =========================================

        let draftsData = [];
        let topicsData = [];
        let activeDraftTopic = 'all';
        let editingDraftId = null;
        let draftsLoaded = false;

        // 8 rotating color palettes for topic badges (light / dark variants)
        const TOPIC_PALETTES_LIGHT = [
            { bg: '#dbeafe', text: '#1d4ed8', border: '#bfdbfe' },
            { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' },
            { bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
            { bg: '#ede9fe', text: '#5b21b6', border: '#ddd6fe' },
            { bg: '#fee2e2', text: '#991b1b', border: '#fecaca' },
            { bg: '#d1fae5', text: '#065f46', border: '#a7f3d0' },
            { bg: '#ffedd5', text: '#9a3412', border: '#fed7aa' },
            { bg: '#e0f2fe', text: '#075985', border: '#bae6fd' },
        ];
        const TOPIC_PALETTES_DARK = [
            { bg: '#1e3a5f', text: '#93c5fd', border: '#2a4e7a' },
            { bg: '#0d3a1a', text: '#6ee7b7', border: '#1a5c2a' },
            { bg: '#3a2a00', text: '#fcd34d', border: '#5a4100' },
            { bg: '#2e1a5e', text: '#c4b5fd', border: '#4a2e8a' },
            { bg: '#3a0d12', text: '#fca5a5', border: '#5c1520' },
            { bg: '#0a3325', text: '#6ee7b7', border: '#155c3a' },
            { bg: '#3a1a00', text: '#fdba74', border: '#5c2a00' },
            { bg: '#0a2d45', text: '#7dd3fc', border: '#124060' },
        ];

        function getTopicPalette(topic) {
            if (!topic) return TOPIC_PALETTES_LIGHT[0];
            let hash = 0;
            for (let i = 0; i < topic.length; i++) {
                hash = ((hash << 5) - hash) + topic.charCodeAt(i);
                hash |= 0;
            }
            const idx = Math.abs(hash) % TOPIC_PALETTES_LIGHT.length;
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            return isDark ? TOPIC_PALETTES_DARK[idx] : TOPIC_PALETTES_LIGHT[idx];
        }

        async function loadDraftsTab() {
            try {
                const [draftsRes, topicsRes] = await Promise.all([
                    fetch('/api/drafts'),
                    fetch('/api/topics')
                ]);
                if (draftsRes.ok) {
                    const data = await draftsRes.json();
                    draftsData = data.drafts || [];
                }
                if (topicsRes.ok) {
                    const data = await topicsRes.json();
                    topicsData = data.topics || [];
                }
                draftsLoaded = true;
                updateDraftsCount();
                renderTopicsSidebar();
                renderDraftsGrid();
            } catch (err) {
                console.error('Failed to load drafts:', err);
            }
        }

        function updateDraftsCount() {
            const el = document.getElementById('drafts-count');
            if (el) el.textContent = draftsData.length;
        }

        function renderTopicsSidebar() {
            const container = document.getElementById('topics-filter-list');
            if (!container) return;
            const allCount = draftsData.length;
            let html = `<button class="topic-filter-btn ${activeDraftTopic === 'all' ? 'active' : ''}"
                data-topic="all" onclick="filterDrafts('all')">All Drafts (${allCount})</button>`;

            topicsData.forEach(topic => {
                const count = draftsData.filter(d => d.topic === topic).length;
                const isActive = activeDraftTopic === topic;
                html += `<div class="topic-row">
                    <button class="topic-filter-btn ${isActive ? 'active' : ''}"
                        data-topic="${escapeHtml(topic)}"
                        onclick="filterDrafts('${escapeAttr(topic)}')"
                        title="${escapeHtml(topic)}">${escapeHtml(topic)} (${count})</button>
                    <button class="topic-delete-btn"
                        onclick="deleteTopic('${escapeAttr(topic)}')"
                        title="Delete topic">×</button>
                </div>`;
            });

            container.innerHTML = html;
        }

        async function deleteTopic(topic) {
            if (!confirm(`Delete the topic "${topic}"? Drafts with this topic won't be deleted.`)) return;
            try {
                const response = await fetch(`/api/topics/${encodeURIComponent(topic)}`, { method: 'DELETE' });
                if (!response.ok) throw new Error('Delete failed');
                const data = await response.json();
                topicsData = data.topics || topicsData;
                if (activeDraftTopic === topic) activeDraftTopic = 'all';
                renderTopicsSidebar();
                renderDraftsGrid();
            } catch (err) {
                alert('Failed to delete topic. Please try again.');
            }
        }

        function renderDraftsGrid() {
            const grid = document.getElementById('drafts-grid');
            const heading = document.getElementById('drafts-heading');
            if (!grid) return;

            const filtered = activeDraftTopic === 'all'
                ? draftsData
                : draftsData.filter(d => d.topic === activeDraftTopic);

            if (heading) {
                heading.textContent = activeDraftTopic === 'all' ? 'All Email Drafts' : `${activeDraftTopic} Drafts`;
            }

            if (filtered.length === 0) {
                grid.innerHTML = `<div class="drafts-empty-state">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                    </svg>
                    <h3>No drafts here yet</h3>
                    <p>Click "+ New Draft" to create your first email template.</p>
                </div>`;
                return;
            }

            grid.innerHTML = filtered.map(draft => buildDraftTileHtml(draft)).join('');
        }

        function buildDraftTileHtml(draft) {
            const pal = getTopicPalette(draft.topic);
            const badgeStyle = `background-color:${pal.bg};color:${pal.text};border:1px solid ${pal.border};`;
            const topBorderColor = pal.text;

            return `<div class="draft-tile" data-draft-id="${escapeHtml(draft.id)}" style="border-top:3px solid ${topBorderColor};">
                <div class="draft-tile-top">
                    <span class="draft-topic-badge" style="${badgeStyle}">${escapeHtml(draft.topic || 'General')}</span>
                </div>
                <p class="draft-tile-subject">${escapeHtml(draft.subject)}</p>
                <div class="draft-tile-body">${escapeHtml(draft.body || '')}</div>
                <div class="draft-tile-actions">
                    <button class="draft-copy-btn copy-subject-btn"
                        onclick="copyDraftField('${escapeAttr(draft.id)}','subject')"
                        title="Copy subject line"><i class="ti ti-clipboard"></i> Subject</button>
                    <button class="draft-copy-btn copy-body-btn"
                        onclick="copyDraftField('${escapeAttr(draft.id)}','body')"
                        title="Copy email body"><i class="ti ti-clipboard-text"></i> Body</button>
                    <button class="draft-edit-btn"
                        onclick="openDraftModal('${escapeAttr(draft.id)}')"
                        title="Edit draft"><i class="ti ti-pencil"></i></button>
                    <button class="draft-delete-btn"
                        onclick="confirmDeleteDraft('${escapeAttr(draft.id)}')"
                        title="Delete draft"><i class="ti ti-trash"></i></button>
                </div>
            </div>`;
        }

        function filterDrafts(topic) {
            activeDraftTopic = topic;
            renderTopicsSidebar();
            renderDraftsGrid();
        }

        async function copyDraftField(draftId, field) {
            const draft = draftsData.find(d => d.id === draftId);
            if (!draft) return;
            const text = field === 'subject' ? (draft.subject || '') : (draft.body || '');

            try {
                await navigator.clipboard.writeText(text);
            } catch (e) {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }

            // Visual feedback on the button
            const tile = document.querySelector(`[data-draft-id="${CSS.escape(draftId)}"]`);
            if (tile) {
                const selector = field === 'subject' ? '.copy-subject-btn' : '.copy-body-btn';
                const btn = tile.querySelector(selector);
                if (btn) {
                    const orig = btn.innerHTML;
                    btn.textContent = 'Copied!';
                    btn.classList.add('copied');
                    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1500);
                }
            }
        }

        function openDraftModal(draftId) {
            editingDraftId = draftId || null;
            const modal = document.getElementById('draftModal');
            const title = document.getElementById('draftModalTitle');
            const submitBtn = document.getElementById('draftSubmitBtn');

            // Populate topic <select>
            const select = document.getElementById('draft-topic-select');
            const opts = topicsData.length
                ? topicsData
                : ['Onboarding', 'Re-engagement', 'Feature Announcement', 'Follow-up', 'General'];
            select.innerHTML = opts.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');

            if (editingDraftId) {
                const draft = draftsData.find(d => d.id === editingDraftId);
                if (!draft) return;
                title.textContent = 'Edit Email Draft';
                submitBtn.textContent = 'Save Changes';
                document.getElementById('draft-subject').value = draft.subject || '';
                document.getElementById('draft-body').value = draft.body || '';
                select.value = draft.topic || opts[0];
            } else {
                title.textContent = 'New Email Draft';
                submitBtn.textContent = 'Save Draft';
                document.getElementById('draft-subject').value = '';
                document.getElementById('draft-body').value = '';
                if (activeDraftTopic !== 'all') select.value = activeDraftTopic;
            }

            document.getElementById('draft-error').style.display = 'none';
            submitBtn.disabled = false;
            modal.style.display = 'block';
            setTimeout(() => document.getElementById('draft-subject').focus(), 50);
        }

        function closeDraftModal() {
            document.getElementById('draftModal').style.display = 'none';
            editingDraftId = null;
        }

        async function saveDraft() {
            const subject = document.getElementById('draft-subject').value.trim();
            const body = document.getElementById('draft-body').value;
            const topic = document.getElementById('draft-topic-select').value;
            const errorEl = document.getElementById('draft-error');
            const submitBtn = document.getElementById('draftSubmitBtn');

            if (!subject) {
                errorEl.textContent = 'Subject is required.';
                errorEl.style.display = 'block';
                return;
            }

            errorEl.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving...';

            try {
                let response;
                if (editingDraftId) {
                    response = await fetch(`/api/drafts/${editingDraftId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ subject, body, topic })
                    });
                } else {
                    response = await fetch('/api/drafts', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ subject, body, topic })
                    });
                }
                if (!response.ok) throw new Error('Save failed');

                // Refresh draft list
                const draftsRes = await fetch('/api/drafts');
                if (draftsRes.ok) {
                    const data = await draftsRes.json();
                    draftsData = data.drafts || [];
                }

                updateDraftsCount();
                renderTopicsSidebar();
                renderDraftsGrid();
                closeDraftModal();
            } catch (err) {
                errorEl.textContent = 'Error saving draft. Please try again.';
                errorEl.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = editingDraftId ? 'Save Changes' : 'Save Draft';
            }
        }

        async function confirmDeleteDraft(draftId) {
            const draft = draftsData.find(d => d.id === draftId);
            if (!draft) return;
            if (!confirm(`Delete the draft "${draft.subject}"?`)) return;

            try {
                const response = await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' });
                if (!response.ok) throw new Error('Delete failed');
                draftsData = draftsData.filter(d => d.id !== draftId);
                updateDraftsCount();
                renderTopicsSidebar();
                renderDraftsGrid();
            } catch (err) {
                alert('Failed to delete draft. Please try again.');
            }
        }

        async function addTopic() {
            const input = document.getElementById('new-topic-input');
            const topic = (input.value || '').trim();
            if (!topic) return;

            try {
                const response = await fetch('/api/topics', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topic })
                });
                if (!response.ok) throw new Error('Failed to add topic');
                const data = await response.json();
                topicsData = data.topics || topicsData;
                input.value = '';
                renderTopicsSidebar();
            } catch (err) {
                console.error('Failed to add topic:', err);
            }
        }
