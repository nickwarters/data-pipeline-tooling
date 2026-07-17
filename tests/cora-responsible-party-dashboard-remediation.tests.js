// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ResponsiblePartyDashboard,
  caseTableInSection,
  findAll,
  todayStart,
  makeCase,
  oneSource,
  makeClient,
  whenIdle,
} from './helpers/cora-responsible-party-dashboard.js';

// Capability: open remediation actions, filters, and ordering.

// ===== Remediation actions table tests =====

test('ResponsiblePartyDashboard: remediation table includes cases with uncompleted actions', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      answers: {
        'q-needs': {
          value: 'No',
          remediationActions: [
            { id: 'ra-1', text: 'Fix the issue', completed: false },
          ],
        },
      },
    }),
    makeCase({ id: 'c2', answers: {} }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);
  const table = caseTableInSection(host, 'cora-rp-remediation');
  assert.ok(table, 'remediation table should exist');
  assert.equal(table.cases.length, 1);
  assert.equal(table.cases[0].id, 'c1');
});

test('ResponsiblePartyDashboard: remediation table excludes cases where all actions are completed', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      answers: {
        'q-needs': {
          value: 'No',
          remediationActions: [
            { id: 'ra-1', text: 'Fix the issue', completed: true },
          ],
        },
      },
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);
  const table = caseTableInSection(host, 'cora-rp-remediation');
  assert.ok(table, 'remediation table should exist');
  assert.equal(table.cases.length, 0);
});

test('ResponsiblePartyDashboard: remediation table renders row for each case with open actions', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      title: 'Case One',
      answers: {
        'q-1': {
          value: 'No',
          remediationActions: [
            { id: 'ra-1', text: 'Action 1', completed: false },
          ],
        },
      },
    }),
    makeCase({
      id: 'c2',
      title: 'Case Two',
      answers: {
        'q-2': {
          value: 'No',
          remediationActions: [
            { id: 'ra-2', text: 'Action 2', completed: false },
          ],
        },
      },
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);
  const rows = findAll(host, 'tr').filter((r) =>
    r.className.includes('cora-remediation-row')
  );
  assert.equal(rows.length, 2);
});

test('ResponsiblePartyDashboard: remediation row is flagged as overdue when dueDate is past', async () => {
  const yesterday = new Date(
    todayStart.getTime() - 24 * 60 * 60 * 1000
  ).toISOString();
  const tomorrow = new Date(
    todayStart.getTime() + 24 * 60 * 60 * 1000
  ).toISOString();
  const cases = [
    makeCase({
      id: 'c1',
      dueDate: yesterday,
      answers: {
        'q-1': {
          value: 'No',
          remediationActions: [{ id: 'ra-1', text: 'Fix', completed: false }],
        },
      },
    }),
    makeCase({
      id: 'c2',
      dueDate: tomorrow,
      answers: {
        'q-2': {
          value: 'No',
          remediationActions: [{ id: 'ra-2', text: 'Fix', completed: false }],
        },
      },
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);
  const rows = findAll(host, 'tr').filter((r) =>
    r.className.includes('cora-remediation-row')
  );
  const overdueRows = rows.filter((r) => r.className.includes('cora-overdue'));
  assert.equal(
    overdueRows.length,
    1,
    'only the past-due case gets overdue flag'
  );
});

test('ResponsiblePartyDashboard: remediation table filterable by case type via select change', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      caseType: 'example-review',
      answers: {
        'q-1': {
          value: 'No',
          remediationActions: [{ id: 'ra-1', text: 'A', completed: false }],
        },
      },
    }),
    makeCase({
      id: 'c2',
      caseType: 'audit-review',
      answers: {
        'q-2': {
          value: 'No',
          remediationActions: [{ id: 'ra-2', text: 'B', completed: false }],
        },
      },
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);

  const select = /** @type {any} */ (
    findAll(host, 'select').find(
      (s) => s.className === 'cora-rp-remediation-filter'
    )
  );
  assert.ok(select, 'remediation filter select should exist');
  select.value = 'example-review';
  for (const h of select._listeners['change'] ?? []) {
    h({ target: select });
  }

  const rows = findAll(host, 'tr').filter((r) =>
    r.className.includes('cora-remediation-row')
  );
  assert.equal(rows.length, 1, 'only matching case type should remain');
  const caseTypeCells = rows.map((r) => r._children[1]?.textContent);
  assert.ok(caseTypeCells.every((t) => t === 'example-review'));
});

