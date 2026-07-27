// @ts-check
/**
 * Abort is not a failure.
 *
 * A route effect's read is cancelled when the user navigates away. That
 * rejection must not travel further than the effect that issued it: it is the
 * expected consequence of navigation, so it never renders `cora-route-error`,
 * raises a toast, or dispatches a `load-failed` action.
 *
 * The check is by `name`, not `instanceof`, because the same event arrives as a
 * `DOMException` from the browser and from Node's `fetch`, and as a renamed
 * plain `Error` from a test double.
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
 * else. A filter, not a catch-all — a genuine failure stays as loud as it was.
 *
 * @param {unknown} error
 * @returns {void}
 */
export function ignoreAbortError(error) {
  if (!isAbortError(error)) throw error;
}
