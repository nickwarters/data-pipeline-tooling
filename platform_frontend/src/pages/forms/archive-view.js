// @ts-check
/**
 * The Archive tab: the closed Forms the viewer took part in, or every closed
 * Form for the Forms control group, all read-only. The closed-date window is
 * read on the server and always applied; the other filters narrow the rows
 * already read.
 */

import { h } from '../../lib/html.js';
import { formatDate } from '../../lib/format-datetime.js';
import { CLOSED_FORM_STATUSES } from '../../../form-types/contract.js';
import { dataTableView, sortRequested } from '../../views/data-table.js';
import { filterFormRows, formRows, latestClosedFirst } from './forms-model.js';
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

/** The table name the Archive tab sorts by, in the view and the reducer. */
export const ARCHIVE_TABLE = 'forms-archive';

/**
 * @returns {import('../../views/data-table.js').ColumnDescriptor<FormRow>[]}
 */
export function archiveColumns() {
  return [
    formTypeColumn(),
    employeeColumn(),
    {
      key: 'closedDate',
      label: 'Closed on',
      value: 'closedDate',
      sortable: true,
      format: (value) => formatDate(value),
    },
    formStatusColumn(),
    {
      // The record of who managed the Employee when the Form closed. It grants
      // nothing, which is why it is shown rather than used.
      key: 'managers',
      label: 'Managers at completion',
      value: (row) => row.managersAtCompletion.join(' · '),
    },
    formActionColumn((row) =>
      row.closedDate ? `closed ${formatDate(row.closedDate)}` : ''
    ),
  ];
}

/**
 * @param {FormsState} state
 * @param {FormsViewTools} tools
 * @returns {Node[]}
 */
export function archiveView(state, tools) {
  const route = state.routes.forms;
  return [
    h(
      'p',
      { className: 'cora-forms-hint' },
      state.chrome.permissions.isFormsControl
        ? 'Every Form that is Completed, Void or Cancelled. These are read-only.'
        : 'Forms you’ve been part of that are Completed, Void or Cancelled. These are read-only.'
    ),
    toolbarView(route, tools),
    tableView(state, tools),
  ];
}

/**
 * @param {FormsRoute} route
 * @param {FormsViewTools} tools
 */
function toolbarView(route, tools) {
  /** @param {string} key */
  const onFilter = (key) => (/** @type {any} */ event) =>
    tools.dispatch({
      type: 'forms/filter-changed',
      table: 'archive',
      key,
      value: event.target?.value ?? '',
    });
  /** @param {'from' | 'to'} key */
  const onWindow = (key) => (/** @type {any} */ event) =>
    tools.onWindowChanged(key, event.target?.value ?? '');
  const filters = route.archiveFilters;
  const closed = route.archive.window;
  return h(
    'div',
    { className: 'cora-forms-toolbar' },
    route.formTypes.length > 1
      ? field(
          'Form type',
          h(
            'select',
            {
              className: 'cora-capture-input',
              value: filters.formType,
              onchange: onFilter('formType'),
            },
            h('option', { value: '' }, 'All form types'),
            ...route.formTypes.map((formType) =>
              h('option', { value: formType.slug }, formType.formName)
            )
          )
        )
      : null,
    field(
      'Employee',
      h('input', {
        className: 'cora-capture-input',
        type: 'text',
        value: filters.text,
        placeholder: 'Anyone',
        oninput: onFilter('text'),
      })
    ),
    field(
      'Closed from',
      h('input', {
        className: 'cora-capture-input',
        type: 'date',
        value: closed.from,
        onchange: onWindow('from'),
      })
    ),
    field(
      'Closed to',
      h('input', {
        className: 'cora-capture-input',
        type: 'date',
        value: closed.to,
        onchange: onWindow('to'),
      })
    ),
    field(
      'Status',
      h(
        'select',
        {
          className: 'cora-capture-input',
          value: filters.status,
          onchange: onFilter('status'),
        },
        h('option', { value: '' }, 'All closed'),
        ...CLOSED_FORM_STATUSES.map((status) =>
          h('option', { value: status }, status)
        )
      )
    )
  );
}

/**
 * A labelled control. The label wraps the control, so the control is named by
 * its visible caption.
 *
 * @param {string} caption
 * @param {HTMLElement} control
 */
function field(caption, control) {
  return h(
    'label',
    { className: 'cora-forms-field' },
    h('span', {}, caption),
    control
  );
}

/**
 * @param {FormsState} state
 * @param {FormsViewTools} tools
 */
function tableView(state, tools) {
  const route = state.routes.forms;
  const pending = readStateView(route.archive.status);
  if (pending) return pending;
  const rows = filterFormRows(
    latestClosedFirst(
      formRows(
        route.archive.loaded,
        state.chrome.currentUser.id,
        state.chrome.permissions,
        route.today
      )
    ),
    route.archiveFilters
  );
  return h(
    'div',
    {},
    dataTableView({
      rows,
      columns: archiveColumns(),
      sort: route.archiveSort,
      onSort: (key) => tools.dispatch(sortRequested(ARCHIVE_TABLE, key)),
      emptyMessage: 'No closed forms in these dates.',
      rowKey: (row) => row.key,
      rowHref: (row) => row.href,
      rowClass: () => 'cora-case-row',
    }),
    h(
      'div',
      { className: 'cora-forms-tablefoot' },
      h('span', {}, `Showing ${rows.length}`),
      loadMoreView(route.archive.next, () => tools.onLoadMore('archive'))
    )
  );
}
