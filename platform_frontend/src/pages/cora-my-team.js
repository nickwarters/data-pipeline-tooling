// @ts-check
import {
  buildTeamWorkload,
  withReviewerDisplayNames,
} from '../evaluators/team-workload-model.js';
import { buildVoidVolumes } from '../evaluators/void-volume-model.js';
import { h } from '../lib/html.js';
import { LoadingState } from '../lib/empty-state.js';
import { patchRoute } from '../core/route-state.js';
import { withAbortSignal } from '../services/abortable-client.js';
import {
  fetchTeamVoidedCases,
  fetchTeamWorkloadCases,
} from '../services/team-cases-fetcher.js';
import {
  dataTableView,
  reduceTableSort,
  sortRequested,
} from '../views/data-table.js';

/** The table names this page sorts by: used by both the view and the reducer. */
const TABLE = 'workload';
const VOID_TABLE = 'void-volumes';

/** How far back the void report reads. Both of its columns come from this one window. */
const VOID_WINDOW_DAYS = 30;

/** @typedef {import('../evaluators/team-workload-model.js').WorkloadRow} WorkloadRow */
/** @typedef {import('../setup/resolve-eligible-case-types.js').CaseSource} CaseSource */
/** @typedef {import('../evaluators/void-volume-model.js').VoidVolumeRow} VoidVolumeRow */
/** @typedef {import('../views/data-table.js').ColumnDescriptor<WorkloadRow>} WorkloadColumn */
/** @typedef {import('../views/data-table.js').ColumnDescriptor<VoidVolumeRow>} VoidVolumeColumn */
/** @typedef {import('../views/data-table.js').TableSort} TableSort */

/**
 * @typedef {Object} MyTeamRouteState
 * @property {WorkloadRow[] | null} rows
 * @property {TableSort | null} sort
 * @property {boolean} loading
 * @property {string | null} error
 * @property {VoidVolumeRow[] | null} voidRows
 * @property {TableSort | null} voidSort
 * @property {boolean} voidLoading
 * @property {string | null} voidError
 */

/**
 * @typedef {Object} MyTeamState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ myTeam: MyTeamRouteState }} routes
 */

/**
 * @typedef {
 *   | { type: 'workload/refresh-requested' }
 *   | { type: 'workload/loaded', rows: WorkloadRow[] }
 *   | { type: 'workload/load-failed', message: string }
 *   | { type: 'workload-table/sort-requested', key: string }
 *   | { type: 'void-volumes/refresh-requested' }
 *   | { type: 'void-volumes/loaded', rows: VoidVolumeRow[] }
 *   | { type: 'void-volumes/load-failed', message: string }
 *   | { type: 'void-volumes-table/sort-requested', key: string }
 * } MyTeamAction
 */

/**
 * @param {CaseSource[]} sources
 * @returns {WorkloadColumn[]}
 */
export function myTeamColumns(sources) {
  return [
    {
      key: 'reviewer',
      label: 'Reviewer',
      value: 'reviewer',
      sortable: true,
    },
    ...sources.map((source) => ({
      key: `case-type-${source.slug}`,
      label: source.displayName || source.slug,
      value: (/** @type {WorkloadRow} */ row) =>
        row.countsByCaseType[source.slug] ?? 0,
      sortable: true,
    })),
    {
      key: 'totalOutstanding',
      label: 'Total outstanding',
      value: 'totalOutstanding',
      sortable: true,
    },
    {
      key: 'onHold',
      label: 'On hold',
      value: 'onHold',
      sortable: true,
    },
    {
      key: 'longestHoldDays',
      label: 'Longest hold (days)',
      value: 'longestHoldDays',
      sortable: true,
    },
  ];
}

/**
 * @param {CaseSource[]} sources
 * @returns {VoidVolumeColumn[]}
 */
