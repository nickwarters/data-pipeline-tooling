// @ts-check
import { h } from '../lib/html.js';
import { EmptyState, LoadingState } from '../lib/empty-state.js';
import { isAbortError } from '../lib/abort.js';
import { patchRoute } from '../core/route-state.js';
import { addWorkingDays } from '../lib/add-working-days.js';
import { isDateKey, toLocalDateKey } from '../lib/local-calendar.js';
import { formatWeekdayDate } from '../lib/format-datetime.js';
import { ENGLAND_WALES_HOLIDAYS } from '../config/working-days.js';
import { mountGroupedBarChartTooltip } from '../lib/chart-tooltip.js';
import { nextTableSort } from '../views/data-table.js';
import { loadReportFile } from '../services/report-feed-loader.js';
import { ReportFrame } from '../components/report/report-frame.js';
import { allScopes, scopesFor } from './report-access.js';

/** @typedef {import('./contract.js').ReportPlugin} ReportPlugin */
/** @typedef {import('./contract.js').ReportScope} ReportScope */
/** @typedef {import('./contract.js').ReportEnvelope} ReportEnvelope */
/** @typedef {import('../views/data-table.js').TableSort} TableSort */
/** @typedef {import('../core/chrome-state.js').ChromeState} ChromeState */
/** @typedef {import('../setup/register-routes.js').AppContext} AppContext */
/** @typedef {import('../services/report-feed-loader.js').ReportFileResult} ReportFileResult */

/** @typedef {{ status: 'loading' | 'loaded' | 'missing' | 'forbidden' | 'failed', envelope: ReportEnvelope | null }} FeedState */

/**
 * @typedef {Object} ReportRouteState
 * @property {string | null} scopeKey
 * @property {'denied' | 'unknown-scope' | null} problem
 * @property {Record<string, FeedState>} feeds
 * @property {Record<string, string>} filters
 * @property {string[]} tables
 * @property {Record<string, TableSort>} sorts
 * @property {number} width
 */

/** @typedef {{ chrome: ChromeState, routes: { report: ReportRouteState } }} ReportState */

/**
 * @typedef {{ type: 'report/feed-settled', name: string, result: ReportFileResult }
 *   | { type: 'report/feed-failed', name: string }
 *   | { type: 'report/filter-selected', name: string, value: string }
 *   | { type: 'report/table-toggled', panel: string }
 *   | { type: 'report/table-sort-requested', panel: string, key: string }
 *   | { type: 'report/resized', width: number }} ReportAction
 */

const DEFAULT_WIDTH = 1100;
const RESIZE_THRESHOLD = 8;
const DEFAULT_STALE_AFTER_WORKING_DAYS = 2;

/**
 * @param {ReportPlugin} plugin
 * @param {ReportScope[]} scopes
 * @param {string | undefined} requested
 * @returns {{ scope: ReportScope | null, problem: 'denied' | 'unknown-scope' | null }}
 */
function resolveScope(plugin, scopes, requested) {
  if (!requested) {
    return scopes.length > 0
      ? { scope: scopes[0], problem: null }
      : { scope: null, problem: 'denied' };
  }
  const allowed = scopes.find((scope) => scope.key === requested);
  if (allowed) return { scope: allowed, problem: null };
  const exists = allScopes(plugin).some((scope) => scope.key === requested);
  return { scope: null, problem: exists ? 'denied' : 'unknown-scope' };
}

/**
 * @param {ReportEnvelope | null} envelope
 * @param {string} today
 * @param {number} allowance working days
 * @returns {string | null}
 */
function staleBanner(envelope, today, allowance) {
  const through = envelope?.complete_through;
  if (typeof through !== 'string' || !isDateKey(through)) return null;
  const expectedBy = addWorkingDays(
    through,
    allowance + 1,
    ENGLAND_WALES_HOLIDAYS
  );
  if (today <= expectedBy) return null;
  return `These figures only run to ${formatWeekdayDate(through)}. The report has not been refreshed since, so more recent days are missing.`;
}

/**
 * @param {ReportPlugin} plugin
 * @param {ReportState} state
 * @param {(action: ReportAction) => void} dispatch
 * @param {{ scopes: ReportScope[], today: string }} env
 * @returns {HTMLElement}
 */
function reportView(plugin, state, dispatch, env) {
  const route = state.routes.report;
  const feeds = Object.values(route.feeds);
  const loading = feeds.some((feed) => feed.status === 'loading');

  return h(
    'main',
    { className: 'cora-report-page', 'aria-busy': String(loading) },
    bodyView(plugin, state, dispatch, env, loading)
  );
}

