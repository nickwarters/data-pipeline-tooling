// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, ConnectingStubEl, useElementClass } from './_dom-stub.js';
/** @typedef {import('./_dom-stub.js').StubEl} StubEl */

installDom();
useElementClass(ConnectingStubEl, { registry: true });

// ===== IMPORTS (after stubs) =====
const { ResponsiblePartyDashboard } =
  await import('../src/pages/cr-responsible-party-dashboard.js');
const { CRCaseTable } = await import('../src/components/cr-case-table.js');

/**
 * Find CRCaseTable instances by walking _children (custom-element tagNames
 * aren't set to the real tag name in h() output beyond what document.createElement gives).
 * @param {any} root
 * @returns {any[]}
 */
function findCaseTables(root) {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  function walk(n) {
    if (n instanceof CRCaseTable) out.push(n);
    for (const c of n._children ?? []) walk(c);
  }
  walk(root);
  return out;
}

/**
 * Find a section by className and return the CRCaseTable inside.
 * @param {any} root
 * @param {string} sectionClass
 */
function caseTableInSection(root, sectionClass) {
  for (const sec of findAll(root, 'section')) {
    if (sec.className === sectionClass) {
      const tables = findCaseTables(sec);
      return tables[0];
    }
  }
  return undefined;
}

// ===== HELPERS =====
/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').ListCasesFilter} ListCasesFilter */

/**
 * Walk the tree and collect all elements with matching tagName.
 * @param {any} root
 * @param {string} tag
 * @returns {StubEl[]}
 */
function findAll(root, tag) {
  /** @type {StubEl[]} */
  const out = [];
  /** @param {any} n */
  function walk(n) {
    if (n.tagName === tag.toUpperCase()) out.push(n);
    for (const c of n._children ?? []) walk(c);
  }
  walk(root);
  return out;
}

/** Flush a couple of microtask turns so post-fetch renders have happened. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const now = new Date();
const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

/** @returns {CaseRow} */
function makeCase(/** @type {Partial<CaseRow>} */ overrides = {}) {
  return {
    id: 'case-1',
    caseType: 'example-review',
    title: 'Example Review #1',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'etag-c1',
    ...overrides,
  };
}

/**
 * @param {CaseRow[]} rows
 * @param {ListCasesFilter[]} [callLog]
 */
function makeClient(rows, callLog) {
  return {
    async listCases(/** @type {ListCasesFilter} */ f) {
      callLog?.push(f);
      return rows.map((c) => ({ ...c }));
    },
  };
}

// ===== TESTS =====

test('ResponsiblePartyDashboard: renders nothing when client is null', async () => {
  const host = ResponsiblePartyDashboard({
    client: null,
    currentUserId: 'user-rp',
  });
  await flush();
  assert.equal(/** @type {any} */ (host)._children.length, 0);
});

test('ResponsiblePartyDashboard: renders nothing when currentUserId is empty', async () => {
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient([])),
    currentUserId: '',
  });
  await flush();
  assert.equal(/** @type {any} */ (host)._children.length, 0);
});

test('ResponsiblePartyDashboard: calls listCases with responsibleParty filter', async () => {
  /** @type {ListCasesFilter[]} */
  const calls = [];
  ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient([], calls)),
    currentUserId: 'user-rp',
  });
  await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { responsibleParty: 'user-rp' });
});

test('ResponsiblePartyDashboard: renders 3 sections after fetch resolves', async () => {
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient([])),
    currentUserId: 'user-rp',
  });
  await flush();
  // outcome section + remediation section + messages section
  assert.equal(/** @type {any} */ (host)._children.length, 3);
});

// ===== Outcome summary tests =====

/** @param {any} host @returns {number | undefined} */
function outcomeTotal(host) {
  const dd = findAll(host, 'dd').find(
    (d) => d.className === 'cr-rp-outcome-total'
  );
  return dd ? Number(dd.textContent) : undefined;
}

/** @param {any} host @param {string} label @returns {number | undefined} */
function outcomeCount(host, label) {
  const dd = findAll(host, 'dd').find(
    (d) => d.className === `cr-rp-outcome-${label.toLowerCase()}`
  );
  return dd ? Number(dd.textContent) : undefined;
}

