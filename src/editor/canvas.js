/**
 * editor/canvas.js — the drag/resize/select surface over the rendered page.
 *
 * Placements are DOM elements absolutely positioned over the pdf.js canvas, not drawn into it
 * (SPEC.md, "Preview and the editor surface") — this is what gives selection, focus and keyboard
 * access for free, and it means moving a placement never re-renders the page.
 *
 * Two coordinate spaces meet here and must not be conflated. `geometry.js`'s visual<->user
 * transform is about page rotation and is used by the writers; it is untouched by this module.
 * The transform below is unrelated and much simpler — a zoom scale and a y-axis flip, because
 * CSS grows down the page and visual space grows up — and only exists to place a DOM element
 * over a canvas pixel. pdf.js has already accounted for /Rotate by the time a page is on screen,
 * so nothing here reasons about rotation at all.
 *
 * Keyboard access (build stage 16), per SPEC.md: Tab moves between placements in **tab order** —
 * the same descending-visual-y-then-ascending-visual-x rule `writeFields.js` sorts `/Annots` by,
 * so the order a keyboard user meets fields in matches the order they'll actually tab through in
 * the exported PDF. That means placements must render in that order, not creation order — native
 * Tab follows DOM order for equal `tabindex`. Arrow keys nudge the focused placement by 1pt (10pt
 * with Shift); Delete removes it; Enter hands focus to the properties panel via `onActivate`.
 * `render()` rebuilds every placement element from scratch on each change, which would normally
 * steal focus out from under a keyboard user mid-Tab — it re-finds and refocuses the same
 * placement by id afterward specifically to prevent that.
 */
import { createPlacement, duplicatePlacement, removePlacement, updatePlacement } from '../placements.js';

/** A placement can never be resized smaller than this, in points, in either dimension. */
const MIN_SIZE_PT = 8;
/** Arrow-key nudge, in points; 10x that with Shift. */
const NUDGE_PT = 1;
const NUDGE_PT_SHIFT = 10;
/** A new placement made without a mouse (Enter on the empty overlay) gets this rect. */
const DEFAULT_CREATE_RECT = { x: 40, w: 120, h: 24 };

const HANDLE_CORNERS = ['nw', 'ne', 'sw', 'se'];

/** Visual point rect -> CSS pixel rect, given the page's visual height and the current zoom. */
export function cssFromVisual(rect, visualHeight, scale) {
  return {
    left: rect.x * scale,
    top: (visualHeight - rect.y - rect.h) * scale,
    width: rect.w * scale,
    height: rect.h * scale,
  };
}

/** A CSS pixel point (relative to the page stage) -> a visual point. Inverse of the above. */
export function visualFromCss(px, py, visualHeight, scale) {
  return { x: px / scale, y: visualHeight - py / scale };
}

/** Descending visual y (top of the page first), then ascending visual x — the same rule
 * `writeFields.js` sorts a page's `/Annots` by, so Tab order here matches Tab order there. */
function byTabOrder(a, b) {
  return b.rect.y - a.rect.y || a.rect.x - b.rect.x;
}

/** A short screen-reader label for a placement: its type, and its name if it has one. */
function accessibleLabel(placement) {
  const named = placement.name ? `, named "${placement.name}"` : ', unnamed';
  return `${placement.type} placement${named}`;
}

/**
 * @param {{
 *   overlay: HTMLElement,
 *   getPlacements: () => import('../placements.js').Placement[],
 *   getPageIndex: () => number,
 *   getVisualHeight: () => number,
 *   getScale: () => number,
 *   onChange: (next: import('../placements.js').Placement[]) => void,
 *   onSelectionChange?: (id: string|null) => void,
 *   onActivate?: (id: string) => void,
 * }} args
 */
