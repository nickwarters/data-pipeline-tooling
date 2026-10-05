// @ts-check
import { h } from '../lib/html.js';
import { patchRoute } from '../core/route-state.js';
import { isAbortError } from '../lib/abort.js';
import { withAbortSignal } from '../services/abortable-client.js';
import { navigateTo } from '../lib/navigate.js';
import { caseRouteFor } from '../lib/case-route-links.js';
import { EmptyState, LoadingState } from '../lib/empty-state.js';
import {
  formatDate,
  formatTimestamp,
  NO_VALUE,
} from '../lib/format-datetime.js';
import {
  SEARCH_PAGE_SIZE,
  searchCases as searchCasesService,
} from '../services/case-search.js';
import {
  overdueCaseRowClass,
  standardCaseColumns,
} from '../views/case-columns.js';
import { dataTableView } from '../views/data-table.js';
import { caseTypeGroupNames } from '../services/permissions.js';
import {
  EMPTY_REASSIGN_FORM,
  reassignBlockedReason,
  reassignCase,
  reassignFormView,
  reviewerCandidates,
} from './case-support/reassign.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').SupportLogEntry} SupportLogEntry */
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../setup/resolve-eligible-case-types.js').CaseSource} CaseSource */
/** @typedef {import('./case-support/reassign.js').ReassignForm} ReassignForm */

/**
 * The page's effects, which a view calls and never awaits.
 *
 * @typedef {{
 *   openReassign: (row: CaseRow) => void,
 *   submitReassign: (row: CaseRow, form: ReassignForm) => void,
 * }} SupportActions
 */

/**
 * A corrective action a Maintainer will be able to take on a Case from this page.
 *
 * @typedef {{ id: string, title: string, description: string }} SupportAction
 */

/** @type {readonly SupportAction[]} */
export const SUPPORT_ACTIONS = [
  {
    id: 'inspect',
    title: 'Inspect fields and history',
    description:
      'Every stored field of the Case, and its SharePoint version history with a comparison between any two versions.',
  },
  {
    id: 'reopen',
    title: 'Reopen',
    description:
      'Return a Reportable Case to In-progress so its Reviewer can correct it, keeping its previous completion as history.',
  },
  {
    id: 'reassign',
    title: 'Reassign',
    description:
      "Move the Case to another Reviewer in its Case Type's reviewer group.",
  },
  {
    id: 'unassign',
    title: 'Un-assign',
    description:
      'Release an In-progress Case back to To-allocate so it can be claimed again.',
  },
  {
    id: 'flags',
    title: 'Clear stuck flags and reset the Due Date',
    description:
      'Clear a stale awaiting-Responsible-Party flag, or recompute the Due Date.',
  },
  {
    id: 'void',
    title: 'Void a Completed Case',
    description:
      'Void a Case that should never have been raised, after it has completed.',
  },
];

/**
 * The Case being supported; `undefined` while read, `null` with an error when it cannot be.
 *
 * @typedef {{
 *   caseType: string,
 *   id: string,
 *   row: CaseRow | null | undefined,
 *   error: string | null,
 *   log: SupportLogEntry[] | undefined,
 *   logError: string | null,
 *   reassign: ReassignForm | null,
 *   notice: string | null,
 * }} SelectedCase
 */

/**
 * @typedef {Object} CaseSupportRouteState
 * @property {string} reference The Case Reference being typed.
 * @property {string} query The Case Reference last searched for; empty for none.
 * @property {CaseRow[] | null} rows
 * @property {boolean} capped
 * @property {string | null} searchError
 * @property {SelectedCase | null} selected
 * @property {Array<{ slug: string, displayName: string }>} caseTypes
 */

/**
 * @typedef {Object} CaseSupportState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ caseSupport: CaseSupportRouteState }} routes
 */

/**
 * The route to this page for one Case.
 *
 * @param {Pick<CaseRow, 'caseType' | 'id'>} row
 * @returns {string}
 */
export function caseSupportRouteFor(row) {
  return `#/case-support/${encodeURIComponent(row.caseType)}/${encodeURIComponent(row.id)}`;
}