export function voidVolumeColumns(sources) {
  return [
    { key: 'reviewer', label: 'Reviewer', value: 'reviewer', sortable: true },
    { key: 'last7', label: 'Voided (7 days)', value: 'last7', sortable: true },
    {
      key: 'last30',
      label: 'Voided (30 days)',
      value: 'last30',
      sortable: true,
    },
    ...sources.map((source) => ({
      key: `void-case-type-${source.slug}`,
      label: source.displayName || source.slug,
      value: (/** @type {VoidVolumeRow} */ row) =>
        row.countsByCaseType[source.slug] ?? 0,
      sortable: true,
    })),
    {
      key: 'leadingReason',
      label: 'Leading reason (30 days)',
      value: 'leadingReason',
      sortable: true,
    },
  ];
}

/**
 * @param {MyTeamState} state
 * @param {{
 *   dispatch: (action: MyTeamAction) => void,
 *   caseSources: CaseSource[],
 *   runRefreshEffect?: () => void,
 * }} tools
 * @returns {HTMLElement}
 */
export function myTeamView(
  state,
  { dispatch, caseSources, runRefreshEffect = () => {} }
) {
  const route = state.routes.myTeam;
  const staffRows = route.rows?.filter((row) => !row.isTotal) ?? [];
  const totalRows = route.rows?.filter((row) => row.isTotal) ?? [];
  // Refresh starts both reads, so the page is busy until both have finished:
  // re-enabling the button on the first one back invites a second refresh on
  // top of a read still in flight.
  const busy = route.loading || route.voidLoading;
  return h(
    'main',
    { className: 'cora-my-team', 'aria-busy': String(busy) },
    h(
      'header',
      { className: 'cora-my-team-header' },
      h(
        'div',
        {},
        h('h1', {}, 'My Team'),
        h(
          'p',
          {},
          'A live view of allocated, outstanding Cases across your team.'
        )
      ),
      h(
        'button',
        {
          type: 'button',
          disabled: busy,
          onclick: () => {
            dispatch({ type: 'workload/refresh-requested' });
            dispatch({ type: 'void-volumes/refresh-requested' });
            runRefreshEffect();
          },
        },
        busy ? 'Refreshing…' : 'Refresh'
      )
    ),
    h('h2', {}, 'Current Workload'),
    h(
      'p',
      { className: 'cora-my-team-roster-note' },
      'This v1 view shows only staff with allocated outstanding Cases because no separate staff roster is available.'
    ),
    route.error ? h('p', { role: 'alert' }, route.error) : null,
    route.loading && route.rows === null
      ? LoadingState('Loading current workload')
      : null,
    route.rows !== null
      ? h(
          'div',
          { className: 'cora-my-team-table' },
          dataTableView({
            rows: staffRows,
            footerRows: totalRows,
            columns: myTeamColumns(caseSources),
            sort: route.sort,
            onSort: (key) => dispatch(sortRequested(TABLE, key)),
            emptyMessage: 'No allocated outstanding Cases.',
            rowKey: (row) =>
              row.reviewerId === null
                ? 'workload-total'
                : `reviewer:${row.reviewerId}`,
            rowClass: (row) => (row.isTotal ? 'cora-workload-row--total' : ''),
          })
        )
      : null,
    // The second table stands or falls on its own: its rows, its sort, its
    // error. A void report that cannot be read must not take the workload the
    // manager came for down with it.
    h('h2', {}, 'Voided Cases'),
    h(
      'p',
      { className: 'cora-my-team-void-note' },
      'Cases voided by your team in the last 30 days, by whoever voided them.'
    ),
    route.voidError ? h('p', { role: 'alert' }, route.voidError) : null,
    route.voidLoading && route.voidRows === null
      ? LoadingState('Loading voided Cases')
      : null,
    route.voidRows !== null
      ? h(
          'div',
          { className: 'cora-my-team-table' },
          dataTableView({
            rows: route.voidRows.filter((row) => !row.isTotal),
            footerRows: route.voidRows.filter((row) => row.isTotal),
            columns: voidVolumeColumns(caseSources),
            sort: route.voidSort,
            onSort: (key) => dispatch(sortRequested(VOID_TABLE, key)),
            emptyMessage: 'No Cases voided in the last 30 days.',
            rowKey: (row) =>
              row.reviewerId === null
                ? 'void-total'
                : `void-reviewer:${row.reviewerId}`,
            rowClass: (row) =>
              row.isTotal ? 'cora-void-volume-row--total' : '',
          })
        )
      : null
  );
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{
 *   fetchCases?: typeof fetchTeamWorkloadCases,
 *   fetchVoidedCases?: typeof fetchTeamVoidedCases,
 *   now?: () => Date,
 * }} [dependencies]
 */
