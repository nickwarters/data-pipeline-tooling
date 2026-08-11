/**
 * Debounced people search: the plumbing every people picker shares — the
 * per-key debounce timer, the trim-and-skip guard, and the mount-lifetime check
 * at resolution.
 *
 * It carries no domain knowledge, and more than one page now wires a picker
 * with it, so it belongs beside the other framework primitives rather than
 * inside any one page's subsystem.
 *
 * Every search state is reported through one callback — loading when the
 * debounced request starts, resolved, failed, or nothing to search for —
 * because a picker that is told only about successes cannot tell an empty
 * directory from a search that never ran. What each of those looks like on
 * screen is the page's decision, not this module's.
 *
 * It knows nothing about actions. Dispatching stays in the page, where the
 * action vocabulary is greppable next to the reducer that reads it.
 */

/**
 * @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient
 * @typedef {import('../sharepoint-client.js').PersonResult} PersonResult
 */

/**
 * @typedef {'idle' | 'loading' | 'success' | 'error'} PeopleSearchStatus
 */

/**
 * The state of one people picker's search box: the query it was given, the
 * people that came back, and how far the search got. Every picker holds this
 * shape, so a reducer and a view agree on it without restating it.
 *
 * @typedef {object} PeopleSearchState
 * @property {string} query
 * @property {PersonResult[]} people
 * @property {PeopleSearchStatus} status
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
 *   onState: (key: string, state: PeopleSearchState) => void,
 * }} options
 * @returns {{
 *   request: (key: string, query: string) => void,
 *   clear: (key: string) => void,
 *   dispose: () => void,
 * }}
 */
export function createDebouncedPeopleSearch({ client, isActive, onState }) {
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
      // Reported untrimmed throughout, because that is the query the caller put
      // in state.
      if (!trimmed) {
        onState(key, { query, people: [], status: 'idle' });
        return;
      }
      if (!client) {
        // A picker that can never search says so, rather than sitting silently
        // in `idle` while the Reviewer waits for matches that cannot come.
        onState(key, { query, people: [], status: 'error' });
        return;
      }
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          // The mount lifetime is the only thing checked here; whether the
          // outcome is still wanted is the reducer's guard, which drops one
          // whose query is not the query in state. That compares text, not
          // requests, so two in flight for the same text are indistinguishable
          // and a late one can restate the status for a query still current.
          // The next keystroke corrects it, which is cheaper than the request
          // token it would take to tell them apart.
          onState(key, { query, people: [], status: 'loading' });
          void client.searchPeople(trimmed).then(
            (people) => {
              if (isActive())
                onState(key, { query, people, status: 'success' });
            },
            () => {
              if (isActive())
                onState(key, { query, people: [], status: 'error' });
            }
          );
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
