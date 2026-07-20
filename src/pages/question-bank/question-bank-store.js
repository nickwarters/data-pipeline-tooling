// @ts-check
/**
 * Temporary BANK-1 adapter for the old question-card editors.
 *
 * Production state is owned by the question-bank route slice. This module only
 * projects that state through the signal-shaped interface the BANK-2 editors
 * still consume; it is removed with those mutation sinks in BANK-2.
 */
import { signal } from '../../lib/signal.js';
import { toastMsg as legacyToastMsg } from '../../lib/toast.js';
import {
  baselineBank as selectBaselineBank,
  currentBank as selectCurrentBank,
  diffCounts as selectDiffCounts,
  initialQuestionBankState,
  isDirty as selectIsDirty,
  questionBankReducer,
} from './bank-slice.js';

/** @typedef {import('./bank-slice.js').QuestionBankRouteState} QuestionBankRouteState */

let fallbackState = initialQuestionBankState();
/** @type {null | (() => QuestionBankRouteState)} */
let readBoundState = null;
/** @type {null | ((action: any) => any)} */
let dispatchBoundAction = null;
const revision = signal(0);

function read() {
  revision.get();
  return readBoundState?.() ?? fallbackState;
}

/** @param {any} action */
function dispatch(action) {
  if (dispatchBoundAction) dispatchBoundAction(action);
  else fallbackState = questionBankReducer(fallbackState, action);
  revision.set(revision.get() + 1);
}

/**
 * Bind the legacy editors to the currently rendered route-local store.
 * @param {() => QuestionBankRouteState} getState
 * @param {(action: any) => any} routeDispatch
 * @returns {() => void}
 */
export function bindQuestionBankStore(getState, routeDispatch) {
  readBoundState = getState;
  dispatchBoundAction = routeDispatch;
  return () => {
    if (readBoundState === getState) {
      readBoundState = null;
      dispatchBoundAction = null;
    }
  };
}

/** @template T @param {(state: QuestionBankRouteState) => T} get @param {(value: T) => void} [set] */
function facade(get, set) {
  return {
    get: () => get(read()),
    set(/** @type {T} */ value) {
      if (!set) throw new TypeError('Computed bank state is read-only');
      set(value);
    },
  };
}

export const cases = facade(
  (state) => state.cases,
  (value) =>
    dispatch({
      type: 'state/replaced',
      state: { ...read(), cases: value },
    })
);
export const baseline = facade(
  (state) => state.baseline,
  (value) =>
    dispatch({
      type: 'state/replaced',
      state: { ...read(), baseline: value },
    })
);
export const activeSlug = facade(
  (state) => state.activeSlug,
  (slug) => dispatch({ type: 'bank/selected', slug })
);
export const filters = facade(
  (state) => state.filters,
  (value) =>
    dispatch({
      type: 'state/replaced',
      state: { ...read(), filters: value },
    })
);
export const drawerOpen = facade(
  (state) => state.drawerOpen,
  (open) => dispatch({ type: 'drawer/changed', open })
);
export const railOpen = facade(
  (state) => state.railOpen,
  (open) => dispatch({ type: 'rail/changed', open })
);
export const sampleCases = facade(
  (state) => state.sampleCases,
  (value) =>
    dispatch({
      type: 'state/replaced',
      state: { ...read(), sampleCases: value },
    })
);
export const currentBank = facade(selectCurrentBank);
export const baselineBank = facade(selectBaselineBank);
export const isDirty = facade(selectIsDirty);
export const diffCounts = facade(selectDiffCounts);
export const toastMsg = facade(
  (state) => state.toastMsg,
  (message) => dispatch({ type: 'toast/changed', message })
);

/** @param {(types: QuestionBankRouteState['cases']) => void} mutator */
export function commit(mutator) {
  const doc = /** @type {any} */ (globalThis).document;
  const active = doc?.activeElement;
  const focusKey = active?.getAttribute?.('data-focus-key') ?? null;
  const selection =
    focusKey && active && 'selectionStart' in active
      ? [active.selectionStart, active.selectionEnd]
      : null;
  dispatch({ type: 'bank/legacy-committed', mutator });
  if (!focusKey || !doc) return;
  const escaped =
    /** @type {any} */ (globalThis).CSS?.escape?.(focusKey) ??
    focusKey.replace(
      /[^a-zA-Z0-9_-]/g,
      (/** @type {string} */ char) => `\\${char}`
    );
  const found = doc.querySelector(`[data-focus-key="${escaped}"]`);
  if (found && found !== doc.activeElement) {
    found.focus?.();
    if (selection && typeof found.setSelectionRange === 'function') {
      try {
        found.setSelectionRange(selection[0], selection[1]);
      } catch {
        // Selection is not supported by every focusable control.
      }
    }
  }
}

/** @param {Partial<QuestionBankRouteState['filters']>} patch */
export function setFilters(patch) {
  dispatch({ type: 'filters/changed', patch });
}

/** @param {string} slug @param {import('./question-bank-simulate.js').SampleCase[]} list */
export function setSampleCases(slug, list) {
  dispatch({ type: 'samples/loaded', slug, cases: list });
}

/** @param {string} message */
export function showToast(message) {
  dispatch({ type: 'toast/changed', message });
  legacyToastMsg.set(message);
  const later = /** @type {any} */ (globalThis).setTimeout;
  if (typeof later === 'function') {
    later(() => {
      if (toastMsg.get() === message)
        dispatch({ type: 'toast/changed', message: '' });
      if (legacyToastMsg.get() === message) legacyToastMsg.set('');
    }, 2400);
  }
}

/** Test-only compatibility until BANK-2 ports the remaining editor tests. */
export function _resetStore() {
  fallbackState = initialQuestionBankState();
  readBoundState = null;
  dispatchBoundAction = null;
  legacyToastMsg.set('');
  revision.set(revision.get() + 1);
}
