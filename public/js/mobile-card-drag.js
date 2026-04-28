        // =========================================
        // MOBILE / TOUCH CARD DRAG
        // =========================================
        function initMobileCardDrag(options) {
            if (!window.PointerEvent || !options) return;

            const handles = document.querySelectorAll(options.handleSelector);
            handles.forEach(handle => {
                if (handle.dataset.mobileDragReady === 'true') return;
                handle.dataset.mobileDragReady = 'true';
                handle.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                });
                handle.addEventListener('pointerdown', e => startMobileCardDrag(e, options));
            });
        }

        function startMobileCardDrag(e, options) {
            if (e.button != null && e.button !== 0) return;

            const source = e.target.closest(options.itemSelector);
            if (!source) return;

            e.preventDefault();
            e.stopPropagation();

            const sourceRect = source.getBoundingClientRect();
            const state = {
                options,
                source,
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                offsetX: e.clientX - sourceRect.left,
                offsetY: e.clientY - sourceRect.top,
                ghost: null,
                dragging: false,
                targetItem: null,
                targetContainer: null
            };

            const move = event => onMobileCardDragMove(event, state);
            const end = event => onMobileCardDragEnd(event, state, move, end);

            e.currentTarget.setPointerCapture?.(e.pointerId);
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', end, { once: true });
            document.addEventListener('pointercancel', end, { once: true });
        }

        function onMobileCardDragMove(e, state) {
            if (e.pointerId !== state.pointerId) return;
            const dx = e.clientX - state.startX;
            const dy = e.clientY - state.startY;

            if (!state.dragging && Math.hypot(dx, dy) < 7) return;
            if (!state.dragging) {
                state.dragging = true;
                state.source.classList.add('mobile-card-dragging');
                state.ghost = createMobileDragGhost(state.source);
                document.body.classList.add('mobile-card-drag-active');
            }

            e.preventDefault();
            moveMobileDragGhost(state.ghost, e.clientX - state.offsetX, e.clientY - state.offsetY);
            updateMobileDragTarget(e, state);
        }

        async function onMobileCardDragEnd(e, state, move, end) {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', end);
            document.removeEventListener('pointercancel', end);

            clearMobileDragHighlights(state.options);
            document.body.classList.remove('mobile-card-drag-active');
            state.source.classList.remove('mobile-card-dragging');
            if (state.ghost) state.ghost.remove();

            if (!state.dragging) return;
            e.preventDefault();
            e.stopPropagation();

            state.source.dataset.mobileDragJustFinished = 'true';
            setTimeout(() => delete state.source.dataset.mobileDragJustFinished, 250);

            const drop = {
                source: state.source,
                targetItem: state.targetItem,
                targetContainer: state.targetContainer,
                position: getMobileDropPosition(e, state.targetItem)
            };
            if (state.targetContainer && typeof state.options.onDrop === 'function') {
                await state.options.onDrop(drop);
            }
        }

        function createMobileDragGhost(source) {
            const rect = source.getBoundingClientRect();
            const ghost = source.cloneNode(true);
            ghost.classList.add('mobile-card-drag-ghost');
            ghost.style.width = `${rect.width}px`;
            ghost.style.height = `${rect.height}px`;
            ghost.style.left = `${rect.left}px`;
            ghost.style.top = `${rect.top}px`;
            document.body.appendChild(ghost);
            return ghost;
        }

        function moveMobileDragGhost(ghost, left, top) {
            if (!ghost) return;
            ghost.style.left = `${left}px`;
            ghost.style.top = `${top}px`;
        }

        function updateMobileDragTarget(e, state) {
            const { options, source } = state;
            const ghostDisplay = state.ghost?.style.display;
            if (state.ghost) state.ghost.style.display = 'none';
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (state.ghost) state.ghost.style.display = ghostDisplay || '';

            clearMobileDragHighlights(options);
            state.targetItem = null;
            state.targetContainer = null;

            if (!el) return;

            const item = el.closest(options.itemSelector);
            const container = el.closest(options.containerSelector) || item?.closest(options.containerSelector);
            if (!container) return;

            state.targetContainer = container;
            if (item && item !== source) {
                state.targetItem = item;
                item.classList.add(options.itemOverClass || 'mobile-card-drag-over');
            }
            const highlightContainer = options.containerHighlightSelector
                ? container.closest(options.containerHighlightSelector)
                : container;
            highlightContainer?.classList.add(options.containerOverClass || 'mobile-card-drop-over');
        }

        function getMobileDropPosition(e, targetItem) {
            if (!targetItem) return 'end';
            const rect = targetItem.getBoundingClientRect();
            return e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
        }

        function clearMobileDragHighlights(options) {
            document.querySelectorAll(`.${options.itemOverClass || 'mobile-card-drag-over'}`).forEach(el => {
                el.classList.remove(options.itemOverClass || 'mobile-card-drag-over');
            });
            document.querySelectorAll(`.${options.containerOverClass || 'mobile-card-drop-over'}`).forEach(el => {
                el.classList.remove(options.containerOverClass || 'mobile-card-drop-over');
            });
        }

        function getMobileBeforeId(container, targetItem, source, idAttr, position) {
            if (!targetItem) return null;
            if (position === 'before') return targetItem.dataset[idAttr];

            const items = Array.from(container.children).filter(el => {
                return el !== source && el.matches?.(`[data-${dataAttrName(idAttr)}]`);
            });
            const targetIndex = items.indexOf(targetItem);
            const nextItem = targetIndex === -1 ? null : items[targetIndex + 1];
            return nextItem ? nextItem.dataset[idAttr] : null;
        }

        function dataAttrName(datasetKey) {
            return datasetKey.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
        }
