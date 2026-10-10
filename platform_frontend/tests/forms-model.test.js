// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORM_ROLE_LABELS,
  filterFormRows,
  formLanes,
  formRouteFor,
  formRows,
} from '../src/pages/forms/forms-model.js';
import { oneToOne } from '../form-types/one-to-one.js';
import { makePermissions } from './helpers/fixtures.js';

// Capability: the Forms dashboard lists every Form the viewer may read, soonest
// due first, and sums the ones that need them into an employee and a manager
// lane.

/** @typedef {import('../src/sharepoint-client.js').FormItem} FormItem */

const TODAY = '2026-10-10';
const SAM = { loginName: 'sam', displayName: 'Sam Patel' };
const ANA = { loginName: 'ana', displayName: 'Ana Lopez' };
const JO = { loginName: 'jo', displayName: 'Jo Reid' };
const LEE = { loginName: 'lee', displayName: 'Lee Morgan' };

const FORMS = makePermissions({ isReviewer: false, canAccessForms: true });
const CONTROL = makePermissions({
  isReviewer: false,
  canAccessForms: true,
  isFormsControl: true,
});

/**
 * @param {string} id
 * @param {Record<string, unknown>} [fields]
 * @returns {FormItem}
 */
function item(id, fields = {}) {
  return {
    id,
    etag: '"1"',
    created: null,
    modified: null,
    problems: [],
    fields: /** @type {any} */ ({
      Employee: SAM,
      CurrentFirstLineManager: ANA,
      CurrentSecondLineManager: JO,
      Status: 'Pending',
      DueDate: '2026-10-20',
      Actions: [],
      ...fields,
    }),
  };
}

/** @param {FormItem[]} items @param {string} me @param {any} [caps] */
function rows(items, me, caps = FORMS) {
  return formRows([{ formType: oneToOne, items }], me, caps, TODAY);
}

/** @param {number} n @param {string} status */
function actions(n, status) {
  return Array.from({ length: n }, (_, i) => ({
    title: `Action ${i}`,
    dueDate: '',
    status,
    details: '',
  }));
}

/** @param {import('../src/evaluators/kpi-strip-model.js').KpiLane[]} lanes */
function counts(lanes) {
  return Object.fromEntries(
    lanes.map((lane) => [
      lane.role,
      Object.fromEntries(lane.tiles.map((tile) => [tile.key, tile.count])),
    ])
  );
}

test('a Form the access rule refuses is not listed, however the read returned it', () => {
  const listed = rows(
    [item('1'), item('2', { CurrentFirstLineManager: LEE })],
    'ana'
  );
  assert.deepEqual(
    listed.map((row) => row.item.id),
    ['1']
  );
  assert.deepEqual(rows([item('1')], 'lee'), []);
});

test('each row carries the role the viewer holds and links to the Form', () => {
  const [row] = rows([item('7')], 'jo');
  assert.equal(row.access.role, 'secondLineManager');
  assert.equal(row.access.canEdit, false);
  assert.equal(row.employeeName, 'Sam Patel');
  assert.equal(row.href, formRouteFor(oneToOne, '7'));
  assert.equal(row.href, '#/forms/one-to-one/7');
});

test('every role has a label, and the ones that cannot edit say so', () => {
  for (const [role, label] of Object.entries(FORM_ROLE_LABELS)) {
    const readOnly = role === 'secondLineManager' || role === 'formsControl';
    assert.equal(label.endsWith('view only'), readOnly, role);
  }
});

test('a Form past its due date counts the whole days it is over, and one due today is not over', () => {
  const [over, dueToday, undated] = rows(
    [
      item('1', { DueDate: '2026-10-08' }),
      item('2', { DueDate: TODAY }),
      item('3', { DueDate: null }),
    ],
    'sam'
  );
  assert.deepEqual(
    [over.overdueDays, dueToday.overdueDays, undated.overdueDays],
    [2, 0, 0]
  );
});

test('a closed Form past its due date is never overdue', () => {
  for (const Status of ['Completed', 'Void', 'Cancelled']) {
    const [row] = rows([item('1', { Status, DueDate: '2026-10-01' })], 'sam');
    assert.equal(row.overdueDays, 0, Status);
  }
});