export function createRouteSlice(
  _params,
  context,
  {
    fetchCases = fetchTeamWorkloadCases,
    fetchVoidedCases = fetchTeamVoidedCases,
    now = () => new Date(),
  } = {}
) {
  // One token per table: the two reads finish independently, so one must not be
  // able to discard the other's rows. Held in a box so the shared load path can
  // read and bump whichever token it was handed.
  const loadSequence = { value: 0 };
  const voidLoadSequence = { value: 0 };
  // The mount lifetime comes from the adapter's tools, not a page-local latch.
  /** @type {null | { dispatch: (action: MyTeamAction) => void, context: import('../setup/register-routes.js').AppContext, isActive: () => boolean, signal?: AbortSignal }} */
  let effectTools = null;
  // The same lifetime bound to the client's reads, so navigating away cancels
  // the per-source workload fan-out rather than only discarding it.
  /** @type {null | import('../sharepoint-client.js').SharePointClient} */
  let readClient = null;

  /**
   * The one load path both tables take. They differ only in what they read, how
   * they shape it and what they dispatch; the rules that make a load safe — the
   * mount lifetime, the per-table sequence token, and directory enrichment that
   * must never cost a load — are the same for both, so they are written once.
   *
   * The read is started *inside* the chain rather than before it: a mount with
   * no client throws where the fetcher first touches it, and that has to reach
   * the failure handler rather than out of `start()`, where it would take the
   * whole route down.
   *
   * @template {{ reviewerId: string | null, reviewer: string }} Row
   * @param {{
   *   sequence: { value: number },
   *   read: (client: import('../sharepoint-client.js').SharePointClient) => Promise<import('../sharepoint-client.js').CaseRow[]>,
   *   build: (cases: import('../sharepoint-client.js').CaseRow[]) => Row[],
   *   loaded: (rows: Row[]) => MyTeamAction,
   *   failed: (message: string) => MyTeamAction,
   *   fallbackMessage: string,
   * }} spec
   */
  function runLoad(spec) {
    const tools = effectTools;
    if (!tools || !tools.isActive()) return;
    const sequence = (spec.sequence.value += 1);
    // Still the load this table is waiting for: the mount is alive and no later
    // read of the same table has overtaken this one.
    const current = () => tools.isActive() && sequence === spec.sequence.value;
    void Promise.resolve()
      .then(() =>
        spec.read(
          // `readClient` and `effectTools` are set and cleared together, so this
          // is the single source; the cast covers the client-less mount, which
          // reaches the rejection handler below.
          /** @type {import('../sharepoint-client.js').SharePointClient} */ (
            readClient
          )
        )
      )
      .then(
        async (cases) => {
          if (!current()) return;
          const rows = spec.build(cases);
          const reviewerIds = rows.flatMap((row) =>
            row.reviewerId === null ? [] : [row.reviewerId]
          );
          /** @type {Record<string, string | null>} */
          let displayNames = {};
          try {
            if (typeof tools.context.client.resolveUsers === 'function') {
              displayNames =
                await tools.context.client.resolveUsers(reviewerIds);
            }
          } catch {
            // The counts remain useful when directory enrichment is unavailable.
          }
          if (current()) {
            tools.dispatch(
              spec.loaded(withReviewerDisplayNames(rows, displayNames))
            );
          }
        },
        (error) => {
          // An abort reaches here with isActive() already false, so navigation
          // never renders a load failure.
          if (current()) {
            tools.dispatch(
              spec.failed(
                error instanceof Error ? error.message : spec.fallbackMessage
              )
            );
          }
        }
      );
  }

  function runRefreshEffect() {
    const tools = effectTools;
    if (!tools) return;
    runLoad({
      sequence: loadSequence,
      read: (client) =>
        fetchCases(
          client,
          tools.context.chrome.currentUser.id,
          tools.context.caseSources
        ),
      build: (cases) =>
        buildTeamWorkload(cases, tools.context.caseSources, now()),
      loaded: (rows) => ({ type: 'workload/loaded', rows }),
      failed: (message) => ({ type: 'workload/load-failed', message }),
      fallbackMessage: 'Unable to load current workload.',
    });
  }

  function runVoidRefreshEffect() {
    const tools = effectTools;
    if (!tools) return;
    const since = new Date(
      now().getTime() - VOID_WINDOW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    runLoad({
      sequence: voidLoadSequence,
      read: (client) =>
        fetchVoidedCases(
          client,
          tools.context.chrome.currentUser.id,
          tools.context.caseSources,
          since
        ),
      build: (cases) =>
        buildVoidVolumes(cases, tools.context.caseSources, now()),
      loaded: (rows) => ({ type: 'void-volumes/loaded', rows }),
      failed: (message) => ({ type: 'void-volumes/load-failed', message }),
      fallbackMessage: 'Unable to load voided Cases.',
    });
  }

  /** @type {MyTeamState} */
  const initialState = {
    chrome: context.chrome,
    routes: {
      myTeam: {
        rows: null,
        sort: null,
        loading: true,
        error: null,
        voidRows: null,
        voidSort: null,
        voidLoading: true,
        voidError: null,
      },
    },
  };

  return {
    initialState,
    /**
     * @param {MyTeamState} state
     * @param {MyTeamAction} action
     * @returns {MyTeamState}
     */
    reducer(state, action) {
      const route = state.routes.myTeam;
      if (action.type === 'workload/refresh-requested') {
        return patchRoute(state, 'myTeam', { loading: true, error: null });
      }
      if (action.type === 'workload/loaded') {
        return patchRoute(state, 'myTeam', {
          rows: action.rows,
          loading: false,
          error: null,
        });
      }
      if (action.type === 'workload/load-failed') {
        return patchRoute(state, 'myTeam', {
          loading: false,
          error: action.message,
        });
      }
      if (action.type === 'void-volumes/refresh-requested') {
        return patchRoute(state, 'myTeam', {
          voidLoading: true,
          voidError: null,
        });
      }
      if (action.type === 'void-volumes/loaded') {
        return patchRoute(state, 'myTeam', {
          voidRows: action.rows,
          voidLoading: false,
          voidError: null,
        });
      }
      if (action.type === 'void-volumes/load-failed') {
        return patchRoute(state, 'myTeam', {
          voidLoading: false,
          voidError: action.message,
        });
      }
      const sort = reduceTableSort(route.sort, action, TABLE);
      if (sort) return patchRoute(state, 'myTeam', { sort });
      const voidSort = reduceTableSort(route.voidSort, action, VOID_TABLE);
      if (voidSort) return patchRoute(state, 'myTeam', { voidSort });
      return state;
    },
    view(
      /** @type {MyTeamState} */ state,
      /** @type {{ dispatch: (action: MyTeamAction) => void, context: import('../setup/register-routes.js').AppContext }} */ tools
    ) {
      return myTeamView(state, {
        dispatch: tools.dispatch,
        caseSources: tools.context.caseSources,
        runRefreshEffect: () => {
          runRefreshEffect();
          runVoidRefreshEffect();
        },
      });
    },
    start(
      /** @type {{ dispatch: (action: MyTeamAction) => void, context: import('../setup/register-routes.js').AppContext, isActive: () => boolean, signal?: AbortSignal }} */ tools
    ) {
      effectTools = tools;
      // Only wrap when there is something to wrap: a mount with no client must
      // still degrade to the `workload/load-failed` message rather than let
      // binding the mount signal take out the whole route.
      readClient = tools.context.client
        ? withAbortSignal(tools.context.client, tools.signal)
        : tools.context.client;
      tools.dispatch({ type: 'workload/refresh-requested' });
      runRefreshEffect();
      tools.dispatch({ type: 'void-volumes/refresh-requested' });
      runVoidRefreshEffect();

      return () => {
        effectTools = null;
        readClient = null;
        loadSequence.value += 1;
        voidLoadSequence.value += 1;
      };
    },
  };
}