test('ResponsiblePartyDashboard: sort by due date ascending puts earliest due first', async () => {
  const tomorrow = new Date(
    todayStart.getTime() + 24 * 60 * 60 * 1000
  ).toISOString();
  const nextWeek = new Date(
    todayStart.getTime() + 7 * 24 * 60 * 60 * 1000
  ).toISOString();
  const cases = [
    makeCase({
      id: 'c2',
      title: 'Case Two',
      dueDate: nextWeek,
      answers: {
        'q-1': {
          value: 'No',
          remediationActions: [{ id: 'ra-2', text: 'B', completed: false }],
        },
      },
    }),
    makeCase({
      id: 'c1',
      title: 'Case One',
      dueDate: tomorrow,
      answers: {
        'q-2': {
          value: 'No',
          remediationActions: [{ id: 'ra-1', text: 'A', completed: false }],
        },
      },
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);
  const rows = findAll(host, 'tr').filter((r) =>
    r.className.includes('cora-remediation-row')
  );
  assert.equal(rows[0]._children[0].textContent, 'Case One');
  assert.equal(rows[1]._children[0].textContent, 'Case Two');
});

test('ResponsiblePartyDashboard: select change with null e.target falls back to empty filter', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      caseType: 'example-review',
      answers: {
        'q-1': {
          value: 'No',
          remediationActions: [{ id: 'ra-1', text: 'A', completed: false }],
        },
      },
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);

  const select = /** @type {any} */ (
    findAll(host, 'select').find(
      (s) => s.className === 'cora-rp-remediation-filter'
    )
  );
  assert.ok(select, 'remediation filter select should exist');
  // Fire change with null target — covers `e.target?.value ?? ''` null branch
  for (const h of select._listeners['change'] ?? []) {
    h({ target: null });
  }
  const rows = findAll(host, 'tr').filter((r) =>
    r.className.includes('cora-remediation-row')
  );
  assert.equal(
    rows.length,
    1,
    'null target falls back to empty string → all remediation rows shown'
  );
});

test('ResponsiblePartyDashboard: remediation and messages tables fall back to case id when title is empty', async () => {
  const cases = [
    makeCase({
      id: 'case-no-title',
      title: '',
      answers: {
        'q-1': {
          value: 'No',
          remediationActions: [
            { id: 'ra-1', text: 'Action 1', completed: false },
          ],
        },
      },
      conversation: [
        {
          author: 'user-reviewer',
          timestamp: '2026-05-07T09:00:00Z',
          body: 'Q',
        },
      ],
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);

  const remediationTable = caseTableInSection(host, 'cora-rp-remediation');
  assert.ok(remediationTable, 'remediation table should exist');
  assert.equal(remediationTable.cases.length, 1);
  const remediationRefColumn = remediationTable._customColumns.find(
    (/** @type {any} */ c) => c.key === 'reference'
  );
  assert.equal(remediationRefColumn.getValue(cases[0]), 'case-no-title');

  const messagesTable = caseTableInSection(host, 'cora-rp-messages');
  assert.ok(messagesTable, 'messages table should exist');
  const messagesRefColumn = messagesTable._customColumns.find(
    (/** @type {any} */ c) => c.key === 'reference'
  );
  assert.equal(messagesRefColumn.getValue(cases[0]), 'case-no-title');
  const linkNode = messagesRefColumn.renderCell(cases[0]);
  assert.equal(linkNode.textContent, 'case-no-title');

  const actionsColumn = messagesTable._customColumns.find(
    (/** @type {any} */ c) => c.key === 'actions'
  );
  const btnNode = actionsColumn.renderCell(cases[0]);
  assert.equal(btnNode.getAttribute('aria-label'), 'Open case-no-title');
});

test('ResponsiblePartyDashboard: getOpenActions treats an answer with no remediationActions as empty', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      answers: {
        'q-1': {
          value: 'No',
          remediationActions: [
            { id: 'ra-1', text: 'Action 1', completed: false },
          ],
        },
        'q-2': { value: 'Yes' },
      },
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await whenIdle(host);

  const remediationTable = caseTableInSection(host, 'cora-rp-remediation');
  assert.ok(remediationTable, 'remediation table should exist');
  const actionColumn = remediationTable._customColumns.find(
    (/** @type {any} */ c) => c.key === 'action'
  );
  assert.equal(actionColumn.getValue(cases[0]), 'Action 1');
});
