// @ts-check

/**
 * Create a memo function owned by one view. Dependencies are compared by
 * position with Object.is, matching the immutable-state contract used by the
 * store. The returned vnode is therefore the exact object produced on the
 * previous render when none of its inputs changed.
 *
 * Call `clear()` from the owning view's unmount hook. Keeping ownership local
 * prevents keys from colliding between routes and releases detached subtrees
 * (including their event handlers) as soon as that view goes away.
 *
 * @template VNode
 * @returns {((key: PropertyKey, deps: readonly unknown[], renderFn: () => VNode) => VNode) & {
 *   clear: () => void,
 *   delete: (key: PropertyKey) => boolean,
 *   readonly size: number,
 * }}
 */
export function createMemo() {
  /** @type {Map<PropertyKey, { deps: readonly unknown[], value: VNode }>} */
  const cache = new Map();

  /** @type {ReturnType<typeof createMemo<VNode>>} */
  const memo = /** @type {any} */ (
    /**
     * @param {PropertyKey} key
     * @param {readonly unknown[]} deps
     * @param {() => VNode} renderFn
     */
    (key, deps, renderFn) => {
      const entry = cache.get(key);
      if (
        entry &&
        entry.deps.length === deps.length &&
        deps.every((dep, index) => Object.is(dep, entry.deps[index]))
      ) {
        return entry.value;
      }

      const value = renderFn();
      cache.set(key, { deps: Array.from(deps), value });
      return value;
    }
  );

  memo.clear = () => cache.clear();
  memo.delete = (key) => cache.delete(key);
  Object.defineProperty(memo, 'size', { get: () => cache.size });
  return memo;
}
