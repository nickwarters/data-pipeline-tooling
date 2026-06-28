// @ts-check
import { effect } from '../lib/signal.js';

// Legacy custom-element base. Keep it import-safe in non-browser tests; new
// feature code should use plain functions plus reactive() instead.
const Base = /** @type {typeof HTMLElement} */ (
  /** @type {unknown} */ (globalThis.HTMLElement ?? class {})
);

export class CRElement extends Base {
  constructor() {
    super();
    /** @type {Array<() => void>} */
    this._disposes = [];
  }

  /**
   * Subscribes to a signal, firing cb immediately and on every change.
   * The subscription is automatically disposed in disconnectedCallback.
   *
   * TODO(simplify-ui): Fold subscription cleanup into the reactive() lifecycle
   * helpers in src/lib/view.js so feature code can use local signals and
   * listeners without subclassing CRElement.
   *
   * @template T
   * @param {{ get: () => T }} sig
   * @param {(value: T) => void} cb
   */
  subscribe(sig, cb) {
    this._disposes.push(effect(() => cb(sig.get())));
  }

  disconnectedCallback() {
    for (const dispose of this._disposes) dispose();
    this._disposes = [];
  }
}
