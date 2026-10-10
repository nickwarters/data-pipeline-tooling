// @ts-check
/**
 * The Forms dashboard (`#/forms`): the HR Forms a person has outstanding,
 * across every Form Type, with an "As employee" and an "As manager" lane above
 * the table. The Forms control group can also switch to every open Form.
 *
 * The page reads each Form Type's list and merges the results. What a row may
 * show, and whether its button opens or only views the Form, is decided by
 * `form-access.js` for each Form; the reads narrow on the server only to keep
 * them small.
 */

import { h } from '../lib/html.js';
import { patchRoute } from '../core/route-state.js';
import { isAbortError } from '../lib/abort.js';
import { navigateTo } from '../lib/navigate.js';
import { formatDate } from '../lib/format-datetime.js';
import { toLocalDateKey } from '../lib/local-calendar.js';
import { LoadingState } from '../lib/empty-state.js';
import { withAbortSignal } from '../services/abortable-client.js';
import { canCreateForms } from '../services/form-access.js';
import {
  dataTableView,
  reduceTableSort,
  sortRequested,
} from '../views/data-table.js';
import { kpiStripView } from './dashboard/kpi-view.js';
import {
  FORM_ROLE_LABELS,
  filterFormRows,
  formLanes,
  formRows,
} from './forms/outstanding-model.js';

/** @typedef {import('../../form-types/contract.js').FormTypeDefinition} FormTypeDefinition */
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('./forms/outstanding-model.js').LoadedForms} LoadedForms */
/** @typedef {import('./forms/outstanding-model.js').FormRow} FormRow */
/** @typedef {import('../views/data-table.js').TableSort} TableSort */

/** The one table name this page sorts by: used by both the view and the reducer. */
const TABLE = 'forms';

/**
 * How many Forms of each type one page of "All forms" reads. Every open Form
 * is far more than one person needs at once, and a read without a limit would
 * walk the whole list.
 */
const ALL_FORMS_PAGE = 100;

/** Where the new-form flow starts. */
const NEW_FORM_HREF = '#/forms/new';

/**
 * The badge class for a Form Status. An outstanding Form is Pending; a closed
 * one is only ever listed in the archive.
 *
 * @type {Readonly<Record<string, string>>}
 */
const STATUS_BADGES = Object.freeze({
  Pending: 'cora-badge-open',
  Completed: 'cora-badge-complete',
});

/**
 * @typedef {'loading' | 'loaded' | 'failed'} LoadStatus
 *
 * @typedef {{
 *   formTypes: readonly FormTypeDefinition[],
 *   today: string,
 *   mine: { status: LoadStatus, loaded: LoadedForms[] },
 *   all: { status: LoadStatus | 'idle', loaded: LoadedForms[], next: Record<string, string | null> },
 *   scope: 'mine' | 'all',
 *   filters: { text: string, formType: string, role: string },
 *   sort: TableSort | null,
 *   openLanes: Set<string>,
 * }} FormsRoute
 *
 * @typedef {Object} FormsState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ forms: FormsRoute }} routes
 */

/**
 * @typedef {{
 *   dispatch: (action: any) => any,
 *   onScopeChanged: (scope: 'mine' | 'all') => void,
 *   onLoadMore: () => void,
 * }} FormsViewTools
 */

/**
 * @returns {import('../views/data-table.js').ColumnDescriptor<FormRow>[]}
 */