/** @param {any} host @param {string} month @returns {Record<string, number> | null} */
function outcomeMonthRow(host, month) {
  const section = findAll(host, 'section').find(
    (s) => s.className === 'cr-rp-outcome-summary'
  );
  if (!section) return null;
  const table = findAll(section, 'table')[0];
  if (!table) return null;
  const rows = findAll(table, 'tr');
  const [headerRow, ...bodyRows] = rows;
  const labels = headerRow._children.slice(1).map((th) => th.textContent);
  const row = bodyRows.find((r) => r._children[0].textContent === month);
  if (!row) return null;
  /** @type {Record<string, number>} */
  const counts = {};
  labels.forEach((label, i) => {
    counts[label] = Number(row._children[i + 1].textContent);
  });
  return counts;
}

test('ResponsiblePartyDashboard: outcome summary includes completed cases within last 12 months', async () => {
  const recentMonth = new Date(todayStart);
  recentMonth.setMonth(recentMonth.getMonth() - 2);
  const cases = [
    makeCase({
      id: 'c1',
      status: 'Completed',
      completedAt: recentMonth.toISOString(),
      outcome: 'Pass',
    }),
    makeCase({
      id: 'c2',
      status: 'Completed',
      completedAt: recentMonth.toISOString(),
      outcome: 'Fail',
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
  });
  await flush();
  assert.equal(outcomeTotal(host), 2);
});

test('ResponsiblePartyDashboard: outcome summary excludes completed cases older than 12 months', async () => {
  const old = new Date(todayStart);
  old.setMonth(old.getMonth() - 13);
  const recent = new Date(todayStart);
  recent.setMonth(recent.getMonth() - 1);
  const cases = [
    makeCase({
      id: 'c1',
      status: 'Completed',
      completedAt: old.toISOString(),
      outcome: 'Pass',
    }),
    makeCase({
      id: 'c2',
      status: 'Completed',
      completedAt: recent.toISOString(),
      outcome: 'Pass',
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
  });
  await flush();
  assert.equal(outcomeTotal(host), 1, 'only the recent case counts');
});

test('ResponsiblePartyDashboard: outcome summary excludes in-progress cases', async () => {
  const cases = [
    makeCase({ id: 'c1', status: 'In-progress', completedAt: null }),
    makeCase({
      id: 'c2',
      status: 'Completed',
      completedAt: todayStart.toISOString(),
      outcome: 'Pass',
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
  });
  await flush();
  assert.equal(outcomeTotal(host), 1);
});

test('ResponsiblePartyDashboard: outcome summary groups by outcome type', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      status: 'Completed',
      completedAt: todayStart.toISOString(),
      outcome: 'Pass',
    }),
    makeCase({
      id: 'c2',
      status: 'Completed',
      completedAt: todayStart.toISOString(),
      outcome: 'Pass',
    }),
    makeCase({
      id: 'c3',
      status: 'Completed',
      completedAt: todayStart.toISOString(),
      outcome: 'Fail',
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
  });
  await flush();
  assert.equal(outcomeCount(host, 'Pass'), 2);
  assert.equal(outcomeCount(host, 'Fail'), 1);
});

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
  });
  await flush();
  const table = caseTableInSection(host, 'cr-rp-remediation');
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
  });
  await flush();
  const table = caseTableInSection(host, 'cr-rp-remediation');
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
  });
  await flush();
  const rows = findAll(host, 'tr').filter((r) =>
    r.className.includes('cr-remediation-row')
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
  });
  await flush();
  const rows = findAll(host, 'tr').filter((r) =>
    r.className.includes('cr-remediation-row')
  );
  const overdueRows = rows.filter((r) => r.className.includes('cr-overdue'));
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
  });
  await flush();

  const select = /** @type {any} */ (
    findAll(host, 'select').find(
      (s) => s.className === 'cr-rp-remediation-filter'
    )
  );
  assert.ok(select, 'remediation filter select should exist');
  select.value = 'example-review';
  for (const h of select._listeners['change'] ?? []) {
    h({ target: select });
  }

  const rows = findAll(host, 'tr').filter((r) =>
    r.className.includes('cr-remediation-row')
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
  });
  await flush();
  const rows = findAll(host, 'tr').filter((r) =>
    r.className.includes('cr-remediation-row')
  );
  assert.equal(rows[0]._children[0].textContent, 'Case One');
  assert.equal(rows[1]._children[0].textContent, 'Case Two');
});

