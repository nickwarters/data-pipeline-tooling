// @ts-check
import { effect } from './signal.js';

// Resolved at module-evaluation time, so tests can stub globalThis.HTMLElement
// via a dynamic import() after setting the stub (see tests/cr-element.test.js).
const Base = /** @type {typeof HTMLElement} */ (/** @type {unknown} */ (globalThis.HTMLElement));

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
