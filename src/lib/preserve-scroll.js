// @ts-check
// Shared scroll-preservation helper for synchronous signal-driven re-renders
// that tear down and rebuild DOM above (or at) the viewport. Extracted from
// CaseReviewViewModel._withPreservedScroll so any framework-managed rebuild —
// not only the Issues answer-capture path — can hold the page scroll steady
// across the resulting DOM churn.

/**
 * The element that actually scrolls the app, or `window` where it does not, or
 * `null` outside a browser. The app root (`#app[data-cora-root]`) owns the
 * vertical scroll; only the styleguide/tests let the window scroll.
 *
 * @returns {Element | (Window & typeof globalThis) | null}
 */
export function scrollContainer() {
  if (typeof document !== 'undefined' && document.querySelector) {
    const root = document.querySelector('#app[data-cora-root]');
    if (root) return root;
  }
  return typeof window !== 'undefined' ? window : null;
}

/**
 * Reads the scroll offset of a container, spanning both the window
 * (`scrollX`/`scrollY`) and element (`scrollLeft`/`scrollTop`) shapes. An
 * element exposes `scrollTop`; the window exposes `scrollY` instead.
 *
 * @param {Element | (Window & typeof globalThis)} target
 * @returns {{ left: number, top: number }}
 */
export function readScroll(target) {
  if ('scrollTop' in target) {
    return { left: target.scrollLeft, top: target.scrollTop };
  }
  return { left: target.scrollX, top: target.scrollY };
}

/**
 * Restores a scroll offset onto a container, spanning both container shapes.
 *
 * @param {Element | (Window & typeof globalThis)} target
 * @param {number} left
 * @param {number} top
 */
export function writeScroll(target, left, top) {
  if ('scrollTop' in target) {
    target.scrollLeft = left;
    target.scrollTop = top;
    return;
  }
  target.scrollTo(left, top);
}

/**
 * Runs `mutate` (a synchronous signal update that triggers a re-render) while
 * holding the scroll position steady across the resulting DOM churn.
 *
 * A synchronous re-render can tear down and rebuild DOM above the viewport —
 * or the very control the Reviewer is interacting with — which both breaks
 * the browser's native scroll anchoring and provokes a focus-restore
 * `.focus()` that scrolls the refocused control into view. Snapshotting and
 * restoring the scroll around the whole synchronous re-render undoes both, so
 * the page ends up exactly where it started.
 *
 * The scroll lives on the app root (`#app[data-cora-root]` is `position:
 * fixed` with its own `overflow-y: auto`), not the window — so we restore
 * that container, falling back to the window where the app is not the scroll
 * root (styleguide, tests). No-op outside a browser.
 *
 * @param {() => void} mutate
 */
export function withPreservedScroll(mutate) {
  const target = scrollContainer();
  if (!target) {
    mutate();
    return;
  }
  const { left, top } = readScroll(target);
  mutate();
  const after = readScroll(target);
  if (after.left !== left || after.top !== top) writeScroll(target, left, top);
}