// ===== Unread messages table tests =====

test('ResponsiblePartyDashboard: unread messages includes cases with reviewer messages after RP last reply', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      conversation: [
        {
          author: 'user-rp',
          timestamp: '2026-05-07T09:00:00Z',
          body: 'My reply',
        },
        {
          author: 'user-reviewer',
          timestamp: '2026-05-07T10:00:00Z',
          body: 'Follow up question',
        },
      ],
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
  });
  await flush();
  const table = caseTableInSection(host, 'cr-rp-messages');
  assert.ok(table);
  assert.equal(table.cases.length, 1);
  assert.equal(table.cases[0].id, 'c1');
});

test('ResponsiblePartyDashboard: unread messages includes cases with reviewer messages when RP never replied', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      conversation: [
        {
          author: 'user-reviewer',
          timestamp: '2026-05-07T09:00:00Z',
          body: 'Please clarify',
        },
      ],
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
  });
  await flush();
  const table = caseTableInSection(host, 'cr-rp-messages');
  assert.ok(table);
  assert.equal(table.cases.length, 1);
});

test('ResponsiblePartyDashboard: unread messages excludes cases where RP replied after all reviewer messages', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      conversation: [
        {
          author: 'user-reviewer',
          timestamp: '2026-05-07T09:00:00Z',
          body: 'Question',
        },
        {
          author: 'user-rp',
          timestamp: '2026-05-07T10:00:00Z',
          body: 'Answer',
        },
      ],
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
  });
  await flush();
  const table = caseTableInSection(host, 'cr-rp-messages');
  assert.ok(table);
  assert.equal(table.cases.length, 0);
});

test('ResponsiblePartyDashboard: unread messages excludes cases with empty conversation', async () => {
  const cases = [makeCase({ id: 'c1', conversation: [] })];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
  });
  await flush();
  const table = caseTableInSection(host, 'cr-rp-messages');
  assert.ok(table);
  assert.equal(table.cases.length, 0);
});

test('ResponsiblePartyDashboard: unread messages section uses cr-case-table with only unread cases', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      title: 'Case One',
      conversation: [
        {
          author: 'user-reviewer',
          timestamp: '2026-05-07T09:00:00Z',
          body: 'Q',
        },
      ],
    }),
    makeCase({
      id: 'c2',
      title: 'Case Two',
      conversation: [
        {
          author: 'user-reviewer',
          timestamp: '2026-05-07T09:00:00Z',
          body: 'Q',
        },
      ],
    }),
    makeCase({ id: 'c3', title: 'Case Three', conversation: [] }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
  });
  await flush();
  const allTables = findCaseTables(host);
  assert.equal(
    allTables.length,
    2,
    'should have two cr-case-table instances (remediation + unread)'
  );
  const unreadTable = caseTableInSection(host, 'cr-rp-messages');
  assert.ok(unreadTable, 'unread section should contain a cr-case-table');
  assert.equal(
    unreadTable.cases.length,
    2,
    'table should have the two unread cases'
  );
});

test('ResponsiblePartyDashboard: cr-case-open on unread table invokes onOpenConversation with the case row', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      conversation: [
        {
          author: 'user-reviewer',
          timestamp: '2026-05-07T09:00:00Z',
          body: 'Q',
        },
      ],
    }),
  ];
  /** @type {any[]} */
  const opened = [];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    onOpenConversation: (caseRow) => opened.push(caseRow),
  });
  await flush();

  const unreadTable = caseTableInSection(host, 'cr-rp-messages');
  assert.ok(unreadTable, 'unread section should contain a cr-case-table');
  const handler = unreadTable._listeners['cr-case-open']?.[0];
  assert.ok(handler, 'cr-case-table should have a cr-case-open listener');
  const caseRow = { id: 'c1', caseType: 'example-review' };
  handler({ detail: { caseId: 'c1', caseRow } });
  assert.equal(opened.length, 1);
  assert.equal(opened[0], caseRow);
});