/**
 * @param {ReportPlugin} plugin
 * @param {ReportState} state
 * @param {(action: ReportAction) => void} dispatch
 * @param {{ scopes: ReportScope[], today: string }} env
 * @param {boolean} loading
 * @returns {Node}
 */
function bodyView(plugin, state, dispatch, env, loading) {
  const route = state.routes.report;
  const back = h('p', {}, h('a', { href: '#/reports' }, 'Back to Reports'));

  if (route.problem === 'unknown-scope') {
    return messageView(
      plugin.title,
      `There is no ${plugin.title.toLowerCase()} for that scope.`,
      back
    );
  }
  const scope = env.scopes.find(
    (candidate) => candidate.key === route.scopeKey
  );
  if (route.problem === 'denied' || !scope) {
    return messageView(
      plugin.title,
      'You don’t have access to this report.',
      back
    );
  }

  const states = Object.values(route.feeds).map((feed) => feed.status);
  if (loading) {
    return h(
      'div',
      {},
      h('h1', {}, plugin.title),
      LoadingState('Loading report')
    );
  }
  if (states.includes('forbidden')) {
    return messageView(
      scope.label,
      'You don’t have access to this report.',
      back
    );
  }
  if (states.includes('failed')) {
    return messageView(
      scope.label,
      'This report could not be loaded. Try again later, and tell the platform team if it keeps happening.',
      back,
      'alert'
    );
  }
  if (states.includes('missing')) {
    return messageView(
      scope.label,
      `No ${plugin.title} has been published for ${scope.label} yet.`,
      back
    );
  }

  /** @type {Record<string, ReportEnvelope>} */
  const envelopes = {};
  for (const [name, feed] of Object.entries(route.feeds)) {
    envelopes[name] = /** @type {ReportEnvelope} */ (feed.envelope);
  }
  const primary = envelopes[Object.keys(plugin.feeds)[0]];
  const content = plugin.view({
    feeds: envelopes,
    viewer: {
      user: state.chrome.currentUser,
      capabilities: state.chrome.permissions,
      scope,
      today: env.today,
    },
    filters: route.filters,
  });

  return ReportFrame({
    reportId: plugin.id,
    layout: plugin.layout,
    width: route.width,
    eyebrow: plugin.title,
    title: scope.label,
    completeThrough: primary.complete_through ?? null,
    generatedAt: primary.generated_at ?? null,
    scopes: env.scopes,
    scopeKey: scope.key,
    banner: staleBanner(
      primary,
      env.today,
      plugin.staleAfterWorkingDays ?? DEFAULT_STALE_AFTER_WORKING_DAYS
    ),
    content,
    filterSpecs: plugin.filters ?? {},
    filters: route.filters,
    tables: route.tables,
    sorts: route.sorts,
    onFilter: (name, value) =>
      dispatch({ type: 'report/filter-selected', name, value }),
    onToggleTable: (panel) => dispatch({ type: 'report/table-toggled', panel }),
    onSort: (panel, key) =>
      dispatch({ type: 'report/table-sort-requested', panel, key }),
  });
}

/**
 * @param {string} title
 * @param {string} message
 * @param {Node} back
 * @param {'status' | 'alert'} [role]
 */
function messageView(title, message, back, role = 'status') {
  return h(
    'div',
    { className: 'cora-report-message' },
    h('h1', {}, title),
    EmptyState(message, {
      className: `cora-report-message__text cora-report-message__text--${role}`,
    }),
    back
  );
}

/**
 * @param {ReportState} state
 * @param {ReportAction} action
 * @param {ReportPlugin} plugin
 * @returns {ReportState}
 */
function reduce(state, action, plugin) {
  const route = state.routes.report;
  switch (action.type) {
    case 'report/feed-settled':
      return patchRoute(state, 'report', {
        feeds: {
          ...route.feeds,
          [action.name]: {
            status: action.result.status,
            envelope:
              action.result.status === 'loaded' ? action.result.envelope : null,
          },
        },
      });
    case 'report/feed-failed':
      return patchRoute(state, 'report', {
        feeds: {
          ...route.feeds,
          [action.name]: { status: 'failed', envelope: null },
        },
      });
    case 'report/filter-selected': {
      const spec = plugin.filters?.[action.name];
      if (!spec || !spec.options.some((option) => option.key === action.value))
        return state;
      return patchRoute(state, 'report', {
        filters: { ...route.filters, [action.name]: action.value },
      });
    }
    case 'report/table-toggled':
      return patchRoute(state, 'report', {
        tables: route.tables.includes(action.panel)
          ? route.tables.filter((panel) => panel !== action.panel)
          : [...route.tables, action.panel],
      });
    case 'report/table-sort-requested':
      return patchRoute(state, 'report', {
        sorts: {
          ...route.sorts,
          [action.panel]: nextTableSort(
            route.sorts[action.panel] ?? null,
            action.key
          ),
        },
      });
    case 'report/resized':
      return Math.abs(action.width - route.width) < RESIZE_THRESHOLD
        ? state
        : patchRoute(state, 'report', { width: action.width });
    default:
      return state;
  }
}