export function formsColumns() {
  return [
    {
      key: 'formType',
      label: 'Form',
      value: (row) => row.formType.formName,
      sortable: true,
      format: (value) =>
        h('span', { className: 'cora-forms-type' }, String(value)),
    },
    {
      key: 'employee',
      label: 'Employee',
      value: 'employeeName',
      sortable: true,
    },
    {
      key: 'role',
      label: 'Your role',
      value: (row) =>
        row.access.role ? FORM_ROLE_LABELS[row.access.role] : '',
      sortable: true,
    },
    {
      key: 'dueDate',
      label: 'Due date',
      value: 'dueDate',
      sortable: true,
      format: (value, row) =>
        row.overdueDays > 0
          ? h(
              'span',
              { className: 'cora-forms-due-overdue' },
              `${formatDate(value)} · ${row.overdueDays} ${row.overdueDays === 1 ? 'day' : 'days'} over`
            )
          : formatDate(value),
    },
    {
      key: 'status',
      label: 'Status',
      value: 'status',
      sortable: true,
      format: (value) =>
        value
          ? h(
              'span',
              {
                className:
                  `cora-badge ${STATUS_BADGES[String(value)] ?? ''}`.trim(),
              },
              String(value)
            )
          : '',
    },
    {
      key: 'action',
      label: 'Actions',
      value: (row) => row.access.canEdit,
      format: (canEdit, row) => {
        const verb = canEdit ? 'Open' : 'View';
        return h(
          'button',
          {
            type: 'button',
            className: canEdit ? 'cora-case-open-btn' : 'cora-btn-secondary',
            // The due date tells apart two Forms of one type for one person.
            'aria-label': `${verb} ${row.formType.formName} for ${row.employeeName}${row.dueDate ? `, due ${formatDate(row.dueDate)}` : ''}`,
            onclick: () => navigateTo(row.href),
          },
          verb
        );
      },
    },
  ];
}

/**
 * @param {FormsState} state
 * @param {FormsViewTools} tools
 */
export function formsView(state, tools) {
  const route = state.routes.forms;
  const { currentUser, permissions } = state.chrome;
  const mine = formRows(
    route.mine.loaded,
    currentUser.id,
    permissions,
    route.today
  );

  return h(
    'div',
    { className: 'cora-forms' },
    h(
      'div',
      { className: 'cora-forms-header' },
      h('h1', {}, 'Forms'),
      canCreateForms(permissions)
        ? h(
            'button',
            { type: 'button', onclick: () => navigateTo(NEW_FORM_HREF) },
            'New form'
          )
        : null
    ),
    route.mine.status === 'loaded'
      ? kpiStripView({
          lanes: formLanes(mine, route.today),
          openLanes: route.openLanes,
          expandedTiles: new Set(),
          onToggleLane: (role) =>
            tools.dispatch({ type: 'kpi/lane-toggled', role }),
          // No Forms tile has a breakdown, so none can be toggled.
          onToggleTile: () => {},
        })
      : null,
    h('h2', {}, route.scope === 'all' ? 'All open forms' : 'Outstanding forms'),
    toolbarView(route, permissions.isFormsControl, tools),
    tableView(state, mine, tools)
  );
}

/**
 * @param {FormsRoute} route
 * @param {boolean} isFormsControl
 * @param {FormsViewTools} tools
 */
function toolbarView(route, isFormsControl, tools) {
  /** @param {string} key */
  const onChange = (key) => (/** @type {any} */ event) =>
    tools.dispatch({
      type: 'forms/filter-changed',
      key,
      value: event.target?.value ?? '',
    });
  return h(
    'div',
    { className: 'cora-case-table-toolbar' },
    h('input', {
      className: 'cora-case-table-filter',
      type: 'text',
      value: route.filters.text,
      placeholder: 'Filter by person…',
      'aria-label': 'Filter by person',
      oninput: onChange('text'),
    }),
    route.formTypes.length > 1
      ? h(
          'select',
          {
            className: 'cora-case-table-status-filter',
            value: route.filters.formType,
            'aria-label': 'Form type',
            onchange: onChange('formType'),
          },
          h('option', { value: '' }, 'All form types'),
          ...route.formTypes.map((formType) =>
            h('option', { value: formType.slug }, formType.formName)
          )
        )
      : null,
    h(
      'select',
      {
        className: 'cora-case-table-status-filter',
        value: route.filters.role,
        'aria-label': 'Your role',
        onchange: onChange('role'),
      },
      h('option', { value: '' }, 'All my roles'),
      ...Object.entries(FORM_ROLE_LABELS)
        .filter(([role]) => isFormsControl || role !== 'formsControl')
        .map(([role, label]) => h('option', { value: role }, label))
    ),
    isFormsControl
      ? h(
          'select',
          {
            className: 'cora-case-table-status-filter',
            value: route.scope,
            'aria-label': 'Which forms',
            onchange: (/** @type {any} */ event) =>
              tools.onScopeChanged(
                event.target?.value === 'all' ? 'all' : 'mine'
              ),
          },
          h('option', { value: 'mine' }, 'My forms'),
          h('option', { value: 'all' }, 'All open forms')
        )
      : null
  );
}

