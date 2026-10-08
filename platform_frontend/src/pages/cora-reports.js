// @ts-check
import { h } from '../lib/html.js';
import { EmptyState } from '../lib/empty-state.js';
import { scopesFor } from '../reports/report-access.js';

/** @typedef {import('../reports/contract.js').ReportPlugin} ReportPlugin */
/** @typedef {import('../core/chrome-state.js').ChromeState} ChromeState */

/**
 * @typedef {{ chrome: ChromeState, routes: { reports: { plugins: readonly ReportPlugin[] } } }} ReportsState
 */

/**
 * @param {ReportsState} state
 * @returns {HTMLElement}
 */
function reportsIndexView(state) {
  const capabilities = state.chrome.permissions;
  const cards = state.routes.reports.plugins
    .map((plugin) => ({ plugin, scopes: scopesFor(plugin, capabilities) }))
    .filter(({ scopes }) => scopes.length > 0);

  return h(
    'main',
    { className: 'cora-reports' },
    h('h1', {}, 'Reports'),
    cards.length === 0
      ? EmptyState('There are no reports for you yet.')
      : h(
          'ul',
          { className: 'cora-reports__list' },
          cards.map(({ plugin, scopes }) =>
            h(
              'li',
              { className: 'cora-reports__card', key: plugin.id },
              h('h2', { className: 'cora-reports__title' }, plugin.title),
              h(
                'p',
                { className: 'cora-reports__description' },
                plugin.description
              ),
              h(
                'ul',
                {
                  className: 'cora-reports__scopes',
                  'aria-label': `${plugin.title} scopes`,
                },
                scopes.map((scope) =>
                  h(
                    'li',
                    { key: scope.key },
                    h(
                      'a',
                      {
                        href: `#/reports/${plugin.id}/${encodeURIComponent(scope.key)}`,
                      },
                      scope.label
                    )
                  )
                )
              )
            )
          )
        )
  );
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function createRouteSlice(_params, context) {
  return {
    /** @type {ReportsState} */
    initialState: {
      chrome: context.chrome,
      routes: { reports: { plugins: context.reportPlugins ?? [] } },
    },
    reducer: (/** @type {ReportsState} */ state) => state,
    view: reportsIndexView,
  };
}
