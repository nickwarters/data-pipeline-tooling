// @ts-check
import { h } from '../lib/html.js';
import { EmptyState } from '../lib/empty-state.js';
import { createReportRouteSlice } from '../reports/report-engine.js';

/**
 * @param {Record<string, string>} params
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function createRouteSlice(params, context) {
  const plugin = (context.reportPlugins ?? []).find(
    (candidate) => candidate.id === params.report
  );
  if (plugin) return createReportRouteSlice(plugin, params, context);

  return {
    initialState: { chrome: context.chrome, routes: { report: {} } },
    reducer: (/** @type {any} */ state) => state,
    view: () =>
      h(
        'main',
        { className: 'cora-report-page' },
        h('h1', {}, 'Reports'),
        EmptyState('There is no such report.'),
        h('p', {}, h('a', { href: '#/reports' }, 'Back to Reports'))
      ),
  };
}
