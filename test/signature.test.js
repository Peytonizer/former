import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { hasNoTransparency, sniffImageType } from '../src/signature.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => readFileSync(join(FIXTURES, name));

describe('sniffImageType', () => {
  it('recognises a real PNG by its magic bytes', () => {
    expect(sniffImageType(fixture('sig.png'))).toBe('image/png');
  });

  it('recognises a real JPEG by its magic bytes', () => {
    expect(sniffImageType(fixture('sig.jpg'))).toBe('image/jpeg');
  });

  it('refuses anything else, regardless of what it claims to be', () => {
    expect(sniffImageType(fixture('not-an-image.heic'))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    expect(sniffImageType(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('is not fooled by a file merely renamed to .png', () => {
    // not-an-image.heic's bytes, regardless of what extension a user gives it.
    const bytes = fixture('not-an-image.heic');
    expect(sniffImageType(bytes)).not.toBe('image/png');
  });
});

describe('hasNoTransparency', () => {
  it('is true for JPEG — it can never carry an alpha channel', () => {
    expect(hasNoTransparency('image/jpeg')).toBe(true);
  });

  it('is false for PNG', () => {
    expect(hasNoTransparency('image/png')).toBe(false);
  });
});