/**
 * @param {ReportPlugin} plugin
 * @param {Record<string, string>} params
 * @param {AppContext} context
 * @param {{ loadReportFile?: typeof loadReportFile, now?: () => Date }} [dependencies]
 */
export function createReportRouteSlice(
  plugin,
  params,
  context,
  { loadReportFile: load = loadReportFile, now = () => new Date() } = {}
) {
  const scopes = scopesFor(plugin, context.chrome.permissions);
  const { scope, problem } = resolveScope(plugin, scopes, params.scope);
  const today = /** @type {string} */ (toLocalDateKey(now()));
  const env = { scopes, today };

  /** @type {Map<SVGSVGElement, ReturnType<typeof mountGroupedBarChartTooltip>>} */
  const tooltips = new Map();
  /** @type {ResizeObserver | null} */
  let observer = null;

  function disposeTooltips() {
    for (const controller of tooltips.values()) controller.dispose();
    tooltips.clear();
  }

  /** @type {ReportState} */
  const initialState = {
    chrome: context.chrome,
    routes: {
      report: {
        scopeKey: scope?.key ?? null,
        problem,
        feeds: scope
          ? Object.fromEntries(
              Object.keys(plugin.feeds).map((name) => [
                name,
                { status: 'loading', envelope: null },
              ])
            )
          : {},
        filters: Object.fromEntries(
          Object.entries(plugin.filters ?? {}).map(([name, spec]) => [
            name,
            spec.initial,
          ])
        ),
        tables: [],
        sorts: {},
        width: DEFAULT_WIDTH,
      },
    },
  };

  return {
    initialState,
    /** @param {ReportState} state @param {ReportAction} action */
    reducer: (state, action) => reduce(state, action, plugin),
    /**
     * @param {Element} container
     * @param {ReportState} state
     * @param {{ render: (container: Element, view: Node) => void, dispatch: (action: ReportAction) => void, context: AppContext, isActive: () => boolean }} tools
     */
    render(container, state, tools) {
      tools.render(container, reportView(plugin, state, tools.dispatch, env));

      if (!observer && typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(() => {
          // Deferred a frame: resizing inside the callback triggers a "ResizeObserver loop" warning.
          requestAnimationFrame(() => {
            if (!tools.isActive()) return;
            const width = Math.floor(container.clientWidth);
            if (width > 0) tools.dispatch({ type: 'report/resized', width });
          });
        });
        observer.observe(container);
      }

      const charts = new Set(
        /** @type {SVGSVGElement[]} */ ([
          ...container.querySelectorAll('svg.cora-chart'),
        ])
      );
      for (const [chart, controller] of tooltips) {
        if (!charts.has(chart)) {
          controller.dispose();
          tooltips.delete(chart);
        }
      }
      for (const chart of charts) {
        const existing = tooltips.get(chart);
        if (existing) existing.refresh();
        else
          tooltips.set(
            chart,
            mountGroupedBarChartTooltip(chart, { host: tools.context.appEl })
          );
      }
    },
    /**
     * @param {{ dispatch: (action: ReportAction) => void, isActive: () => boolean, signal: AbortSignal }} tools
     */
    start(tools) {
      if (scope) {
        for (const [name, feed] of Object.entries(plugin.feeds)) {
          // Inside the chain so a throwing path() is a failed feed, not a failed mount.
          void Promise.resolve()
            .then(() =>
              load(feed.path(scope), {
                schemaVersion: feed.schemaVersion,
                signal: tools.signal,
              })
            )
            .then(
              (result) => {
                if (tools.isActive())
                  tools.dispatch({ type: 'report/feed-settled', name, result });
              },
              (error) => {
                if (isAbortError(error) || !tools.isActive()) return;
                tools.dispatch({ type: 'report/feed-failed', name });
              }
            );
        }
      }
      return () => {
        observer?.disconnect();
        observer = null;
        disposeTooltips();
      };
    },
  };
}