export function createEditorCanvas({
  overlay,
  getPlacements,
  getPageIndex,
  getVisualHeight,
  getScale,
  onChange,
  onSelectionChange,
  onActivate,
}) {
  let tool = 'select';
  let selectedId = null;
  /** @type {null | { kind: 'create', type: string, startPx: {x:number,y:number} }
   *       | { kind: 'move', id: string, startRect: object, startPx: {x:number,y:number} }
   *       | { kind: 'resize', id: string, corner: string, startRect: object, startPx: {x:number,y:number} }} */
  let drag = null;

  overlay.tabIndex = -1; // focusable via script (see focusOverlay), not a normal Tab stop itself

  function placementsOnPage() {
    return getPlacements()
      .filter((p) => p.page === getPageIndex())
      .toSorted(byTabOrder);
  }

  function pointFromEvent(event) {
    const box = overlay.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function commit(next) {
    onChange(next);
    render();
  }

  function render() {
    // A rebuild replaces every element, including whichever one is currently focused — refocus
    // it afterward by id so a keyboard user mid-Tab, or one who just nudged with an arrow key,
    // isn't silently dropped back to the document body.
    const focusedId = overlay.contains(document.activeElement) ? document.activeElement.dataset.id : null;

    const visualHeight = getVisualHeight();
    const scale = getScale();
    const fragment = document.createDocumentFragment();

    for (const p of placementsOnPage()) {
      const el = document.createElement('div');
      el.className = `placement placement-${p.type}${p.id === selectedId ? ' selected' : ''}`;
      el.dataset.id = p.id;
      el.tabIndex = 0;
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', accessibleLabel(p));
      const { left, top, width, height } = cssFromVisual(p.rect, visualHeight, scale);
      Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });

      if (p.name) {
        const label = document.createElement('span');
        label.className = 'placement-label';
        label.textContent = p.name;
        el.append(label);
      }

      if (p.id === selectedId) {
        for (const corner of HANDLE_CORNERS) {
          const handle = document.createElement('div');
          handle.className = `handle handle-${corner}`;
          handle.dataset.corner = corner;
          handle.addEventListener('pointerdown', (event) => startResize(event, p, corner));
          el.append(handle);
        }
      }

      el.addEventListener('pointerdown', (event) => startMoveOrSelect(event, p));
      el.addEventListener('focus', () => select(p.id));
      fragment.append(el);
    }

    overlay.replaceChildren(fragment);

    if (focusedId) {
      overlay.querySelector(`[data-id="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
    }
  }

  function select(id) {
    // Not just an optimisation: render()'s post-rebuild refocus fires this same placement's
    // 'focus' listener again, and without this guard that would recurse into render() forever.
    if (id === selectedId) return;
    selectedId = id;
    onSelectionChange?.(id);
    render();
  }

  function deleteSelectedInternal() {
    if (!selectedId) return;
    commit(removePlacement(getPlacements(), selectedId));
    selectedId = null;
    onSelectionChange?.(null);
    render();
  }

  function nudgeSelected(dx, dy) {
    const placement = getPlacements().find((p) => p.id === selectedId);
    if (!placement) return;
    onChange(updatePlacement(getPlacements(), selectedId, { rect: { x: placement.rect.x + dx, y: placement.rect.y + dy } }));
    render();
  }

  /** Enter on the empty overlay itself, with a create tool active — SPEC.md's "a placement can
   * be created at the current position without a mouse". There is no cursor position to use
   * without a mouse, so this is a fixed, reasonable default rect instead. */
  function createAtDefaultPosition() {
    const visualHeight = getVisualHeight();
    const rect = { ...DEFAULT_CREATE_RECT, y: Math.max(DEFAULT_CREATE_RECT.w, visualHeight - 80) };
    const placement = createPlacement({ page: getPageIndex(), type: tool, rect });
    commit([...getPlacements(), placement]);
    select(placement.id);
  }

  function onKeyDown(event) {
    const onPlacement = event.target.closest?.('.placement');

    if (onPlacement && selectedId) {
      const step = event.shiftKey ? NUDGE_PT_SHIFT : NUDGE_PT;
      const moves = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
      if (moves[event.key]) {
        event.preventDefault();
        nudgeSelected(...moves[event.key]);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelectedInternal();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onActivate?.(selectedId);
        return;
      }
    }

    if (event.target === overlay && tool !== 'select' && event.key === 'Enter') {
      event.preventDefault();
      createAtDefaultPosition();
    }
  }

  function startMoveOrSelect(event, placement) {
    if (event.target.closest('.handle')) return; // the handle's own listener drives a resize
    event.stopPropagation();
    select(placement.id);
    // Focus explicitly, by id, after select()'s render() has already run: preventDefault below
    // (needed so the drag doesn't also try to select page text) suppresses the browser's own
    // click-to-focus, and by the time it would fire the original element may already have been
    // replaced by render() anyway — event.currentTarget would be stale. A fresh query for
    // whatever the current live element with this id is works whether or not render() actually
    // rebuilt anything this time. Without this, arrow-key nudge and Delete right after a mouse
    // click would silently do nothing, since keydown only reaches a placement's own listener
    // when it holds real focus.
    overlay.querySelector(`[data-id="${CSS.escape(placement.id)}"]`)?.focus({ preventScroll: true });
    if (tool !== 'select') return; // a create tool ignores clicks on existing placements
    event.preventDefault();
    overlay.setPointerCapture(event.pointerId);
    drag = { kind: 'move', id: placement.id, startRect: { ...placement.rect }, startPx: pointFromEvent(event) };
  }

  function startResize(event, placement, corner) {
    event.stopPropagation();
    event.preventDefault();
    overlay.setPointerCapture(event.pointerId);
    drag = { kind: 'resize', id: placement.id, corner, startRect: { ...placement.rect }, startPx: pointFromEvent(event) };
  }

  function startCreate(event) {
    if (tool === 'select') {
      select(null);
      return;
    }
    event.preventDefault();
    overlay.setPointerCapture(event.pointerId);
    drag = { kind: 'create', type: tool, startPx: pointFromEvent(event) };
  }

  function onPointerMove(event) {
    if (!drag) return;
    const px = pointFromEvent(event);
    const visualHeight = getVisualHeight();
    const scale = getScale();

    if (drag.kind === 'move') {
      const start = visualFromCss(drag.startPx.x, drag.startPx.y, visualHeight, scale);
      const now = visualFromCss(px.x, px.y, visualHeight, scale);
      const rect = { ...drag.startRect, x: drag.startRect.x + (now.x - start.x), y: drag.startRect.y + (now.y - start.y) };
      onChange(updatePlacement(getPlacements(), drag.id, { rect }));
      render();
      return;
    }

    if (drag.kind === 'resize') {
      onChange(updatePlacement(getPlacements(), drag.id, { rect: resizedRect(drag, px, visualHeight, scale) }));
      render();
      return;
    }

    if (drag.kind === 'create') {
      renderDraft(drag.startPx, px);
    }
  }

  function resizedRect(activeDrag, px, visualHeight, scale) {
    const start = visualFromCss(activeDrag.startPx.x, activeDrag.startPx.y, visualHeight, scale);
    const now = visualFromCss(px.x, px.y, visualHeight, scale);
    const dx = now.x - start.x;
    const dy = now.y - start.y;
    const { x, y, w, h } = activeDrag.startRect;
    const east = activeDrag.corner.includes('e');
    const north = activeDrag.corner.includes('n');

    let nx = east ? x : x + dx;
    let nw = east ? Math.max(MIN_SIZE_PT, w + dx) : Math.max(MIN_SIZE_PT, w - dx);
    if (!east && w - dx < MIN_SIZE_PT) nx = x + w - MIN_SIZE_PT;

    let ny = north ? y : y + dy;
    let nh = north ? Math.max(MIN_SIZE_PT, h + dy) : Math.max(MIN_SIZE_PT, h - dy);
    if (!north && h - dy < MIN_SIZE_PT) ny = y + h - MIN_SIZE_PT;

    return { x: nx, y: ny, w: nw, h: nh };
  }

  /** A live rectangle shown while dragging out a new placement, before it exists in the list. */
  function renderDraft(fromPx, toPx) {
    let draftEl = overlay.querySelector('.placement-draft');
    if (!draftEl) {
      draftEl = document.createElement('div');
      draftEl.className = `placement-draft placement-${drag.type}`;
      overlay.append(draftEl);
    }
    const left = Math.min(fromPx.x, toPx.x);
    const top = Math.min(fromPx.y, toPx.y);
    Object.assign(draftEl.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${Math.abs(toPx.x - fromPx.x)}px`,
      height: `${Math.abs(toPx.y - fromPx.y)}px`,
    });
  }

  function onPointerUp(event) {
    if (!drag) return;
    overlay.releasePointerCapture(event.pointerId);

    if (drag.kind === 'create') {
      const px = pointFromEvent(event);
      const visualHeight = getVisualHeight();
      const scale = getScale();
      const a = visualFromCss(drag.startPx.x, drag.startPx.y, visualHeight, scale);
      const b = visualFromCss(px.x, px.y, visualHeight, scale);
      const rect = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.max(MIN_SIZE_PT, Math.abs(b.x - a.x)),
        h: Math.max(MIN_SIZE_PT, Math.abs(b.y - a.y)),
      };
      overlay.querySelector('.placement-draft')?.remove();
      const placement = createPlacement({ page: getPageIndex(), type: drag.type, rect });
      commit([...getPlacements(), placement]);
      // The tool stays active — placing several fields of the same type in a row is the common
      // case — rather than reverting to 'select', which would desync the toolbar's active
      // button from the editor's actual tool. Resize handles work regardless of the active
      // tool, so the new placement can still be adjusted immediately without switching.
      select(placement.id);
    }

    drag = null;
  }

  overlay.addEventListener('pointerdown', startCreate);
  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('keydown', onKeyDown);

  return {
    render,
    /** Programmatic focus for a keyboard user who just picked a create tool from the toolbar —
     * not a normal Tab stop itself (see the `tabIndex = -1` above), so this is how it's reached. */
    focusOverlay() {
      overlay.focus({ preventScroll: true });
    },
    setTool(next) {
      tool = next;
      if (tool !== 'select') select(null);
    },
    getTool: () => tool,
    getSelectedId: () => selectedId,
    deleteSelected: deleteSelectedInternal,
    duplicateSelected() {
      if (!selectedId) return;
      const next = duplicatePlacement(getPlacements(), selectedId);
      const copy = next.at(-1);
      commit(next);
      select(copy.id);
    },
  };
}
