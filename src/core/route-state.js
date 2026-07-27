// @ts-check

/**
 * Immutable route-state patch and replace helpers.
 *
 * These are plain functions a reducer may call — not middleware, not a
 * `createSlice`-style framework, and not a mutable/proxy draft. They exist so a
 * reducer branch reads as the one field it changes instead of the two-level
 * spread nest, and so forgetting a spread cannot silently drop sibling fields.
 *
 * `chrome` is a boot-owned shared reference (see `core/chrome-state.js`); every
 * helper spreads `state`, so it survives every write untouched.
 */

/**
 * Patch one route's slice of state, preserving `chrome`, sibling routes, and
 * every sibling field of the patched route.
 *
 * `patch` is a `Partial` of the named route's slice rather than a loose record,
 * so a misspelled field name is a `tsc` error — the one check the hand-written
 * spread nest did give us, and the reason this is a strict improvement on it
 * rather than a trade.
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
 * `slice` is the named route's slice type rather than a loose record, so a
 * sub-reducer returning the wrong shape is a `tsc` error — but only where the
 * calling reducer types its `state` param. Both call sites do; a reducer that
 * takes `any` infers `S` from `any` and gets no check at all.
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
 * `patch` is typed the same way as `patchRoute`'s, for the same reason: these
 * are the deepest writes in the reducer, so they are the ones most worth having
 * a misspelled field name fail at `tsc` rather than at runtime. `NonNullable`
 * strips the `snapshot: T | null` the slice declares — the null case is the
 * no-op above, so it never reaches the patch.
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
