// @ts-check
import { h } from '../lib/html.js';
import { EmptyState } from '../lib/empty-state.js';

/** @typedef {import('../core/chrome-state.js').ChromeState} ChromeState */

/**
 * @typedef {Object} MyStatsState
 * @property {ChromeState} chrome
 * @property {{ myStats: Record<string, never> }} routes
 */

/**
 * @param {MyStatsState} _state
 * @returns {HTMLElement}
 */
export function myStatsView(_state) {
  return h(
    'main',
    { className: 'cora-my-stats' },
    h('h1', {}, 'My Stats'),
    EmptyState('No data yet.', { className: 'cora-my-stats-empty' })
  );
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @returns {{
 *   initialState: MyStatsState,
 *   reducer: (state: MyStatsState, action: unknown) => MyStatsState,
 *   view: (state: MyStatsState) => HTMLElement,
 * }}
 */
export function createRouteSlice(_params, context) {
  return {
    initialState: {
      chrome: context.chrome,
      routes: { myStats: {} },
    },
    reducer: (state) => state,
    view: myStatsView,
  };
}
