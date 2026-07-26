// @ts-check

/**
 * Immutable route-state patch helpers.
 *
 * These are plain functions a reducer may call — not middleware, not a
 * `createSlice`-style framework, and not a mutable/proxy draft. They exist so a
 * reducer branch reads as the one field it changes instead of the two-level
 * spread nest, and so forgetting a spread cannot silently drop sibling fields.
 *
 * `chrome` is a boot-owned shared reference (see `core/chrome-state.js`); both
 * helpers spread `state`, so it survives every patch untouched.
 */

/**
 * Patch one route's slice of state, preserving `chrome`, sibling routes, and
 * every sibling field of the patched route.
 *
 * @template {{ routes: Record<string, any> }} S
 * @param {S} state
 * @param {string} name - the route key, e.g. 'dashboard'
 * @param {Record<string, any>} patch
 * @returns {S}
 */
export function patchRoute(state, name, patch) {
  return {
    ...state,
    routes: { ...state.routes, [name]: { ...state.routes[name], ...patch } },
  };
}

/**
 * Patch the Case Review snapshot. No-ops — returning the same state reference —
 * when no snapshot is loaded, which is what every call site's
 * `&& route.snapshot` guard expresses.
 *
 * @template {{ routes: { caseReview: { snapshot: any } } }} S
 * @param {S} state
 * @param {Record<string, any>} patch
 * @returns {S}
 */
export function patchSnapshot(state, patch) {
  const route = state.routes.caseReview;
  if (!route.snapshot) return state;
  return patchRoute(state, 'caseReview', {
    snapshot: { ...route.snapshot, ...patch },
  });
}
