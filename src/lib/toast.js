// @ts-check

/** @typedef {{ message: string }} ToastState */

/** @param {ToastState} [initialState] */
export function createToastStore(initialState = { message: '' }) {
  let state = initialState;
  /** @type {Set<(state: ToastState) => void>} */
  const listeners = new Set();
  return {
    getState: () => state,
    /** @param {{type: 'toast/show', message: string} | {type: 'toast/clear', message?: string}} action */
    dispatch(action) {
      if (action.type === 'toast/show') state = { message: action.message };
      if (
        action.type === 'toast/clear' &&
        (action.message === undefined || state.message === action.message)
      ) {
        state = { message: '' };
      }
      for (const listener of listeners) listener(state);
      return state;
    },
    /** @param {(state: ToastState) => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const toastStore = createToastStore();

/** @param {string} message */
export function showToast(message) {
  toastStore.dispatch({ type: 'toast/show', message });
  const timer = /** @type {any} */ (globalThis).setTimeout;
  if (typeof timer === 'function') {
    timer(() => toastStore.dispatch({ type: 'toast/clear', message }), 1800);
  }
}
