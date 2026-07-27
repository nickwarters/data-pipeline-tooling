// @ts-check
/**
 * Bind a mount lifetime to a `SharePointClient`'s **reads**.
 *
 * `createStoreRoute` owns an `AbortController` per mount and exposes it as
 * `tools.signal`. A route effect binds it here once, in `start()`, so every read
 * it issues — including the per-Case-source fan-out in
 * `services/across-sources.js` (ADR-0022) — is cancelled on navigation. Binding
 * at the client rather than threading a `signal` through every fetcher leaves
 * the fan-out and page-level fetchers unchanged.
 *
 * **Reads only, deliberately.** `patchCase` is forwarded untouched: a write must
 * survive navigation (ADR-0008), and cancelling a queued Answer save would be
 * data loss. `SaveQueue` holds the raw client and never sees this wrapper.
 *
 * The wrapper is a `Proxy` so a method the underlying client does not implement
 * stays missing — pages probe with `typeof client.countCases === 'function'`,
 * and an invented method would turn a capability probe into a crash.
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
  // Total, on purpose: `new Proxy(null, …)` throws synchronously, and inside a
  // route effect's `start()` that TypeError is the difference between an empty
  // page and a `cora-route-error`.
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