/**
 * @param {string} reference
 * @returns {string}
 */
function searchHash(reference) {
  const trimmed = reference.trim();
  if (!trimmed) return '#/case-support';
  return `#/case-support?${new URLSearchParams({ reference: trimmed })}`;
}

/**
 * @param {CaseSupportRouteState} route
 * @param {string} slug
 * @returns {string}
 */
function caseTypeName(route, slug) {
  return (
    route.caseTypes.find((type) => type.slug === slug)?.displayName ?? slug
  );
}

/**
 * @param {CaseSupportRouteState} route
 * @param {{ dispatch: (action: any) => any, onSubmit?: () => void }} tools
 * @returns {HTMLElement}
 */
function searchBarView(route, tools) {
  return h(
    'div',
    {
      className: 'cora-case-support-search',
      role: 'search',
      // Not a <form>: the host page already wraps the app in one.
      onkeydown: (/** @type {any} */ ev) => {
        if (ev.key !== 'Enter' || ev.defaultPrevented) return;
        ev.preventDefault();
        tools.onSubmit?.();
      },
    },
    h(
      'label',
      { className: 'cora-case-support-field' },
      h('span', {}, 'Case Reference'),
      h('input', {
        className: 'cora-case-support-input',
        type: 'text',
        value: route.reference,
        oninput: (/** @type {any} */ ev) =>
          tools.dispatch({
            type: 'case-support/reference-changed',
            reference: ev.target?.value ?? '',
          }),
      })
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'cora-case-support-submit',
        onclick: () => tools.onSubmit?.(),
      },
      'Find Case'
    )
  );
}

/**
 * @param {CaseSupportRouteState} route
 * @returns {HTMLElement}
 */
function resultsView(route) {
  if (route.searchError) {
    return h(
      'p',
      { className: 'cora-case-support-error', role: 'alert' },
      route.searchError
    );
  }
  if (!route.query) {
    return h(
      'p',
      { className: 'cora-case-support-prompt' },
      'Enter a Case Reference to find the Case you need to support.'
    );
  }
  if (!route.rows) return LoadingState('Finding Cases');
  if (route.rows.length === 0)
    return EmptyState('No Cases match this reference.');

  return h(
    'div',
    {},
    route.capped &&
      h(
        'p',
        { className: 'cora-case-support-cap' },
        `Showing the first ${SEARCH_PAGE_SIZE} matches. Enter more of the reference.`
      ),
    dataTableView({
      rows: route.rows,
      columns: standardCaseColumns({
        onOpen: (row) => navigateTo(caseSupportRouteFor(row)),
      }),
      // Sorting is not offered: a lookup by reference is read from the top.
      sort: null,
      onSort: () => {},
      emptyMessage: 'No Cases match this reference.',
      rowKey: (row) => `${row.caseType}:${row.id}`,
      rowHref: caseSupportRouteFor,
      rowClass: overdueCaseRowClass,
    })
  );
}

/**
 * @param {string} term
 * @param {string} value
 * @returns {HTMLElement[]}
 */
function fact(term, value) {
  return [h('dt', {}, term), h('dd', {}, value || NO_VALUE)];
}

/**
 * @param {CaseSupportRouteState} route
 * @param {CaseRow} row
 * @returns {HTMLElement}
 */
function caseHeaderView(route, row) {
  return h(
    'section',
    {
      className: 'cora-case-support-case',
      'aria-labelledby': 'cora-case-support-case-title',
    },
    h(
      'div',
      { className: 'cora-case-support-case-heading' },
      h('h2', { id: 'cora-case-support-case-title' }, row.title),
      h(
        'a',
        { className: 'cora-case-support-open', href: caseRouteFor(row) },
        'Open in Case Review'
      )
    ),
    h(
      'dl',
      { className: 'cora-case-support-facts' },
      ...fact('Case Type', caseTypeName(route, row.caseType)),
      ...fact('Status', row.status),
      ...fact('Assigned Reviewer', row.assignedReviewer),
      ...fact(
        'Responsible Party',
        row.responsiblePartyDisplayName || row.responsibleParty
      ),
      ...fact('Assigned on', formatDate(row.assignedAt)),
      ...fact('Due Date', formatDate(row.dueDate)),
      ...fact('Reportable on', formatDate(row.reportableAt)),
      ...fact('Completed on', formatDate(row.completedAt)),
      ...(row.voidedAt ? fact('Voided on', formatDate(row.voidedAt)) : [])
    )
  );
}

