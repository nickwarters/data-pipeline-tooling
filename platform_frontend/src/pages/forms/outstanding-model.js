// @ts-check
/**
 * What the Forms dashboard shows, worked out from the Forms it read: one row
 * per Form the viewer may read, and the "As employee" and "As manager" lanes
 * above the table. Pure, so every rule here is tested without a page.
 *
 * Who may read a Form, and in which role, is `form-access.js`'s answer; this
 * module only asks it.
 */

import { formAccess } from '../../services/form-access.js';
import {
  daysBetweenDateKeys,
  isDateKey,
  shiftDateKey,
} from '../../lib/local-calendar.js';

/** @typedef {import('../../../form-types/contract.js').FormTypeDefinition} FormTypeDefinition */
/** @typedef {import('../../sharepoint-client.js').FormItem} FormItem */
/** @typedef {import('../../sharepoint-client.js').FormAction} FormAction */
/** @typedef {import('../../services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../../services/form-access.js').FormAccess} FormAccess */
/** @typedef {import('../../services/form-access.js').FormRole} FormRole */
/** @typedef {import('../../evaluators/kpi-strip-model.js').KpiLane} KpiLane */
/** @typedef {import('../../evaluators/kpi-strip-model.js').KpiTile} KpiTile */

/**
 * The Forms one read returned for one Form Type.
 *
 * @typedef {{ formType: FormTypeDefinition, items: FormItem[] }} LoadedForms
 */

/**
 * One row of the Forms table: the Form, what the viewer may do with it, and the
 * values its cells show, worked out once so the view only draws them.
 *
 * `overdueDays` is how many days past its due date the Form is, and `0` when it
 * is not overdue or has no due date.
 *
 * @typedef {{
 *   key: string,
 *   formType: FormTypeDefinition,
 *   item: FormItem,
 *   access: FormAccess,
 *   employeeName: string,
 *   dueDate: string,
 *   overdueDays: number,
 *   status: string,
 *   href: string
 * }} FormRow
 */

/** The days a "Due this week" tile looks ahead, today included. */
const WEEK_DAYS = 7;

/** The Form Action status still waiting on someone. */
const PENDING_ACTION = 'Pending';

/**
 * How each role reads in the "Your role" column. The two that cannot edit say
 * so, because the Action button alone is easy to miss.
 *
 * @type {Readonly<Record<FormRole, string>>}
 */
export const FORM_ROLE_LABELS = Object.freeze({
  employee: 'Employee',
  firstLineManager: 'Manager',
  secondLineManager: 'Second line manager · view only',
  formsControl: 'Forms control · view only',
});

/**
 * The hash a Form opens at.
 *
 * @param {FormTypeDefinition} formType
 * @param {string} id
 * @returns {string}
 */
export function formRouteFor(formType, id) {
  return `#/forms/${encodeURIComponent(formType.slug)}/${encodeURIComponent(id)}`;
}

/**
 * Every Form the viewer may read, as table rows, soonest due first. A Form the
 * read returned but the access rule refuses is dropped here, so a wide read
 * never becomes a wide view.
 *
 * @param {LoadedForms[]} loaded
 * @param {string} me the viewer's account
 * @param {Capabilities} caps
 * @param {string} today `YYYY-MM-DD`
 * @returns {FormRow[]}
 */
export function formRows(loaded, me, caps, today) {
  /** @type {FormRow[]} */
  const rows = [];
  for (const { formType, items } of loaded) {
    for (const item of items) {
      const access = formAccess(item, me, caps);
      if (!access.canRead) continue;
      const dueDate = dateKeyOf(item.fields.DueDate);
      rows.push({
        key: `${formType.slug}:${item.id}`,
        formType,
        item,
        access,
        employeeName: personName(item.fields.Employee),
        dueDate,
        overdueDays:
          dueDate === '' ? 0 : Math.max(0, daysBetweenDateKeys(dueDate, today)),
        status:
          typeof item.fields.Status === 'string' ? item.fields.Status : '',
        href: formRouteFor(formType, item.id),
      });
    }
  }
  return rows.sort(bySoonestDue);
}

/**
 * The lanes above the table: "As employee" over the viewer's own Forms and "As
 * manager" over the Forms they are the current first line manager on. A lane
 * shows only the tiles with something in them, and a lane with none is not
 * shown. A second line manager and the control group get no lane: they read
 * those Forms but have nothing to do on them.
 *
 * @param {FormRow[]} rows
 * @param {string} today `YYYY-MM-DD`
 * @returns {KpiLane[]}
 */
