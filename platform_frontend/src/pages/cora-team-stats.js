// @ts-check
import { h } from '../lib/html.js';
import { EmptyState, NO_DATA_YET } from '../lib/empty-state.js';

export const COPY = Object.freeze({ noDataYet: NO_DATA_YET });

/** @typedef {import('../core/chrome-state.js').ChromeState} ChromeState */

/**
 * @typedef {Object} TeamStatsState
 * @property {ChromeState} chrome
 * @property {{ teamStats: Record<string, never> }} routes
 */

/**
 * @param {TeamStatsState} _state
 * @returns {HTMLElement}
 */
export function teamStatsView(_state) {
  return h(
    'main',
    { className: 'cora-team-stats' },
    h('h1', {}, 'Team Stats'),
    EmptyState(COPY.noDataYet, { className: 'cora-team-stats-empty' })
  );
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @returns {{
 *   initialState: TeamStatsState,
 *   reducer: (state: TeamStatsState, action: unknown) => TeamStatsState,
 *   view: (state: TeamStatsState) => HTMLElement,
 * }}
 */
export function createRouteSlice(_params, context) {
  return {
    initialState: {
      chrome: context.chrome,
      routes: { teamStats: {} },
    },
    reducer: (state) => state,
    view: teamStatsView,
  };
}