/**
 * @param {FormsState} state
 * @param {FormRow[]} mine
 * @param {FormsViewTools} tools
 */
function tableView(state, mine, tools) {
  const route = state.routes.forms;
  const source = route.scope === 'all' ? route.all : route.mine;
  if (source.status === 'loading' || source.status === 'idle') {
    return LoadingState('Loading forms');
  }
  if (source.status === 'failed') {
    return h(
      'p',
      { className: 'cora-forms-error', role: 'alert' },
      'Forms could not be loaded. Try again shortly.'
    );
  }
  const rows =
    route.scope === 'all'
      ? formRows(
          route.all.loaded,
          state.chrome.currentUser.id,
          state.chrome.permissions,
          route.today
        )
      : mine;
  const hasMore = Object.values(route.all.next).some((next) => next !== null);
  return h(
    'div',
    {},
    dataTableView({
      rows: filterFormRows(rows, route.filters),
      columns: formsColumns(),
      sort: route.sort,
      onSort: (key) => tools.dispatch(sortRequested(TABLE, key)),
      emptyMessage:
        route.scope === 'all'
          ? 'There are no open forms.'
          : 'You have no outstanding forms.',
      rowKey: (row) => row.key,
      rowHref: (row) => row.href,
      rowClass: (row) =>
        row.overdueDays > 0
          ? 'cora-case-row cora-case-row--overdue'
          : 'cora-case-row',
    }),
    route.scope === 'all' && hasMore
      ? h(
          'button',
          {
            type: 'button',
            className: 'cora-btn-secondary cora-forms-load-more',
            onclick: () => tools.onLoadMore(),
          },
          'Load more'
        )
      : null
  );
}

/**
 * Read one page of Forms from every Form Type the caller names, together.
 *
 * @param {SharePointClient} client
 * @param {readonly FormTypeDefinition[]} formTypes
 * @param {(formType: FormTypeDefinition) => import('../sharepoint-client.js').ListFormItemsOptions} options
 * @returns {Promise<{ loaded: LoadedForms[], next: Record<string, string | null> }>}
 */
async function readForms(client, formTypes, options) {
  const pages = await Promise.all(
    formTypes.map((formType) =>
      client.listFormItems(formType, options(formType))
    )
  );
  return {
    loaded: formTypes.map((formType, i) => ({
      formType,
      items: pages[i].items,
    })),
    next: Object.fromEntries(
      formTypes.map((formType, i) => [formType.slug, pages[i].next])
    ),
  };
}

/**
 * @param {LoadedForms[]} current
 * @param {LoadedForms[]} more
 * @returns {LoadedForms[]}
 */
function appendLoaded(current, more) {
  return current.map((entry) => ({
    formType: entry.formType,
    items: [
      ...entry.items,
      ...(more.find((page) => page.formType === entry.formType)?.items ?? []),
    ],
  }));
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{ now?: () => Date }} [dependencies]
 */