test('ResponsiblePartyDashboard: cr-case-open with no onOpenConversation prop does not throw', async () => {
  const cases = [
    makeCase({
      id: 'c1',
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
  });
  await flush();

  const unreadTable = caseTableInSection(host, 'cr-rp-messages');
  const handler = unreadTable._listeners['cr-case-open']?.[0];
  assert.doesNotThrow(() =>
    handler({ detail: { caseId: 'c1', caseRow: { id: 'c1' } } })
  );
});

test('ResponsiblePartyDashboard: Open button click invokes onOpenConversation with the case row', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      conversation: [
        {
          author: 'user-reviewer',
          timestamp: '2026-05-07T09:00:00Z',
          body: 'Q',
        },
      ],
    }),
  ];
  /** @type {any[]} */
  const opened = [];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    onOpenConversation: (caseRow) => opened.push(caseRow),
  });
  await flush();

  const messagesSection = findAll(host, 'section').find(
    (s) => s.className === 'cr-rp-messages'
  );
  assert.ok(messagesSection, 'messages section should exist');
  const openBtn = findAll(messagesSection, 'button').find(
    (b) => b.className === 'cr-case-open-btn'
  );
  assert.ok(openBtn, 'Open button should exist in messages table');

  for (const h of openBtn._listeners['click'] ?? []) {
    h({ target: openBtn });
  }

  assert.equal(opened.length, 1, 'onOpenConversation should be called');
  assert.equal(opened[0].id, 'c1');
});

test('ResponsiblePartyDashboard: Open button click with no onOpenConversation prop does not throw', async () => {
  const cases = [
    makeCase({
      id: 'c1',
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
  });
  await flush();

  const messagesSection = findAll(host, 'section').find(
    (s) => s.className === 'cr-rp-messages'
  );
  assert.ok(messagesSection, 'messages section should exist');
  const openBtn = findAll(messagesSection, 'button').find(
    (b) => b.className === 'cr-case-open-btn'
  );
  assert.ok(openBtn, 'Open button should exist in messages table');

  assert.doesNotThrow(() => {
    for (const h of openBtn._listeners['click'] ?? []) {
      h({ target: openBtn });
    }
  });
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
  });
  await flush();

  const select = /** @type {any} */ (
    findAll(host, 'select').find(
      (s) => s.className === 'cr-rp-remediation-filter'
    )
  );
  assert.ok(select, 'remediation filter select should exist');
  // Fire change with null target — covers `e.target?.value ?? ''` null branch
  for (const h of select._listeners['change'] ?? []) {
    h({ target: null });
  }
  const rows = findAll(host, 'tr').filter((r) =>
    r.className.includes('cr-remediation-row')
  );
  assert.equal(
    rows.length,
    1,
    'null target falls back to empty string → all remediation rows shown'
  );
});

