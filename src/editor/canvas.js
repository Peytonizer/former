/**
 * editor/canvas.js — the drag/resize/select surface over the rendered page.
 *
 * Placements are DOM elements absolutely positioned over the pdf.js canvas, not drawn into it
 * (SPEC.md, "Preview and the editor surface") — this is what gives selection and focus for free,
 * and it means moving a placement never re-renders the page. Mouse only at this stage; keyboard
 * access (Tab order, nudging, a placement created without a mouse) is stage 16.
 *
 * Two coordinate spaces meet here and must not be conflated. `geometry.js`'s visual<->user
 * transform is about page rotation and is used by the writers; it is untouched by this module.
 * The transform below is unrelated and much simpler — a zoom scale and a y-axis flip, because
 * CSS grows down the page and visual space grows up — and only exists to place a DOM element
 * over a canvas pixel. pdf.js has already accounted for /Rotate by the time a page is on screen,
 * so nothing here reasons about rotation at all.
 */
import { createPlacement, duplicatePlacement, removePlacement, updatePlacement } from '../placements.js';

/** A placement can never be resized smaller than this, in points, in either dimension. */
const MIN_SIZE_PT = 8;

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

/**
 * @param {{
 *   overlay: HTMLElement,
 *   getPlacements: () => import('../placements.js').Placement[],
 *   getPageIndex: () => number,
 *   getVisualHeight: () => number,
 *   getScale: () => number,
 *   onChange: (next: import('../placements.js').Placement[]) => void,
 *   onSelectionChange?: (id: string|null) => void,
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
}) {
  let tool = 'select';
  let selectedId = null;
  /** @type {null | { kind: 'create', type: string, startPx: {x:number,y:number} }
   *       | { kind: 'move', id: string, startRect: object, startPx: {x:number,y:number} }
   *       | { kind: 'resize', id: string, corner: string, startRect: object, startPx: {x:number,y:number} }} */
  let drag = null;

  function placementsOnPage() {
    return getPlacements().filter((p) => p.page === getPageIndex());
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
    const visualHeight = getVisualHeight();
    const scale = getScale();
    const fragment = document.createDocumentFragment();

    for (const p of placementsOnPage()) {
      const el = document.createElement('div');
      el.className = `placement placement-${p.type}${p.id === selectedId ? ' selected' : ''}`;
      el.dataset.id = p.id;
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
      fragment.append(el);
    }

    overlay.replaceChildren(fragment);
  }

  function select(id) {
    selectedId = id;
    onSelectionChange?.(id);
    render();
  }

  function startMoveOrSelect(event, placement) {
    if (event.target.closest('.handle')) return; // the handle's own listener drives a resize
    event.stopPropagation();
    select(placement.id);
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

  return {
    render,
    setTool(next) {
      tool = next;
      if (tool !== 'select') select(null);
    },
    getTool: () => tool,
    getSelectedId: () => selectedId,
    deleteSelected() {
      if (!selectedId) return;
      commit(removePlacement(getPlacements(), selectedId));
      selectedId = null;
      onSelectionChange?.(null);
      render();
    },
    duplicateSelected() {
      if (!selectedId) return;
      const next = duplicatePlacement(getPlacements(), selectedId);
      const copy = next.at(-1);
      commit(next);
      select(copy.id);
    },
  };
}
