// @ts-check
/**
 * Abort is not a failure.
 *
 * A route effect's read is cancelled when the user navigates away (#545). The
 * request rejects, and that rejection must not travel any further than the
 * effect that issued it: it is the expected consequence of navigation, not an
 * error the Reviewer should see. Nothing here may render `cora-route-error`,
 * raise a toast, or dispatch a `load-failed` action.
 *
 * The check is by `name`, not `instanceof`: `AbortSignal.reason` is a
 * `DOMException` in the browser and in Node, `fetch` rejects with the same, and
 * a test double may throw a plain `Error` renamed to match. All three are the
 * same event.
 */

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isAbortError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    /** @type {{ name?: unknown }} */ (error).name === 'AbortError'
  );
}

/**
 * A rejection handler for a route effect: swallow an abort, rethrow everything
 * else. Rethrowing keeps a genuine failure exactly as loud as it was before the
 * abort path existed — this helper is a filter, not a catch-all.
 *
 * @param {unknown} error
 * @returns {void}
 */
export function ignoreAbortError(error) {
  if (!isAbortError(error)) throw error;
}
