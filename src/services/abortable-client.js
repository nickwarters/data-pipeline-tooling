// @ts-check
/**
 * Bind a mount lifetime to a `SharePointClient`'s **reads** (#545).
 *
 * `createStoreRoute` owns an `AbortController` per mount and exposes it as
 * `tools.signal`. A route effect binds it here once, in `start()`, and every
 * read it issues — including the per-Case-source fan-out in
 * `services/across-sources.js` (ADR-0022), which multiplies one page load into
 * one request per Case Type list — is cancelled when the user navigates away.
 * Binding at the client rather than threading a `signal` argument through every
 * fetcher keeps the fan-out helpers and page-level fetchers unchanged: they
 * receive a client, and it is already the right one.
 *
 * **Reads only, deliberately.** `patchCase` is forwarded untouched. A write
 * must survive navigation — that is the entire point of `SaveQueue`'s 1500 ms
 * debounce plus ETag concurrency (ADR-0008), and cancelling a queued Answer
 * save because the Reviewer moved on would be data loss. `SaveQueue` holds the
 * raw client from the app context and never sees this wrapper.
 *
 * The wrapper is a `Proxy` rather than a hand-written object so a method the
 * underlying client does not implement stays missing: pages probe with
 * `typeof client.countCases === 'function'`, and a wrapper that invented the
 * method would turn a capability probe into a crash.
 */

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */

/**
 * The reads that carry a per-call options bag, which is where the signal rides.
 * Every one takes `(subject, opts)`.
 */
const SIGNALLED_READS = new Set(['getCase', 'listCases', 'countCases']);

/**
 * @param {SharePointClient} client
 * @param {AbortSignal | undefined} signal
 * @returns {SharePointClient}
 */
export function withAbortSignal(client, signal) {
  // Total, on purpose. A call site is expected to guard its own client-less
  // mount, but `new Proxy(null, …)` throws synchronously, and inside a route
  // effect's `start()` that TypeError is the difference between an empty page
  // and a `cora-route-error`. Returning the client unchanged makes binding the
  // signal incapable of deciding whether the route survives (#545).
  if (!signal || !client) return client;
  return /** @type {SharePointClient} */ (
    new Proxy(client, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        if (typeof property !== 'string' || !SIGNALLED_READS.has(property)) {
          return value.bind(target);
        }
        return (
          /** @type {any} */ subject,
          /** @type {Record<string, unknown>} */ opts = {}
        ) => value.call(target, subject, { ...opts, signal });
      },
    })
  );
}