test('rows are listed soonest due first, with undated Forms last', () => {
  const listed = rows(
    [
      item('a', { DueDate: null }),
      item('b', { DueDate: '2026-11-01' }),
      item('c', { DueDate: '2026-10-01' }),
    ],
    'sam'
  );
  assert.deepEqual(
    listed.map((row) => row.item.id),
    ['c', 'b', 'a']
  );
});

test('the employee lane counts overdue, due this week and pending Form Actions on their own Forms', () => {
  const lanes = formLanes(
    rows(
      [
        item('1', { DueDate: '2026-10-09', Actions: actions(2, 'Pending') }),
        item('2', { DueDate: TODAY, Actions: actions(1, 'Completed') }),
        item('3', { DueDate: '2026-10-16', Actions: actions(1, 'Cancelled') }),
        item('4', { DueDate: '2026-10-17', Actions: actions(1, 'Pending') }),
      ],
      'sam'
    ),
    TODAY
  );
  // Due this week is today through six days ahead: the 10th and the 16th, not
  // the 17th, and never the overdue Form.
  assert.deepEqual(counts(lanes), {
    employee: { overdue: 1, 'due-this-week': 2, 'open-actions': 3 },
  });
});

test('the manager lane covers the Forms the viewer is current first line manager on, and names their reports', () => {
  const lanes = formLanes(
    rows(
      [
        item('1', { DueDate: '2026-10-01' }),
        item('2', { DueDate: '2026-10-12' }),
        item('3', {
          Employee: { loginName: 'kim', displayName: 'Kim Shaw' },
          DueDate: '2026-12-01',
        }),
      ],
      'ana'
    ),
    TODAY
  );
  assert.deepEqual(counts(lanes), {
    manager: { overdue: 1, 'due-this-week': 1, open: 3 },
  });
  assert.equal(lanes[0].scopeLabel, '2 direct reports');
  assert.equal(lanes[0].totalItems, 3);
});

test('a tile with nothing in it is not drawn, and a lane with no tiles is not drawn', () => {
  const lanes = formLanes(
    rows([item('1', { DueDate: '2026-12-01' })], 'sam'),
    TODAY
  );
  assert.deepEqual(lanes, []);

  const managerOnly = formLanes(
    rows([item('1', { DueDate: '2026-12-01' })], 'ana'),
    TODAY
  );
  assert.deepEqual(counts(managerOnly), { manager: { open: 1 } });
  assert.equal(managerOnly[0].scopeLabel, '1 direct report');
});

test('a second line manager and the control group read Forms but get no lane', () => {
  const overdue = item('1', { DueDate: '2026-10-01' });
  assert.deepEqual(formLanes(rows([overdue], 'jo'), TODAY), []);
  assert.deepEqual(formLanes(rows([overdue], 'kim', CONTROL), TODAY), []);
});

test('the employee lane leads when the viewer has Forms of their own, and the manager lane leads otherwise', () => {
  const both = formLanes(
    rows(
      [
        item('1', { DueDate: TODAY }),
        item('2', { Employee: ANA, CurrentFirstLineManager: SAM }),
      ],
      'sam'
    ),
    TODAY
  );
  assert.deepEqual(
    both.map((lane) => [lane.role, lane.isPrimary]),
    [
      ['employee', true],
      ['manager', false],
    ]
  );
  const managerOnly = formLanes(rows([item('1')], 'ana'), TODAY);
  assert.equal(managerOnly[0].isPrimary, true);
});

test('the filters narrow by employee name, Form Type and role, and each is off when empty', () => {
  const listed = rows(
    [
      item('1'),
      item('2', {
        Employee: { loginName: 'kim', displayName: 'Kim Shaw' },
        CurrentSecondLineManager: ANA,
        CurrentFirstLineManager: JO,
      }),
    ],
    'ana'
  );
  const ids = (/** @type {any} */ filters) =>
    filterFormRows(listed, {
      text: '',
      formType: '',
      role: '',
      ...filters,
    }).map((row) => row.item.id);
  assert.deepEqual(ids({}), ['1', '2']);
  assert.deepEqual(ids({ text: '  sHAw ' }), ['2']);
  assert.deepEqual(ids({ role: 'firstLineManager' }), ['1']);
  assert.deepEqual(ids({ formType: 'one-to-one' }), ['1', '2']);
  assert.deepEqual(ids({ formType: 'coaching' }), []);
});
