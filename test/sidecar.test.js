import { describe, expect, it } from 'vitest';

import { createPlacement } from '../src/placements.js';
import { compareSidecar, createSidecar, hashBytes, parseSidecar, serialiseSidecar } from '../src/sidecar.js';

const geometries = [{ x0: 0, y0: 0, w: 595, h: 842, rotate: 0 }, { x0: 0, y0: 0, w: 595, h: 842, rotate: 0 }];
const bytes = new Uint8Array([1, 2, 3, 4, 5]);

describe('hashBytes', () => {
  it('is deterministic', async () => {
    expect(await hashBytes(bytes)).toBe(await hashBytes(bytes));
  });

  it('differs for different bytes', async () => {
    expect(await hashBytes(bytes)).not.toBe(await hashBytes(new Uint8Array([9, 9, 9])));
  });

  it('is a 64-character lowercase hex string', async () => {
    const hash = await hashBytes(bytes);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('createSidecar / serialiseSidecar / parseSidecar', () => {
  it('round-trips a placement list, verbatim', async () => {
    const placements = [createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 10, w: 100, h: 20 } })];
    placements[0].name = 'signed';
    placements[0].value = 'Jane';

    const sidecar = await createSidecar(bytes, geometries, placements);
    const parsed = parseSidecar(serialiseSidecar(sidecar));

    expect(parsed.placements).toEqual(placements);
    expect(parsed.former).toBe(1);
    expect(parsed.source.pageCount).toBe(2);
    expect(parsed.source.firstPageSize).toEqual([595, 842]);
    expect(parsed.source.sha256).toBe(await hashBytes(bytes));
    expect(typeof parsed.savedAt).toBe('string');
  });

  it('rejects a sidecar of an unrecognised version', () => {
    expect(() => parseSidecar(JSON.stringify({ former: 999, source: {}, placements: [] }))).toThrow(
      /former.*999/,
    );
  });

  it('rejects malformed JSON', () => {
    expect(() => parseSidecar('not json')).toThrow();
  });

  it('rejects something that parses but isn\'t a sidecar at all', () => {
    expect(() => parseSidecar(JSON.stringify({ hello: 'world' }))).toThrow();
  });
});

describe('compareSidecar', () => {
  it('matches when the hash is identical', async () => {
    const sidecar = await createSidecar(bytes, geometries, []);
    expect(await compareSidecar(sidecar, bytes, geometries)).toBe('match');
  });

  it('warns ("changed") when the hash differs but page count and first page size match', async () => {
    const sidecar = await createSidecar(bytes, geometries, []);
    const differentBytes = new Uint8Array([9, 9, 9, 9, 9]);
    expect(await compareSidecar(sidecar, differentBytes, geometries)).toBe('changed');
  });

  it('refuses when the page count differs', async () => {
    const sidecar = await createSidecar(bytes, geometries, []);
    const differentBytes = new Uint8Array([9, 9, 9]);
    const fewerPages = [geometries[0]];
    expect(await compareSidecar(sidecar, differentBytes, fewerPages)).toBe('refuse');
  });

  it('refuses when page count matches but the first page size does not', async () => {
    const sidecar = await createSidecar(bytes, geometries, []);
    const differentBytes = new Uint8Array([9, 9, 9]);
    const differentShape = [{ x0: 0, y0: 0, w: 842, h: 595, rotate: 0 }, geometries[1]];
    expect(await compareSidecar(sidecar, differentBytes, differentShape)).toBe('refuse');
  });
});
