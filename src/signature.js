/**
 * signature.js — capturing, sniffing and storing signature images.
 *
 * The one deliberate exception to "nothing is persisted" (SPEC.md, "Signature storage"): a
 * saved signature lives in IndexedDB so it doesn't have to be re-drawn every session. Everything
 * else in former — the document, its values, the placement list — stays in memory only.
 *
 * Two ways in, per SPEC.md's "Signatures": drawn on a canvas (`createSignaturePad`) or uploaded
 * as a file. Either way the bytes are sniffed by magic number (`sniffImageType`), never trusted
 * by file extension or claimed MIME type — a `.png` that isn't one gets a clear refusal, not a
 * silent failure downstream in a writer.
 */

/** Sniff image bytes by magic number. Returns `'image/png'`, `'image/jpeg'`, or `null` for
 * anything else — including a file that merely claims to be one of these by name or MIME type. */
export function sniffImageType(bytes) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

/**
 * PNGs from a real encoder occasionally (rarely) omit an alpha channel, but the point of
 * recommending PNG in the picker is transparency — this only ever reports what JPEG can never
 * have, not a full pixel scan. A JPEG signature drawn over content carries an opaque white
 * rectangle with it (SPEC.md, "Signatures"); the caller is expected to warn when this is true.
 */
export function hasNoTransparency(mimeType) {
  return mimeType === 'image/jpeg';
}

const DB_NAME = 'former-signatures';
const DB_VERSION = 1;
const STORE_NAME = 'signatures';

/** @typedef {{ id: string, label: string, mimeType: string, bytes: Uint8Array, createdAt: number }} StoredSignature */

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

/** Run one request against the signature store and resolve/reject with it. */
async function runRequest(mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
    const request = run(store);
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

/**
 * Save a signature. More than one is allowed at once (SPEC.md: "a signature and a set of
 * initials is the common pair") — `id` distinguishes them, and saving an existing `id` again
 * overwrites it.
 *
 * @param {{ id: string, label: string, mimeType: string, bytes: Uint8Array }} signature
 */
export async function saveSignature({ id, label, mimeType, bytes }) {
  await runRequest('readwrite', (store) => store.put({ id, label, mimeType, bytes, createdAt: Date.now() }));
}

/** @returns {Promise<StoredSignature|undefined>} */
export async function loadSignature(id) {
  return runRequest('readonly', (store) => store.get(id));
}

/** @returns {Promise<StoredSignature[]>} */
export async function listSignatures() {
  const all = await runRequest('readonly', (store) => store.getAll());
  return all.toSorted((a, b) => a.createdAt - b.createdAt);
}

/** Remove one saved signature. The one-click "clear" control calls this — see CLAUDE.md's
 * privacy section: a signature left on a shared machine should be easy to remove. */
export async function deleteSignature(id) {
  await runRequest('readwrite', (store) => store.delete(id));
}

/** Remove every saved signature at once. */
export async function clearAllSignatures() {
  await runRequest('readwrite', (store) => store.clear());
}

const STROKE_WIDTH_PX = 2.5;
const STROKE_COLOR = '#1a1a1e';

/**
 * Wire up a signature-capture canvas. Pointer events draw a smoothed stroke (quadratic curves
 * through consecutive midpoints, the standard technique for freehand canvas drawing — a straight
 * line segment per pointermove looks visibly faceted on a fast stroke) on a transparent
 * background, matching the "drawn on a canvas" half of SPEC.md's two ways in.
 *
 * @param {HTMLCanvasElement} canvas
 */
export function createSignaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = STROKE_WIDTH_PX;
  ctx.strokeStyle = STROKE_COLOR;

  let drawing = false;
  let hasContent = false;
  let previous = null; // the last raw point
  let previousMid = null; // the midpoint the last curve segment ended at

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event) {
    drawing = true;
    previous = pointFromEvent(event);
    previousMid = previous;
  }

  function move(event) {
    if (!drawing) return;
    const point = pointFromEvent(event);
    const mid = { x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(previousMid.x, previousMid.y);
    ctx.quadraticCurveTo(previous.x, previous.y, mid.x, mid.y);
    ctx.stroke();
    previous = point;
    previousMid = mid;
    hasContent = true;
  }

  function end() {
    drawing = false;
  }

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointerleave', end);

  return {
    isEmpty: () => !hasContent,
    clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasContent = false;
    },
    /** @returns {Promise<Uint8Array>} the drawing as PNG bytes, transparent background intact. */
    toPngBytes() {
      return new Promise((resolve, reject) => {
        canvas.toBlob(async (blob) => {
          if (!blob) {
            reject(new Error('Could not export the signature canvas as PNG'));
            return;
          }
          resolve(new Uint8Array(await blob.arrayBuffer()));
        }, 'image/png');
      });
    },
  };
}
