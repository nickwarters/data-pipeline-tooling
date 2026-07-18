// @ts-check
import { h } from '../lib/html.js';

/** @typedef {{ isReviewerManager: boolean }} ReportsIndexState */

/**
 * Pure Reports index view. Report data is loaded by each report route; the
 * index only needs the capabilities already resolved into AppContext.
 *
 * @param {ReportsIndexState} state
 * @returns {HTMLElement}
 */
export function reportsIndexView(state) {
  if (state.isReviewerManager) {
    return h(
      'div',
      { className: 'cora-report-card' },
      h('h2', {}, 'Reviewer Team Performance'),
      h('a', { href: '#/reports/reviewer-team' }, 'View report')
    );
  }

  return h('p', {}, "You don't have access to any reports");
}

/**
 * Create the route-local state slice consumed by the standard store adapter.
 * This index is read-only, so it has no transition actions or effects; nested
 * report routes continue to own their SharePoint data loading.
 *
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @returns {{
 *   initialState: ReportsIndexState,
 *   reducer: (state: ReportsIndexState, action: unknown) => ReportsIndexState,
 *   view: (state: ReportsIndexState) => HTMLElement,
 * }}
 */
export function createRouteSlice(_params, context) {
  return {
    initialState: {
      isReviewerManager: context.capabilities.isReviewerManager,
    },
    reducer: (state) => state,
    view: reportsIndexView,
  };
}
