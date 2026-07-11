// @ts-check
/**
 * Transient status-toast primitive.
 *
 * A single shared `toastMsg` signal plus `showToast()` to set it and auto-clear
 * after a short delay. This is framework-level UI plumbing with no knowledge of
 * any subsystem, so it lives in `lib/` — the base `<cora-toast>` reads it, and
 * the question-bank store re-exports it for its own callers (`showToast` on
 * save, etc.).
 */

import { signal } from './signal.js';

export const toastMsg = signal('');

/**
 * Show `msg` in the toast, then clear it after 1800ms — unless another
 * `showToast()` replaced it in the meantime. No-ops gracefully in environments
 * without `setTimeout` (e.g. some test harnesses).
 *
 * @param {string} msg
 */
export function showToast(msg) {
  toastMsg.set(msg);
  const timer = /** @type {any} */ (globalThis).setTimeout;
  if (typeof timer === 'function') {
    timer(() => {
      if (toastMsg.get() === msg) toastMsg.set('');
    }, 1800);
  }
}
