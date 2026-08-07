// @ts-check

/** @template State @template Action
 * @typedef {(state: State, action: Action) => State} Reducer
 */

/**
 * Create the single state owner for a route. Updates are synchronous;
 * notification is deferred and coalesced so any number of dispatches in a turn
 * notify once.
 *
 * The store owns state and scheduling and knows nothing about the DOM, which is
 * why its callback is `onStateChange` rather than `render`: "render"
 * is reserved for committing a view into a container, and this callback is free
 * to do something else entirely.
 *
 * @template State @template Action
 * @param {{
 *   initialState: State,
 *   reducer: Reducer<State, Action>,
 *   onStateChange: (state: State) => void,
 *   schedule?: (callback: () => void) => void,
 * }} options
 */
export function createStore({
  initialState,
  reducer,
  onStateChange,
  schedule = queueMicrotask,
}) {
  let state = initialState;
  let notifyScheduled = false;
  let disposed = false;

  function scheduleNotify() {
    if (notifyScheduled || disposed) return;
    notifyScheduled = true;
    schedule(() => {
      notifyScheduled = false;
      if (!disposed) onStateChange(state);
    });
  }

  return {
    /** @returns {State} */
    getState() {
      return state;
    },

    /** @param {Action} action @returns {State} */
    dispatch(action) {
      state = reducer(state, action);
      scheduleNotify();
      return state;
    },

    /**
     * Notify synchronously, now, bypassing the coalescing schedule — the shape
     * the initial mount needs, where the first paint must land before `start()`
     * runs its effects.
     */
    flush() {
      onStateChange(state);
    },

    dispose() {
      disposed = true;
    },
  };
}
