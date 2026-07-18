// @ts-check
// Dev-only harness for the morph() reconciler (CORE-2 vertical slice). It mounts
// a scratch pure view and re-renders it via morph() on every keystroke, so the
// node-preserving behaviour — focus, caret, and uncommitted input value
// surviving a re-render while the list around them reorders — is demoable in a
// real browser, not only in `node --test`. Reachable at #/dev/morph under
// dev/?mock=1 (see src/routes/dev-morph.js); it ships nowhere else.
//
import { h } from '../lib/html.js';

/** @typedef {{ key: string, label: string }} Item */

const ITEMS = /** @type {Item[]} */ ([
  { key: 'alpha', label: 'Alpha' },
  { key: 'bravo', label: 'Bravo' },
  { key: 'charlie', label: 'Charlie' },
  { key: 'delta', label: 'Delta' },
  { key: 'echo', label: 'Echo' },
  { key: 'foxtrot', label: 'Foxtrot' },
  { key: 'golf', label: 'Golf' },
  { key: 'hotel', label: 'Hotel' },
]);

/**
 * The items that match a query, best (shortest, i.e. closest) matches first, so
 * every keystroke reorders *and* filters the keyed list — the hard case for
 * preserving the focused input.
 * @param {Item[]} items
 * @param {string} query
 * @returns {Item[]}
 */
export function visibleItems(items, query) {
  const q = query.trim().toLowerCase();
  if (q === '') return items;
  return items
    .filter((it) => it.label.toLowerCase().includes(q))
    .sort(
      (a, b) => a.label.length - b.label.length || a.key.localeCompare(b.key)
    );
}

/**
 * Pure view: state in, h() tree out. No side effects, no lifecycle.
 * @param {{ query: string }} state
 * @param {(next: string) => void} onQuery
 * @returns {HTMLElement}
 */
export function harnessView(state, onQuery) {
  const shown = visibleItems(ITEMS, state.query);
  return h(
    'section',
    { class: 'cora-morph-harness' },
    h('h1', {}, 'morph() dev harness'),
    h(
      'p',
      { class: 'cora-morph-harness__hint' },
      'Type to filter and reorder the list. The input keeps focus, caret, and ' +
        'its value across every re-render — no snapshot/restore.'
    ),
    h('input', {
      key: 'query',
      class: 'cora-morph-harness__input',
      type: 'text',
      placeholder: 'Filter…',
      value: state.query,
      oninput: (/** @type {any} */ e) => onQuery(e.target.value),
    }),
    h(
      'p',
      { class: 'cora-morph-harness__count' },
      `${shown.length} of ${ITEMS.length} shown`
    ),
    h(
      'ul',
      { class: 'cora-morph-harness__list' },
      ...shown.map((it) =>
        h('li', { key: it.key, class: 'cora-morph-harness__item' }, it.label)
      )
    )
  );
}

/**
 * New-style route module contract: create route-local state and a pure view.
 * The standard store-route adapter owns rendering and teardown.
 * @returns {{
 *   initialState: { query: string },
 *   reducer: (state: { query: string }, action: any) => { query: string },
 *   view: (state: { query: string }, tools: { dispatch: (action: any) => any }) => HTMLElement,
 * }}
 */
export function createRouteSlice() {
  return {
    initialState: { query: '' },
    reducer: (state, action) =>
      action.type === 'query/changed'
        ? { ...state, query: action.query }
        : state,
    view: (state, { dispatch }) =>
      harnessView(state, (query) => dispatch({ type: 'query/changed', query })),
  };
}
