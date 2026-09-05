import { describe, expect, it } from 'vitest';

import { normaliseRotation, userFromVisual, visualFromUser, visualSize } from '../src/geometry.js';

/** A4 portrait, box origin at (0,0). */
const a4 = (rotate = 0) => ({ x0: 0, y0: 0, w: 595, h: 842, rotate });

/** A page cropped out of a larger sheet — the box origin is not (0,0). */
const cropped = (rotate = 0) => ({ x0: 30, y0: 45, w: 595, h: 842, rotate });

describe('normaliseRotation', () => {
  it('passes through the four legal values', () => {
    for (const r of [0, 90, 180, 270]) {
      expect(normaliseRotation(r)).toEqual({ rotate: r, rounded: false });
    }
  });

  it('wraps values outside 0–359', () => {
    expect(normaliseRotation(360).rotate).toBe(0);
    expect(normaliseRotation(450).rotate).toBe(90);
    expect(normaliseRotation(-90).rotate).toBe(270);
    expect(normaliseRotation(-450).rotate).toBe(270);
  });

  it('snaps a non-multiple of 90 and says that it did', () => {
    expect(normaliseRotation(87)).toEqual({ rotate: 90, rounded: true });
    expect(normaliseRotation(315)).toEqual({ rotate: 0, rounded: true });
  });

  it('treats a missing or malformed value as 0', () => {
    expect(normaliseRotation(undefined).rotate).toBe(0);
    expect(normaliseRotation(Number.NaN).rotate).toBe(0);
  });
});

describe('visualSize', () => {
  it('leaves an unrotated page alone', () => {
    expect(visualSize(a4(0))).toEqual({ width: 595, height: 842 });
    expect(visualSize(a4(180))).toEqual({ width: 595, height: 842 });
  });

  it('swaps the axes on a quarter-turned page', () => {
    expect(visualSize(a4(90))).toEqual({ width: 842, height: 595 });
    expect(visualSize(a4(270))).toEqual({ width: 842, height: 595 });
  });
});

describe('userFromVisual', () => {
  it('is the identity plus the box origin at rotate 0', () => {
    expect(userFromVisual(a4(0), 100, 200)).toEqual({ x: 100, y: 200 });
    expect(userFromVisual(cropped(0), 100, 200)).toEqual({ x: 130, y: 245 });
  });

  it('maps the visual origin to the displayed bottom-left for every rotation', () => {
    // Whatever the rotation, visual (0,0) is the corner the reader sees at bottom-left.
    expect(userFromVisual(a4(0), 0, 0)).toEqual({ x: 0, y: 0 });
    expect(userFromVisual(a4(90), 0, 0)).toEqual({ x: 595, y: 0 });
    expect(userFromVisual(a4(180), 0, 0)).toEqual({ x: 595, y: 842 });
    expect(userFromVisual(a4(270), 0, 0)).toEqual({ x: 0, y: 842 });
  });

  it('maps the far visual corner to the box corner diagonally opposite', () => {
    // Visual top-right is a different box corner for each rotation. These are the four
    // corners of a 595x842 box, one per rotation, and no two are the same.
    const expected = {
      0: { x: 595, y: 842 },
      90: { x: 0, y: 842 },
      180: { x: 0, y: 0 },
      270: { x: 595, y: 0 },
    };
    for (const rotate of [0, 90, 180, 270]) {
      const g = a4(rotate);
      const { width, height } = visualSize(g);
      expect(userFromVisual(g, width, height)).toEqual(expected[rotate]);
    }
  });

  it('round-trips through visualFromUser for every rotation, cropped or not', () => {
    for (const make of [a4, cropped]) {
      for (const rotate of [0, 90, 180, 270]) {
        const g = make(rotate);
        const { width, height } = visualSize(g);
        for (const [vx, vy] of [[0, 0], [10, 20], [300, 700], [841.9, 594.9]]) {
          if (vx > width || vy > height) continue;
          const u = userFromVisual(g, vx, vy);
          const back = visualFromUser(g, u.x, u.y);
          expect(back.x).toBeCloseTo(vx, 9);
          expect(back.y).toBeCloseTo(vy, 9);
        }
      }
    }
  });

  it('keeps every mapped point inside the page box', () => {
    for (const rotate of [0, 90, 180, 270]) {
      const g = cropped(rotate);
      const { width, height } = visualSize(g);
      for (const [vx, vy] of [
        [0, 0],
        [width, 0],
        [0, height],
        [width, height],
        [width / 2, height / 2],
      ]) {
        const { x, y } = userFromVisual(g, vx, vy);
        expect(x).toBeGreaterThanOrEqual(g.x0 - 1e-9);
        expect(x).toBeLessThanOrEqual(g.x0 + g.w + 1e-9);
        expect(y).toBeGreaterThanOrEqual(g.y0 - 1e-9);
        expect(y).toBeLessThanOrEqual(g.y0 + g.h + 1e-9);
      }
    }
  });

  it('rejects a rotation that was never normalised', () => {
    expect(() => userFromVisual({ x0: 0, y0: 0, w: 595, h: 842, rotate: 45 }, 0, 0)).toThrow();
    expect(() => visualFromUser({ x0: 0, y0: 0, w: 595, h: 842, rotate: 45 }, 0, 0)).toThrow();
  });
});

// The worked example from SPEC.md, "Drawing under rotation". If this fails, the transform is
// wrong — the numbers here were derived by hand from the rotation matrices, not from the code.
describe('SPEC.md worked example — A4 portrait with /Rotate 90', () => {
  const g = a4(90);

  it('has the anchor the spec says it has', () => {
    expect(userFromVisual(g, 700, 20)).toEqual({ x: 575, y: 700 });
  });

  it('places a 60x40 image on the visual rectangle the spec says it does', () => {
    // pdf-lib draws the image from its own bottom-left, rotated counter-clockwise by /Rotate
    // about that anchor. Under a 90° CCW rotation the image's local +x runs along user +y and
    // its local +y runs along user -x.
    const anchor = userFromVisual(g, 700, 20);
    const corners = {
      bottomLeft: anchor,
      bottomRight: { x: anchor.x, y: anchor.y + 60 },
      topLeft: { x: anchor.x - 40, y: anchor.y },
      topRight: { x: anchor.x - 40, y: anchor.y + 60 },
    };
    expect(visualFromUser(g, corners.bottomLeft.x, corners.bottomLeft.y)).toEqual({ x: 700, y: 20 });
    expect(visualFromUser(g, corners.bottomRight.x, corners.bottomRight.y)).toEqual({ x: 760, y: 20 });
    expect(visualFromUser(g, corners.topLeft.x, corners.topLeft.y)).toEqual({ x: 700, y: 60 });
    expect(visualFromUser(g, corners.topRight.x, corners.topRight.y)).toEqual({ x: 760, y: 60 });
  });
});