export function createRouteSlice(
  _params,
  context,
  { now = () => new Date() } = {}
) {
  const formTypes = context.formTypes ?? [];

  // The store's, which does not exist yet; start() swaps the real ones in.
  let isActive = () => false;
  /** @type {(action: any) => any} */
  let dispatch = () => {};
  /** @type {SharePointClient | null} */
  let readClient = null;

  /**
   * Read the next page of every open Form, or the first when nothing has been
   * read yet.
   *
   * @param {FormsRoute} route
   */
  function loadAll(route) {
    const client = readClient;
    if (!client) return;
    const append = route.all.status === 'loaded';
    const pending = append
      ? formTypes.filter((formType) => route.all.next[formType.slug] != null)
      : formTypes;
    if (pending.length === 0) return;
    dispatch({ type: 'forms/all-loading', append });
    readForms(client, pending, (formType) => ({
      filter: { closed: false },
      orderBy: { column: 'DueDate' },
      top: ALL_FORMS_PAGE,
      next: append ? route.all.next[formType.slug] : null,
    })).then(
      (page) => {
        if (isActive()) dispatch({ type: 'forms/all-loaded', append, ...page });
      },
      (error) => {
        if (!isAbortError(error) && isActive()) {
          dispatch({ type: 'forms/all-failed' });
        }
      }
    );
  }

  /** @type {FormsState} */
  const initialState = {
    chrome: context.chrome,
    routes: {
      forms: {
        formTypes,
        today: toLocalDateKey(now()) ?? '',
        mine: { status: 'loading', loaded: [] },
        all: { status: 'idle', loaded: [], next: {} },
        scope: 'mine',
        filters: { text: '', formType: '', role: '' },
        sort: null,
        openLanes: new Set(['employee', 'manager']),
      },
    },
  };

  return {
    initialState,
    reducer(/** @type {FormsState} */ state, /** @type {any} */ action) {
      const route = state.routes.forms;
      if (action.type === 'forms/mine-loaded') {
        return patchRoute(state, 'forms', {
          mine: { status: 'loaded', loaded: action.loaded },
        });
      }
      if (action.type === 'forms/mine-failed') {
        return patchRoute(state, 'forms', {
          mine: { status: 'failed', loaded: [] },
        });
      }
      if (action.type === 'forms/scope-changed') {
        return patchRoute(state, 'forms', { scope: action.scope });
      }
      if (action.type === 'forms/all-loading') {
        // Loading more keeps the rows already shown; only a first read shows
        // the loading state.
        if (action.append) return state;
        return patchRoute(state, 'forms', {
          all: { ...route.all, status: 'loading' },
        });
      }
      if (action.type === 'forms/all-loaded') {
        return patchRoute(state, 'forms', {
          all: {
            status: 'loaded',
            loaded: action.append
              ? appendLoaded(route.all.loaded, action.loaded)
              : action.loaded,
            next: { ...route.all.next, ...action.next },
          },
        });
      }
      if (action.type === 'forms/all-failed') {
        return patchRoute(state, 'forms', {
          all: { ...route.all, status: 'failed' },
        });
      }
      if (action.type === 'forms/filter-changed') {
        return patchRoute(state, 'forms', {
          filters: { ...route.filters, [action.key]: action.value },
        });
      }
      if (action.type === 'kpi/lane-toggled') {
        const open = new Set(route.openLanes);
        if (open.has(action.role)) open.delete(action.role);
        else open.add(action.role);
        return patchRoute(state, 'forms', { openLanes: open });
      }
      const sort = reduceTableSort(route.sort, action, TABLE);
      if (sort) return patchRoute(state, 'forms', { sort });
      return state;
    },
    view: (/** @type {FormsState} */ state, /** @type {any} */ tools) =>
      formsView(state, {
        dispatch: tools.dispatch,
        onScopeChanged: (scope) => {
          tools.dispatch({ type: 'forms/scope-changed', scope });
          const { status } = state.routes.forms.all;
          // A failed first read is retried by choosing "All open forms" again.
          if (scope === 'all' && (status === 'idle' || status === 'failed')) {
            loadAll(state.routes.forms);
          }
        },
        onLoadMore: () => loadAll(state.routes.forms),
      }),
    start(/** @type {any} */ tools) {
      isActive = tools.isActive;
      dispatch = tools.dispatch;
      const client = tools.context.client;
      if (!client) return;
      readClient = withAbortSignal(client, tools.signal);
      const me = tools.context.chrome.currentUser.id;
      readForms(readClient, formTypes, () => ({
        filter: { involving: me, closed: false },
      })).then(
        ({ loaded }) => {
          if (tools.isActive()) {
            tools.dispatch({ type: 'forms/mine-loaded', loaded });
          }
        },
        (error) => {
          if (!isAbortError(error) && tools.isActive()) {
            tools.dispatch({ type: 'forms/mine-failed' });
          }
        }
      );
    },
  };
}
