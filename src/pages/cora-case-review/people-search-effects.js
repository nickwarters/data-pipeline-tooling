/**
 * Debounced people search: the plumbing both people pickers on the Case Review
 * page share — the per-key debounce timer, the trim-and-skip guard, and the
 * mount-lifetime check at resolution.
 *
 * It knows nothing about actions. Dispatching stays in the page, where the
 * action vocabulary is greppable next to the reducer that reads it.
 */

/**
 * @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient
 * @typedef {import('../../sharepoint-client.js').PersonResult} PersonResult
 */

/** Long enough that a typist does not fire a request per keystroke. */
const DELAY_MS = 200;

/**
 * Create a debounced people search.
 *
 * Keys separate independent search boxes. A page-level field has only one box,
 * so it can pass a single constant key and hold one entry.
 *
 * @param {{
 *   client: SharePointClient | null | undefined,
 *   isActive: () => boolean,
 *   onResults: (key: string, query: string, people: PersonResult[]) => void,
 * }} options
 * @returns {{
 *   request: (key: string, query: string) => void,
 *   clear: (key: string) => void,
 *   dispose: () => void,
 * }}
 */
export function createDebouncedPeopleSearch({ client, isActive, onResults }) {
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const timers = new Map();

  /** @param {string} key */
  function clear(key) {
    const timer = timers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(key);
  }

  return {
    /**
     * @param {string} key
     * @param {string} query
     */
    request(key, query) {
      clear(key);
      const trimmed = query.trim();
      if (!trimmed || !client) return;
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          void client.searchPeople(trimmed).then((people) => {
            // The mount lifetime is the only thing checked here. Whether this
            // result is still the one being waited for is the reducer's own
            // guard: it drops a result whose query is not the query in state,
            // so a pending-query latch alongside it would only restate that
            // condition.
            // Reported untrimmed, because that is the query the caller put in state.
            if (isActive()) onResults(key, query, people);
          });
        }, DELAY_MS)
      );
    },
    clear,
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
