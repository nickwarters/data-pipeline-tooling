// @ts-check

/**
 * @typedef {'simple'|'input'|'options'} PaletteActionKind
 * @typedef {Object} PaletteAction
 * @property {string} id
 * @property {string} label
 * @property {string[]} keywords
 * @property {PaletteActionKind} [kind]
 * @property {{ placeholder?: string }} [input]
 * @property {Array<{ label: string, value: string }>} [options]
 * @property {(value?: string) => void} handler
 *
 * @typedef {Object} CommandPaletteState
 * @property {PaletteAction[]} actions
 * @property {boolean} isOpen
 * @property {string} query
 * @property {number} selectedIndex
 * @property {'idle'|'awaiting-input'|'awaiting-option'} mode
 * @property {PaletteAction|null} pendingAction
 * @property {number} optionIndex
 */

/** @returns {CommandPaletteState} */
export function createCommandPaletteState() {
  return {
    actions: [],
    isOpen: false,
    query: '',
    selectedIndex: -1,
    mode: 'idle',
    pendingAction: null,
    optionIndex: -1,
  };
}

/** @param {string} q @param {PaletteAction[]} list @returns {PaletteAction[]} */
export function filterActions(q, list) {
  if (!q) return list;
  const lower = q.toLowerCase();
  return list.filter(
    (action) =>
      action.label.toLowerCase().includes(lower) ||
      action.keywords.some((keyword) => keyword.toLowerCase().includes(lower))
  );
}

/** @param {CommandPaletteState} state @returns {CommandPaletteState} */
function resetInteraction(state) {
  return {
    ...state,
    isOpen: false,
    query: '',
    selectedIndex: -1,
    mode: 'idle',
    pendingAction: null,
    optionIndex: -1,
  };
}

/**
 * @param {CommandPaletteState} state
 * @param {{ type: string, [key: string]: any }} action
 * @returns {CommandPaletteState}
 */
function commandPaletteReducer(state, action) {
  if (action.type === 'palette/register') {
    const index = state.actions.findIndex(
      (item) => item.id === action.action.id
    );
    const actions = [...state.actions];
    if (index >= 0) actions[index] = action.action;
    else actions.push(action.action);
    return { ...state, actions };
  }
  if (action.type === 'palette/deregister') {
    return {
      ...state,
      actions: state.actions.filter((item) => item.id !== action.id),
    };
  }
  if (action.type === 'palette/open') return { ...state, isOpen: true };
  if (action.type === 'palette/close') return resetInteraction(state);
  if (action.type === 'palette/query') {
    return { ...state, query: action.query, selectedIndex: -1 };
  }
  if (action.type === 'palette/select') {
    return { ...state, selectedIndex: action.index };
  }
  if (action.type === 'palette/select-option') {
    return { ...state, optionIndex: action.index };
  }
  if (action.type === 'palette/await-input') {
    return { ...state, mode: 'awaiting-input', pendingAction: action.action };
  }
  if (action.type === 'palette/await-option') {
    return {
      ...state,
      mode: 'awaiting-option',
      pendingAction: action.action,
      optionIndex: -1,
    };
  }
  return state;
}

/** @param {CommandPaletteState} [initialState] */
export function createCommandPaletteStore(
  initialState = createCommandPaletteState()
) {
  let state = initialState;
  /** @type {Set<(state: CommandPaletteState) => void>} */
  const listeners = new Set();
  return {
    getState: () => state,
    /** @param {{ type: string, [key: string]: any }} action */
    dispatch(action) {
      state = commandPaletteReducer(state, action);
      for (const listener of listeners) listener(state);
      return state;
    },
    /** @param {(state: CommandPaletteState) => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const commandPaletteStore = createCommandPaletteStore();

/** @param {PaletteAction} action */
export function register(action) {
  commandPaletteStore.dispatch({ type: 'palette/register', action });
}
/** @param {string} id */
export function deregister(id) {
  commandPaletteStore.dispatch({ type: 'palette/deregister', id });
}
