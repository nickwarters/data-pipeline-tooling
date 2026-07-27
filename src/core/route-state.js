// @ts-check

/**
 * Immutable route-state patch and replace helpers: plain functions a reducer may
 * call, so a branch reads as the one field it changes rather than a two-level
 * spread nest, and a forgotten spread cannot silently drop sibling fields.
 *
 * `chrome` is a boot-owned shared reference (see `core/chrome-state.js`); every
 * helper spreads `state`, so it survives every write untouched.
 */

/**
 * Patch one route's slice of state, preserving `chrome`, sibling routes, and
 * every sibling field of the patched route.
 *
 * `patch` is a `Partial` of the named route's slice rather than a loose record,
 * so a misspelled field name is a `tsc` error.
 *
 * @template {{ routes: Record<string, any> }} S
 * @template {keyof S['routes'] & string} N
 * @param {S} state
 * @param {N} name - the route key, e.g. 'dashboard'
 * @param {Partial<S['routes'][N]>} patch
 * @returns {S}
 */
export function patchRoute(state, name, patch) {
  return {
    ...state,
    routes: { ...state.routes, [name]: { ...state.routes[name], ...patch } },
  };
}

/**
 * Replace one route's slice wholesale, preserving `chrome` and sibling routes.
 *
 * Unlike `patchRoute`, the previous slice is discarded rather than spread
 * underneath, so a key the sub-reducer dropped stays dropped. Use this — and
 * only this — where a sub-reducer returns the complete next slice; running that
 * through `patchRoute` would silently resurrect deleted keys.
 *
 * `slice` is the named route's slice type, so a sub-reducer returning the wrong
 * shape is a `tsc` error — but only where the calling reducer types its `state`
 * param; one taking `any` infers `S` from `any` and gets no check.
 *
 * @template {{ routes: Record<string, any> }} S
 * @template {keyof S['routes'] & string} N
 * @param {S} state
 * @param {N} name - the route key, e.g. 'questionBank'
 * @param {S['routes'][N]} slice
 * @returns {S}
 */
export function setRoute(state, name, slice) {
  return { ...state, routes: { ...state.routes, [name]: slice } };
}

/**
 * Patch the Case Review snapshot. No-ops — returning the same state reference —
 * when no snapshot is loaded, which is what every call site's
 * `&& route.snapshot` guard expresses.
 *
 * `NonNullable` strips the `snapshot: T | null` the slice declares — the null
 * case is the no-op above, so it never reaches the patch.
 *
 * @template {{ routes: { caseReview: { snapshot: any } } }} S
 * @param {S} state
 * @param {Partial<NonNullable<S['routes']['caseReview']['snapshot']>>} patch
 * @returns {S}
 */
export function patchSnapshot(state, patch) {
  const route = state.routes.caseReview;
  if (!route.snapshot) return state;
  return patchRoute(state, 'caseReview', {
    snapshot: { ...route.snapshot, ...patch },
  });
}
