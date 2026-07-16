// @ts-check

/**
 * @typedef {HTMLElement & { whenIdle: () => Promise<void> }} AsyncHost
 */

/**
 * Give an asynchronously-loaded view an explicit completion contract.
 *
 * The returned tracker owns promises started by the view. `whenIdle()` waits
 * for the current work and any follow-on work it starts, so callers do not
 * need to guess how many event-loop turns a fetch/render chain will take.
 *
 * @param {HTMLElement} host
 * @returns {<T>(task: Promise<T>) => Promise<T>}
 */
export function trackAsyncTasks(host) {
  /** @type {Set<Promise<unknown>>} */
  const pending = new Set();

  /** @type {AsyncHost} */ (host).whenIdle = async () => {
    while (pending.size > 0) {
      await Promise.all([...pending]);
    }
  };

  return function track(task) {
    const tracked = task.finally(() => pending.delete(tracked));
    pending.add(tracked);
    return tracked;
  };
}