test('ResponsiblePartyDashboard: two completed cases in same month+outcome increments count (covers ?? 0 and !monthMap[month] false branch)', async () => {
  const recentMonth = new Date();
  recentMonth.setDate(1);
  const iso = recentMonth.toISOString().slice(0, 10);

  const cases = [
    makeCase({
      id: 'c1',
      status: /** @type {'Completed'} */ ('Completed'),
      completedAt: `${iso}T10:00:00Z`,
      outcome: 'Pass',
    }),
    makeCase({
      id: 'c2',
      status: /** @type {'Completed'} */ ('Completed'),
      completedAt: `${iso}T11:00:00Z`,
      outcome: 'Pass',
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
  });
  await flush();

  assert.equal(outcomeTotal(host), 2);
  assert.equal(
    outcomeCount(host, 'Pass'),
    2,
    'two cases with same outcome increment count'
  );
  const month = iso.slice(0, 7);
  const monthRow = outcomeMonthRow(host, month);
  assert.equal(
    monthRow?.['Pass'],
    2,
    'same outcome in same month accumulates count'
  );
});

test('ResponsiblePartyDashboard: case with null outcome uses "Unknown" label', async () => {
  const recentMonth = new Date();
  recentMonth.setDate(1);
  const iso = recentMonth.toISOString().slice(0, 10);

  const cases = [
    makeCase({
      id: 'c1',
      status: /** @type {'Completed'} */ ('Completed'),
      completedAt: `${iso}T10:00:00Z`,
      outcome: /** @type {any} */ (null),
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
  });
  await flush();

  assert.equal(
    outcomeCount(host, 'Unknown'),
    1,
    'null outcome falls back to "Unknown" label'
  );
});

test('ResponsiblePartyDashboard: months are sorted chronologically and a month missing an outcome renders 0', async () => {
  // Three distinct months, inserted out of chronological order (earliest,
  // latest, middle) so Array.prototype.sort's comparator is exercised in
  // both directions (a < b and a >= b) while sorting by month string.
  const earliestMonth = new Date(todayStart);
  earliestMonth.setMonth(earliestMonth.getMonth() - 3);
  earliestMonth.setDate(1);
  const latestMonth = new Date(todayStart);
  latestMonth.setMonth(latestMonth.getMonth() - 1);
  latestMonth.setDate(1);
  const middleMonth = new Date(todayStart);
  middleMonth.setMonth(middleMonth.getMonth() - 2);
  middleMonth.setDate(1);

  const cases = [
    makeCase({
      id: 'c1',
      status: /** @type {'Completed'} */ ('Completed'),
      completedAt: earliestMonth.toISOString(),
      outcome: 'Pass',
    }),
    makeCase({
      id: 'c2',
      status: /** @type {'Completed'} */ ('Completed'),
      completedAt: latestMonth.toISOString(),
      outcome: 'Pass',
    }),
    makeCase({
      id: 'c3',
      status: /** @type {'Completed'} */ ('Completed'),
      completedAt: latestMonth.toISOString(),
      outcome: 'Fail',
    }),
    // Middle month is missing the "Fail" outcome, so its table cell must
    // fall back to 0.
    makeCase({
      id: 'c4',
      status: /** @type {'Completed'} */ ('Completed'),
      completedAt: middleMonth.toISOString(),
      outcome: 'Pass',
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
  });
  await flush();

  const middleRow = outcomeMonthRow(
    host,
    middleMonth.toISOString().slice(0, 7)
  );
  assert.equal(
    middleRow?.['Fail'],
    0,
    'month missing an outcome renders 0 for that column'
  );

  const latestRow = outcomeMonthRow(
    host,
    latestMonth.toISOString().slice(0, 7)
  );
  assert.equal(latestRow?.['Pass'], 1);
  assert.equal(latestRow?.['Fail'], 1);

  const earliestRow = outcomeMonthRow(
    host,
    earliestMonth.toISOString().slice(0, 7)
  );
  assert.equal(earliestRow?.['Pass'], 1);
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
  });
  await flush();

  const remediationTable = caseTableInSection(host, 'cr-rp-remediation');
  assert.ok(remediationTable, 'remediation table should exist');
  assert.equal(remediationTable.cases.length, 1);
  const remediationRefColumn = remediationTable._customColumns.find(
    (/** @type {any} */ c) => c.key === 'reference'
  );
  assert.equal(remediationRefColumn.getValue(cases[0]), 'case-no-title');

  const messagesTable = caseTableInSection(host, 'cr-rp-messages');
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

test('ResponsiblePartyDashboard: lastMessage column falls back to null/em-dash when the last message has no timestamp', async () => {
  const cases = [
    makeCase({
      id: 'c1',
      conversation: [
        /** @type {any} */ ({ author: 'user-reviewer', body: 'Q' }),
      ],
    }),
  ];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
  });
  await flush();

  const messagesTable = caseTableInSection(host, 'cr-rp-messages');
  assert.ok(messagesTable, 'messages table should exist');
  const lastMessageColumn = messagesTable._customColumns.find(
    (/** @type {any} */ c) => c.key === 'lastMessage'
  );
  assert.equal(lastMessageColumn.getValue(cases[0]), null);
  assert.equal(lastMessageColumn.renderCell(cases[0]), '—');
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
  });
  await flush();

  const remediationTable = caseTableInSection(host, 'cr-rp-remediation');
  assert.ok(remediationTable, 'remediation table should exist');
  const actionColumn = remediationTable._customColumns.find(
    (/** @type {any} */ c) => c.key === 'action'
  );
  assert.equal(actionColumn.getValue(cases[0]), 'Action 1');
});