/**
 * How each built action is started from its card; an action not listed here is not built yet.
 *
 * @type {Record<string, { label: string, blockedBy: (row: CaseRow) => string | null, open: (actions: SupportActions, row: CaseRow) => void }>}
 */
const ACTION_STARTERS = {
  reassign: {
    label: 'Reassign',
    blockedBy: reassignBlockedReason,
    open: (actions, row) => actions.openReassign(row),
  },
};

/**
 * @param {SupportAction} action
 * @param {CaseRow} row
 * @param {SupportActions | undefined} actions
 * @returns {HTMLElement}
 */
function actionCardView(action, row, actions) {
  const headingId = `cora-case-support-action-${action.id}`;
  const starter = ACTION_STARTERS[action.id];
  const blocked = starter ? starter.blockedBy(row) : null;
  return h(
    'li',
    { className: 'cora-case-support-action' },
    h('h3', { id: headingId }, action.title),
    h('p', {}, action.description),
    blocked &&
      h('p', { className: 'cora-case-support-action-blocked' }, blocked),
    h(
      'button',
      {
        type: 'button',
        className: 'cora-case-support-action-button',
        disabled: !starter || blocked !== null || !actions,
        'aria-describedby': headingId,
        onclick: () => actions && starter?.open(actions, row),
      },
      starter ? starter.label : 'Not available yet'
    )
  );
}

/**
 * @param {CaseRow} row
 * @param {SupportActions | undefined} actions
 * @returns {HTMLElement}
 */
function actionsView(row, actions) {
  return h(
    'section',
    {
      className: 'cora-case-support-actions',
      'aria-labelledby': 'cora-case-support-actions-title',
    },
    h('h2', { id: 'cora-case-support-actions-title' }, 'Support actions'),
    h(
      'p',
      { className: 'cora-case-support-note' },
      'Each action asks for a reason and is recorded in the support log before the Case changes.'
    ),
    h(
      'ul',
      { className: 'cora-case-support-action-list' },
      ...SUPPORT_ACTIONS.map((action) => actionCardView(action, row, actions))
    )
  );
}

/**
 * A changed value as the log shows it: text as is, anything else as JSON.
 *
 * @param {unknown} value
 * @returns {string}
 */
