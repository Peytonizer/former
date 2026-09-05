/**
 * mapUpsertPolyfill.js — installs `Map`/`WeakMap.prototype.getOrInsertComputed` (and its sibling
 * `getOrInsert`) when the running engine doesn't have them yet.
 *
 * pdfjs-dist 6.x calls `getOrInsertComputed` directly, with no fallback, from both its
 * main-thread bundle and its worker script — see render.js and pdfWorkerEntry.js, which each
 * import this before pdfjs-dist itself, once per JS realm (the worker is a separate one and
 * needs its own copy). Safari has shipped the plain `getOrInsert` from the same TC39 "Upsert"
 * proposal but not yet `getOrInsertComputed`, which is the one pdf.js actually calls — without
 * this, opening any PDF throws "this.#t.getOrInsertComputed is not a function" with nothing
 * else to explain it (see main.js's openFile, which is what actually surfaces such an error to
 * the user rather than letting it strand the UI silently).
 *
 * Semantics match the proposal exactly (MDN, Map.prototype.getOrInsertComputed): return the
 * existing value for `key` if present, otherwise compute one, store it, and return it.
 */
function installUpsertPolyfill(Ctor) {
  if (!Ctor.prototype.getOrInsertComputed) {
    Ctor.prototype.getOrInsertComputed = function (key, callbackFunction) {
      if (!this.has(key)) this.set(key, callbackFunction(key));
      return this.get(key);
    };
  }
  if (!Ctor.prototype.getOrInsert) {
    Ctor.prototype.getOrInsert = function (key, defaultValue) {
      if (!this.has(key)) this.set(key, defaultValue);
      return this.get(key);
    };
  }
}

installUpsertPolyfill(Map);
installUpsertPolyfill(WeakMap);
