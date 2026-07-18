// @ts-check

/** @template State @template Action
 * @typedef {(state: State, action: Action) => State} Reducer
 */

/**
 * Create the single state owner for a route. Updates are synchronous; rendering
 * is deferred and coalesced so any number of dispatches in a turn render once.
 *
 * @template State @template Action
 * @param {{
 *   initialState: State,
 *   reducer: Reducer<State, Action>,
 *   render: (state: State) => void,
 *   schedule?: (callback: () => void) => void,
 * }} options
 */
export function createStore({
  initialState,
  reducer,
  render,
  schedule = queueMicrotask,
}) {
  let state = initialState;
  let renderScheduled = false;
  let disposed = false;

  function scheduleRender() {
    if (renderScheduled || disposed) return;
    renderScheduled = true;
    schedule(() => {
      renderScheduled = false;
      if (!disposed) render(state);
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
      scheduleRender();
      return state;
    },

    render() {
      render(state);
    },

    dispose() {
      disposed = true;
    },
  };
}