function changeValueText(value) {
  if (value === null || value === undefined || value === '') return NO_VALUE;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * @param {SupportLogEntry} entry
 * @returns {HTMLElement}
 */
function logEntryView(entry) {
  const title =
    SUPPORT_ACTIONS.find((action) => action.id === entry.action)?.title ??
    entry.action;
  const notApplied = entry.outcome === 'not-applied';
  return h(
    'li',
    {
      className: notApplied
        ? 'cora-case-support-log-entry cora-case-support-log-entry--not-applied'
        : 'cora-case-support-log-entry',
    },
    h(
      'p',
      { className: 'cora-case-support-log-heading' },
      h('strong', {}, title),
      notApplied &&
        h('span', { className: 'cora-case-support-log-badge' }, 'Not applied'),
      h(
        'span',
        { className: 'cora-case-support-log-meta' },
        `${entry.createdBy || 'Unknown'}, ${formatTimestamp(entry.createdAt)}`
      )
    ),
    h('p', { className: 'cora-case-support-log-reason' }, entry.reason),
    entry.changes.length > 0 &&
      h(
        'ul',
        { className: 'cora-case-support-log-changes' },
        ...entry.changes.map((change) =>
          h(
            'li',
            {},
            `${change.field}: ${changeValueText(change.before)} → ${changeValueText(change.after)}`
          )
        )
      )
  );
}

/**
 * @param {SelectedCase} selected
 * @returns {HTMLElement}
 */
function supportLogBodyView(selected) {
  if (selected.logError) {
    return h(
      'p',
      { className: 'cora-case-support-error', role: 'alert' },
      selected.logError
    );
  }
  if (!selected.log) return LoadingState('Loading the support log');
  if (selected.log.length === 0) {
    return EmptyState('No support actions have been recorded on this Case.');
  }
  return h(
    'ol',
    { className: 'cora-case-support-log-list' },
    ...selected.log.map(logEntryView)
  );
}

/**
 * @param {SelectedCase} selected
 * @returns {HTMLElement}
 */
function supportLogView(selected) {
  return h(
    'section',
    {
      className: 'cora-case-support-log',
      'aria-labelledby': 'cora-case-support-log-title',
    },
    h('h2', { id: 'cora-case-support-log-title' }, 'Support log'),
    supportLogBodyView(selected)
  );
}

/**
 * @param {CaseSupportRouteState} route
 * @param {CaseRow} row
 * @param {ReassignForm} form
 * @param {ViewTools} tools
 * @returns {HTMLElement}
 */
function reassignView(route, row, form, tools) {
  const displayName =
    route.caseTypes.find((type) => type.slug === row.caseType)?.displayName ??
    row.caseType;
  return reassignFormView(form, caseTypeGroupNames(displayName).listAccess, {
    onReviewer: (reviewer) =>
      tools.dispatch({ type: 'case-support/reassign-reviewer', reviewer }),
    onReason: (reason) =>
      tools.dispatch({ type: 'case-support/reassign-reason', reason }),
    onSubmit: () => tools.supportActions?.submitReassign(row, form),
    onCancel: () => tools.dispatch({ type: 'case-support/reassign-closed' }),
  });
}

/**
 * @param {CaseSupportRouteState} route
 * @param {SelectedCase} selected
 * @param {ViewTools} tools
 * @returns {HTMLElement}
 */
function selectedView(route, selected, tools) {
  if (selected.error) {
    return h(
      'p',
      { className: 'cora-case-support-error', role: 'alert' },
      selected.error
    );
  }
  if (!selected.row) return LoadingState('Loading Case');
  return h(
    'div',
    { className: 'cora-case-support-selected' },
    caseHeaderView(route, selected.row),
    selected.notice &&
      h(
        'p',
        { className: 'cora-case-support-notice', role: 'status' },
        selected.notice
      ),
    selected.reassign
      ? reassignView(route, selected.row, selected.reassign, tools)
      : actionsView(selected.row, tools.supportActions),
    supportLogView(selected)
  );
}

/**
 * @typedef {{ dispatch: (action: any) => any, onSubmit?: () => void, supportActions?: SupportActions }} ViewTools
 */

/**
 * @param {CaseSupportState} state
 * @param {ViewTools} tools
 * @returns {HTMLElement}
 */
export function caseSupportView(state, tools) {
  const route = state.routes.caseSupport;
  return h(
    'div',
    { className: 'cora-case-support' },
    h('h1', {}, 'Case Support'),
    searchBarView(route, tools),
    route.selected
      ? selectedView(route, route.selected, tools)
      : resultsView(route)
  );
}

/**
 * Read the Case the route names, from the list of the Case Type it names.
 *
 * @param {SharePointClient} client
 * @param {CaseSource[]} sources
 * @param {{ caseType: string, id: string }} target
 * @returns {Promise<{ row: CaseRow } | { error: string }>}
 */
async function loadSelectedCase(client, sources, { caseType, id }) {
  const source = sources.find((candidate) => candidate.slug === caseType);
  if (!source) {
    return { error: `No Case Type "${caseType}" is available to you.` };
  }
  const row = await client.getCase(id, { listName: source.listName });
  if (!row) {
    return {
      error: `No Case with id "${id}" was found in ${source.displayName}.`,
    };
  }
  return { row };
}

/**
 * The open Reassign form after one of its own actions; any other action leaves it as it was.
 *
 * @param {ReassignForm} form
 * @param {any} action
 * @returns {ReassignForm}
 */
function reassignFormAfter(form, action) {
  switch (action.type) {
    case 'case-support/reassign-candidates-loaded':
      return { ...form, candidates: action.candidates, candidatesError: null };
    case 'case-support/reassign-candidates-failed':
      return { ...form, candidatesError: action.message };
    case 'case-support/reassign-reviewer':
      return { ...form, reviewer: action.reviewer };
    case 'case-support/reassign-reason':
      return { ...form, reason: action.reason };
    case 'case-support/reassign-saving':
      return { ...form, saving: true, error: null };
    case 'case-support/reassign-failed':
      return { ...form, saving: false, error: action.message };
    default:
      return form;
  }
}

/**
 * @param {Record<string, string>} params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{ searchCases?: typeof searchCasesService }} [dependencies]
 * @returns {{
 *   initialState: CaseSupportState,
 *   reducer: (state: CaseSupportState, action: any) => CaseSupportState,
 *   view: (state: CaseSupportState, tools: any) => HTMLElement,
 *   start: (tools: any) => void,
 * }}
 */
export function createRouteSlice(
  params,
  context,
  { searchCases = searchCasesService } = {}
) {
  const query = (
    new URLSearchParams(params.queryString ?? '').get('reference') ?? ''
  ).trim();
  /** @type {SelectedCase | null} */
  const selected =
    params.caseType && params.id
      ? {
          caseType: params.caseType,
          id: params.id,
          row: undefined,
          error: null,
          log: undefined,
          logError: null,
          reassign: null,
          notice: null,
        }
      : null;

  /** @type {CaseSupportState} */
  const initialState = {
    chrome: context.chrome,
    routes: {
      caseSupport: {
        reference: query,
        query,
        rows: null,
        capped: false,
        searchError: null,
        selected,
        caseTypes: context.caseSources.map(({ slug, displayName }) => ({
          slug,
          displayName,
        })),
      },
    },
  };

  /** @type {SupportActions | null} */
  let supportActions = null;

  return {
    initialState,
    reducer(state, action) {
      const route = state.routes.caseSupport;
      if (action.type === 'case-support/reference-changed') {
        return patchRoute(state, 'caseSupport', {
          reference: action.reference,
        });
      }
      if (action.type === 'case-support/search-loaded') {
        return patchRoute(state, 'caseSupport', {
          rows: action.rows,
          capped: action.capped,
          searchError: null,
        });
      }
      if (action.type === 'case-support/search-failed') {
        return patchRoute(state, 'caseSupport', {
          searchError: action.message,
        });
      }
      if (route.selected && action.type === 'case-support/case-loaded') {
        return patchRoute(state, 'caseSupport', {
          selected: { ...route.selected, row: action.row, error: null },
        });
      }
      if (route.selected && action.type === 'case-support/case-failed') {
        return patchRoute(state, 'caseSupport', {
          selected: { ...route.selected, row: null, error: action.message },
        });
      }
      if (route.selected && action.type === 'case-support/log-loaded') {
        return patchRoute(state, 'caseSupport', {
          selected: { ...route.selected, log: action.entries, logError: null },
        });
      }
      if (route.selected && action.type === 'case-support/log-failed') {
        return patchRoute(state, 'caseSupport', {
          selected: { ...route.selected, logError: action.message },
        });
      }
      if (route.selected && action.type === 'case-support/reassign-opened') {
        return patchRoute(state, 'caseSupport', {
          selected: {
            ...route.selected,
            reassign: EMPTY_REASSIGN_FORM,
            notice: null,
          },
        });
      }
      if (route.selected && action.type === 'case-support/reassign-closed') {
        return patchRoute(state, 'caseSupport', {
          selected: { ...route.selected, reassign: null },
        });
      }
      if (route.selected && action.type === 'case-support/reassigned') {
        return patchRoute(state, 'caseSupport', {
          selected: {
            ...route.selected,
            reassign: null,
            notice: action.notice,
          },
        });
      }
      const form = route.selected?.reassign;
      if (route.selected && form) {
        const next = reassignFormAfter(form, action);
        if (next !== form) {
          return patchRoute(state, 'caseSupport', {
            selected: { ...route.selected, reassign: next },
          });
        }
      }
      return state;
    },
    view: (state, tools) =>
      caseSupportView(state, {
        ...tools,
        supportActions: supportActions ?? undefined,
        onSubmit: () =>
          navigateTo(searchHash(state.routes.caseSupport.reference)),
      }),
    start(tools) {
      const client = tools.context.client;
      if (!client) return;
      const readClient = withAbortSignal(client, tools.signal);
      const sources = tools.context.caseSources;

      /**
       * @param {unknown} error
       * @param {string} type
       * @param {string} prefix
       */
      const fail = (error, type, prefix) => {
        if (isAbortError(error) || !tools.isActive()) return;
        tools.dispatch({ type, message: `${prefix} ${error}` });
      };

      if (selected) {
        const source = sources.find(
          (/** @type {CaseSource} */ candidate) =>
            candidate.slug === selected.caseType
        );
        const loadCase = () =>
          loadSelectedCase(readClient, sources, selected).then(
            (result) => {
              if (!tools.isActive()) return;
              tools.dispatch(
                'row' in result
                  ? { type: 'case-support/case-loaded', row: result.row }
                  : { type: 'case-support/case-failed', message: result.error }
              );
            },
            (error) =>
              fail(
                error,
                'case-support/case-failed',
                'The Case could not be loaded.'
              )
          );
        const loadLog = () =>
          readClient
            .listSupportLog({
              caseType: selected.caseType,
              caseId: selected.id,
            })
            .then(
              (entries) => {
                if (tools.isActive()) {
                  tools.dispatch({ type: 'case-support/log-loaded', entries });
                }
              },
              (error) =>
                fail(
                  error,
                  'case-support/log-failed',
                  'The support log could not be loaded.'
                )
            );

        void loadCase();
        // An unknown Case Type is reported above, so its log is not asked for.
        if (!source) return;
        void loadLog();

        supportActions = {
          openReassign(row) {
            tools.dispatch({ type: 'case-support/reassign-opened' });
            void readClient
              .listGroupMembers(
                caseTypeGroupNames(source.displayName).listAccess
              )
              .then(
                (members) => {
                  if (!tools.isActive()) return;
                  tools.dispatch({
                    type: 'case-support/reassign-candidates-loaded',
                    candidates: reviewerCandidates(members, row),
                  });
                },
                (error) =>
                  fail(
                    error,
                    'case-support/reassign-candidates-failed',
                    'The reviewer group could not be read.'
                  )
              );
          },
          submitReassign(row, form) {
            tools.dispatch({ type: 'case-support/reassign-saving' });
            const chosen = form.candidates?.find(
              (person) => person.loginName === form.reviewer
            );
            // The raw client: a write already under way must finish, even if the page is left.
            reassignCase(client, {
              row,
              listName: source.listName,
              reviewer: form.reviewer,
              reason: form.reason.trim(),
            }).then(
              (result) => {
                if (!tools.isActive()) return;
                if (!result.ok) {
                  tools.dispatch({
                    type: 'case-support/reassign-failed',
                    message: result.conflict
                      ? `${result.message} Reload the Case to see its latest state.`
                      : result.message,
                  });
                  void loadLog();
                  return;
                }
                tools.dispatch({
                  type: 'case-support/reassigned',
                  notice: `Reassigned to ${chosen?.displayName ?? form.reviewer}.`,
                });
                void loadCase();
                void loadLog();
              },
              (error) => {
                if (!tools.isActive()) return;
                tools.dispatch({
                  type: 'case-support/reassign-failed',
                  message: `Nothing was changed: the support log could not be written. ${error}`,
                });
              }
            );
          },
        };
        return;
      }

      if (!query) return;
      void searchCases(readClient, { titlePrefix: query }, sources).then(
        ({ rows, capped }) => {
          if (tools.isActive()) {
            tools.dispatch({
              type: 'case-support/search-loaded',
              rows,
              capped,
            });
          }
        },
        (error) =>
          fail(
            error,
            'case-support/search-failed',
            'The search could not be completed.'
          )
      );
    },
  };
}
