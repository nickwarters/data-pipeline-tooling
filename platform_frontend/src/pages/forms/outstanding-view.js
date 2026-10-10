// @ts-check
/**
 * The Outstanding tab: the open Forms the viewer is on, with the employee and
 * manager lanes above them, and for the Forms control group every open Form.
 */

import { h } from '../../lib/html.js';
import { formatDate } from '../../lib/format-datetime.js';
import { dataTableView, sortRequested } from '../../views/data-table.js';
import { kpiStripView } from '../dashboard/kpi-view.js';
import {
  FORM_ROLE_LABELS,
  filterFormRows,
  formLanes,
  formRows,
} from './forms-model.js';
import {
  employeeColumn,
  formActionColumn,
  formStatusColumn,
  formTypeColumn,
  loadMoreView,
  readStateView,
} from './form-cells.js';

/** @typedef {import('./forms-model.js').FormRow} FormRow */
/** @typedef {import('../cora-forms.js').FormsState} FormsState */
/** @typedef {import('../cora-forms.js').FormsRoute} FormsRoute */
/** @typedef {import('../cora-forms.js').FormsViewTools} FormsViewTools */

/** The table name the Outstanding tab sorts by, in the view and the reducer. */
export const OUTSTANDING_TABLE = 'forms';

/**
 * @returns {import('../../views/data-table.js').ColumnDescriptor<FormRow>[]}
 */
export function outstandingColumns() {
  return [
    formTypeColumn(),
    employeeColumn(),
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
    formStatusColumn(),
    formActionColumn((row) =>
      row.dueDate ? `due ${formatDate(row.dueDate)}` : ''
    ),
  ];
}

/**
 * @param {FormsState} state
 * @param {FormsViewTools} tools
 * @returns {Node[]}
 */
export function outstandingView(state, tools) {
  const route = state.routes.forms;
  const { currentUser, permissions } = state.chrome;
  const mine = formRows(
    route.mine.loaded,
    currentUser.id,
    permissions,
    route.today
  );
  return [
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
    tableView(state, mine, tools),
  ].filter((node) => node !== null);
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
      table: 'outstanding',
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
  const pending = readStateView(source.status);
  if (pending) return pending;
  const rows =
    route.scope === 'all'
      ? formRows(
          route.all.loaded,
          state.chrome.currentUser.id,
          state.chrome.permissions,
          route.today
        )
      : mine;
  return h(
    'div',
    {},
    dataTableView({
      rows: filterFormRows(rows, route.filters),
      columns: outstandingColumns(),
      sort: route.sort,
      onSort: (key) => tools.dispatch(sortRequested(OUTSTANDING_TABLE, key)),
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
    route.scope === 'all'
      ? loadMoreView(route.all.next, () => tools.onLoadMore('all'))
      : null
  );
}
