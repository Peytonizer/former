/**
 * placements.js — the placement list.
 *
 * `Placement[]` is the entire document state the user is editing (see SPEC.md, "The placement
 * model"); everything else — the three writers, the preview overlay, the sidecar, the warnings
 * — is a function of it. This module owns creating, mutating and deleting placements, grouping
 * them by field name, and the one piece of validation that would otherwise fail at write time
 * rather than being caught up front.
 *
 * Pure: no DOM, no pdf-lib types. Every function takes the current array and returns a new one
 * — nothing here mutates a `Placement` or the array it came in.
 */

/** @typedef {'text'|'check'|'signature'|'dropdown'|'radio'} PlacementType */

/**
 * @typedef {{
 *   id: string,
 *   page: number,
 *   type: PlacementType,
 *   rect: { x:number, y:number, w:number, h:number },
 *   name: string,
 *   value: string|boolean,
 *   fontSize: number,
 *   align: 'left'|'centre'|'right',
 *   multiline: boolean,
 *   options: string[],
 *   imageId: string|null,
 *   asTextInTemplate: boolean,
 * }} Placement
 */

const PLACEMENT_TYPES = new Set(['text', 'check', 'signature', 'dropdown', 'radio']);

/**
 * A new placement at a given page and rectangle. `value` defaults per type: `false` for a
 * tick, `''` for everything else — a fresh checkbox is unticked, not "empty".
 *
 * @param {{ id?: string, page: number, type: PlacementType, rect: Placement['rect'] }} args
 * @returns {Placement}
 */
export function createPlacement({ id, page, type, rect }) {
  if (!PLACEMENT_TYPES.has(type)) throw new Error(`Unknown placement type: ${type}`);
  return {
    id: id ?? crypto.randomUUID(),
    page,
    type,
    rect: { ...rect },
    name: '',
    value: type === 'check' ? false : '',
    fontSize: 0,
    align: 'left',
    multiline: false,
    options: [],
    imageId: null,
    asTextInTemplate: false,
  };
}

/**
 * Apply a partial update to one placement, by id. A `rect` in `patch` is merged into the
 * existing rect rather than replacing it, so a resize can pass just `{ w, h }` and a move just
 * `{ x, y }` without the caller having to know the placement's other rect fields.
 *
 * @param {Placement[]} placements
 * @param {string} id
 * @param {Partial<Placement>} patch
 * @returns {Placement[]}
 */
export function updatePlacement(placements, id, patch) {
  return placements.map((p) =>
    p.id === id
      ? { ...p, ...patch, rect: patch.rect ? { ...p.rect, ...patch.rect } : p.rect }
      : p,
  );
}

/**
 * Remove one placement, by id. Removing an id that isn't present is a no-op, not an error —
 * a keyboard delete racing a mouse delete on the same placement should not throw.
 *
 * @param {Placement[]} placements
 * @param {string} id
 * @returns {Placement[]}
 */
export function removePlacement(placements, id) {
  return placements.filter((p) => p.id !== id);
}

/**
 * Copy a placement, offset so the copy doesn't sit exactly on top of the original. The name is
 * cleared rather than copied: sharing a field is a deliberate choice ("same field as…" in the
 * properties panel), not something a generic duplicate command should do silently.
 *
 * @param {Placement[]} placements
 * @param {string} id
 * @param {{x:number, y:number}} [offset]
 * @returns {Placement[]}
 */
export function duplicatePlacement(placements, id, offset = { x: 12, y: -12 }) {
  const source = placements.find((p) => p.id === id);
  if (!source) return placements;
  const copy = {
    ...source,
    id: crypto.randomUUID(),
    name: '',
    rect: { ...source.rect, x: source.rect.x + offset.x, y: source.rect.y + offset.y },
  };
  return [...placements, copy];
}

/**
 * Group placements by name, skipping unnamed ones — an empty name never groups with another
 * empty name. This is the grouping SPEC.md means by "two placements are the same field": there
 * is no separate group object kept in sync, it is computed here on demand.
 *
 * @param {Placement[]} placements
 * @returns {Map<string, Placement[]>}
 */
export function groupByName(placements) {
  const groups = new Map();
  for (const p of placements) {
    if (!p.name) continue;
    const group = groups.get(p.name);
    if (group) group.push(p);
    else groups.set(p.name, [p]);
  }
  return groups;
}

/**
 * Find names shared by placements of more than one type. Two widgets can share one field only
 * when they share a type — pdf-lib has no field type that is a text field on one page and a
 * checkbox on another — so this is what export would otherwise fail on. Surfaced as a
 * pre-export warning by `warnings.js`, not a crash in a writer.
 *
 * @param {Placement[]} placements
 * @returns {{ name: string, types: PlacementType[], placements: Placement[] }[]}
 */
export function findNameTypeConflicts(placements) {
  const conflicts = [];
  for (const [name, group] of groupByName(placements)) {
    const types = [...new Set(group.map((p) => p.type))];
    if (types.length > 1) conflicts.push({ name, types, placements: group });
  }
  return conflicts;
}
