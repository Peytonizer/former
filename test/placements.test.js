import { describe, expect, it } from 'vitest';

import {
  createPlacement,
  duplicatePlacement,
  findNameTypeConflicts,
  groupByName,
  removePlacement,
  updatePlacement,
} from '../src/placements.js';

const rect = { x: 10, y: 20, w: 100, h: 30 };

describe('createPlacement', () => {
  it('fills in the rest of the shape with sensible defaults', () => {
    const p = createPlacement({ page: 0, type: 'text', rect });
    expect(p.page).toBe(0);
    expect(p.type).toBe('text');
    expect(p.rect).toEqual(rect);
    expect(p.name).toBe('');
    expect(p.value).toBe('');
    expect(p.fontSize).toBe(0);
    expect(p.align).toBe('left');
    expect(p.multiline).toBe(false);
    expect(p.options).toEqual([]);
    expect(p.imageId).toBeNull();
    expect(p.asTextInTemplate).toBe(false);
    expect(typeof p.id).toBe('string');
    expect(p.id.length).toBeGreaterThan(0);
  });

  it('defaults a tick to unticked, not an empty string', () => {
    const p = createPlacement({ page: 0, type: 'check', rect });
    expect(p.value).toBe(false);
  });

  it('copies the rect rather than aliasing the caller\'s object', () => {
    const original = { ...rect };
    const p = createPlacement({ page: 0, type: 'text', rect: original });
    p.rect.x = 999;
    expect(original.x).toBe(10);
  });

  it('gives every placement a distinct id', () => {
    const a = createPlacement({ page: 0, type: 'text', rect });
    const b = createPlacement({ page: 0, type: 'text', rect });
    expect(a.id).not.toBe(b.id);
  });

  it('accepts an explicit id, for reconstructing placements from a sidecar', () => {
    const p = createPlacement({ id: 'fixed-id', page: 0, type: 'text', rect });
    expect(p.id).toBe('fixed-id');
  });

  it('rejects an unknown type', () => {
    expect(() => createPlacement({ page: 0, type: 'bogus', rect })).toThrow(/Unknown placement type/);
  });
});

describe('updatePlacement', () => {
  it('merges a patch into the matching placement and leaves others untouched', () => {
    const a = createPlacement({ id: 'a', page: 0, type: 'text', rect });
    const b = createPlacement({ id: 'b', page: 0, type: 'text', rect });
    const result = updatePlacement([a, b], 'a', { name: 'signed' });
    expect(result.find((p) => p.id === 'a').name).toBe('signed');
    expect(result.find((p) => p.id === 'b').name).toBe('');
  });

  it('merges a partial rect rather than replacing it', () => {
    const a = createPlacement({ id: 'a', page: 0, type: 'text', rect });
    const result = updatePlacement([a], 'a', { rect: { x: 500 } });
    expect(result[0].rect).toEqual({ x: 500, y: 20, w: 100, h: 30 });
  });

  it('does not mutate the input array or its placements', () => {
    const a = createPlacement({ id: 'a', page: 0, type: 'text', rect });
    const before = [a];
    updatePlacement(before, 'a', { name: 'signed' });
    expect(before[0].name).toBe('');
  });
});

describe('removePlacement', () => {
  it('removes the matching placement', () => {
    const a = createPlacement({ id: 'a', page: 0, type: 'text', rect });
    const b = createPlacement({ id: 'b', page: 0, type: 'text', rect });
    expect(removePlacement([a, b], 'a')).toEqual([b]);
  });

  it('is a no-op when the id is not present', () => {
    const a = createPlacement({ id: 'a', page: 0, type: 'text', rect });
    expect(removePlacement([a], 'missing')).toEqual([a]);
  });
});

describe('duplicatePlacement', () => {
  it('appends an offset copy with a new id and no name', () => {
    const a = createPlacement({ id: 'a', page: 0, type: 'text', rect });
    const named = updatePlacement([a], 'a', { name: 'signed' })[0];
    const result = duplicatePlacement([named], 'a');
    expect(result).toHaveLength(2);
    const copy = result[1];
    expect(copy.id).not.toBe('a');
    expect(copy.name).toBe('');
    expect(copy.rect).toEqual({ x: 22, y: 8, w: 100, h: 30 });
  });

  it('is a no-op when the id is not present', () => {
    const a = createPlacement({ id: 'a', page: 0, type: 'text', rect });
    expect(duplicatePlacement([a], 'missing')).toEqual([a]);
  });
});

describe('groupByName', () => {
  it('groups placements sharing a non-empty name', () => {
    const a = updatePlacement([createPlacement({ id: 'a', page: 0, type: 'text', rect })], 'a', {
      name: 'signed',
    })[0];
    const b = updatePlacement([createPlacement({ id: 'b', page: 1, type: 'text', rect })], 'b', {
      name: 'signed',
    })[0];
    const groups = groupByName([a, b]);
    expect(groups.get('signed')).toEqual([a, b]);
  });

  it('never groups two unnamed placements together', () => {
    const a = createPlacement({ id: 'a', page: 0, type: 'text', rect });
    const b = createPlacement({ id: 'b', page: 0, type: 'text', rect });
    const groups = groupByName([a, b]);
    expect(groups.size).toBe(0);
  });
});

describe('findNameTypeConflicts', () => {
  it('flags a name shared across placements of different types', () => {
    const text = updatePlacement(
      [createPlacement({ id: 'a', page: 0, type: 'text', rect })],
      'a',
      { name: 'signed' },
    )[0];
    const check = updatePlacement(
      [createPlacement({ id: 'b', page: 1, type: 'check', rect })],
      'b',
      { name: 'signed' },
    )[0];
    const conflicts = findNameTypeConflicts([text, check]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].name).toBe('signed');
    expect(conflicts[0].types.toSorted()).toEqual(['check', 'text']);
  });

  it('does not flag a name shared across placements of the same type', () => {
    const a = updatePlacement(
      [createPlacement({ id: 'a', page: 0, type: 'text', rect })],
      'a',
      { name: 'signed' },
    )[0];
    const b = updatePlacement(
      [createPlacement({ id: 'b', page: 1, type: 'text', rect })],
      'b',
      { name: 'signed' },
    )[0];
    expect(findNameTypeConflicts([a, b])).toEqual([]);
  });

  it('finds nothing when nothing is named', () => {
    const a = createPlacement({ page: 0, type: 'text', rect });
    expect(findNameTypeConflicts([a])).toEqual([]);
  });
});