export function formLanes(rows, today) {
  const own = rows.filter((row) => row.access.roles.includes('employee'));
  const managed = rows.filter((row) =>
    row.access.roles.includes('firstLineManager')
  );
  const reports = new Set(managed.map((row) => row.employeeName)).size;

  return [
    lane({
      role: 'employee',
      label: 'As employee',
      scopeLabel: 'your own forms',
      isPrimary: true,
      rows: own,
      tiles: [
        overdueTile(own),
        dueThisWeekTile(own, today, 'progress'),
        tile('open-actions', 'Open actions', 'hold', pendingActions(own)),
      ],
    }),
    lane({
      role: 'manager',
      label: 'As manager',
      scopeLabel: `${reports} direct ${reports === 1 ? 'report' : 'reports'}`,
      isPrimary: own.length === 0,
      rows: managed,
      tiles: [
        overdueTile(managed),
        dueThisWeekTile(managed, today, 'awaiting'),
        tile('open', 'Open', 'progress', managed.length),
      ],
    }),
  ].filter((built) => built !== null);
}

/**
 * The rows a person filter, a Form Type filter and a role filter leave. Each
 * filter is off when empty. The person filter matches the Employee's name,
 * ignoring case.
 *
 * @param {FormRow[]} rows
 * @param {{ text: string, formType: string, role: string }} filters
 * @returns {FormRow[]}
 */
export function filterFormRows(rows, { text, formType, role }) {
  const needle = text.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (needle === '' || row.employeeName.toLowerCase().includes(needle)) &&
      (formType === '' || row.formType.slug === formType) &&
      (role === '' || row.access.role === role)
  );
}

/**
 * @param {{
 *   role: string,
 *   label: string,
 *   scopeLabel: string,
 *   isPrimary: boolean,
 *   rows: FormRow[],
 *   tiles: KpiTile[]
 * }} spec
 * @returns {KpiLane | null}
 */
function lane({ role, label, scopeLabel, isPrimary, rows, tiles }) {
  const shown = tiles.filter((built) => built.count > 0);
  if (shown.length === 0) return null;
  return {
    role,
    label,
    scopeLabel,
    isPrimary,
    defaultOpen: true,
    totalItems: rows.length,
    tiles: shown,
  };
}

/**
 * @param {string} key
 * @param {string} label
 * @param {string} tone
 * @param {number} count
 * @returns {KpiTile}
 */
function tile(key, label, tone, count) {
  return { key, label, tone, count, defaultExpanded: false, breakdown: null };
}

/** @param {FormRow[]} rows */
function overdueTile(rows) {
  return tile(
    'overdue',
    'Overdue',
    'overdue',
    rows.filter((row) => row.overdueDays > 0).length
  );
}

/**
 * Forms due from today to six days ahead. An overdue Form is not "due this
 * week": it has its own tile, and counting it twice would double the lane.
 *
 * @param {FormRow[]} rows
 * @param {string} today
 * @param {string} tone
 */
function dueThisWeekTile(rows, today, tone) {
  const last = shiftDateKey(today, WEEK_DAYS - 1);
  return tile(
    'due-this-week',
    'Due this week',
    tone,
    rows.filter(
      (row) => row.dueDate !== '' && row.dueDate >= today && row.dueDate <= last
    ).length
  );
}

/**
 * The Form Actions still pending across these Forms. Each Form Type says which
 * column, if any, holds its Actions.
 *
 * @param {FormRow[]} rows
 * @returns {number}
 */
function pendingActions(rows) {
  let count = 0;
  for (const row of rows) {
    const section = row.formType.sections.find(
      (candidate) => candidate.sectionType === 'actions'
    );
    if (section?.sectionType !== 'actions') continue;
    const actions = row.item.fields[section.itemField];
    if (!Array.isArray(actions)) continue;
    count += actions.filter(
      (/** @type {FormAction} */ action) => action.status === PENDING_ACTION
    ).length;
  }
  return count;
}

/** @param {FormRow} a @param {FormRow} b */
function bySoonestDue(a, b) {
  // A Form with no due date has nothing to be late for, so it goes last.
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === '') return 1;
    if (b.dueDate === '') return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** @param {unknown} value */
function dateKeyOf(value) {
  return isDateKey(value) ? /** @type {string} */ (value) : '';
}

/** @param {unknown} value */
function personName(value) {
  const person =
    /** @type {{ displayName?: unknown, loginName?: unknown } | null} */ (
      value
    );
  if (typeof person?.displayName === 'string' && person.displayName !== '') {
    return person.displayName;
  }
  return typeof person?.loginName === 'string' ? person.loginName : '';
}
