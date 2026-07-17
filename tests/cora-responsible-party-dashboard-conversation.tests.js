// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ResponsiblePartyDashboard,
  findCaseTables,
  caseTableInSection,
  findAll,
  makeCase,
  oneSource,
  makeClient,
  waitForRender,
} from './helpers/cora-responsible-party-dashboard.js';

// Capability: unread conversations and open actions.

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
    allCaseSources: oneSource,
  });
  await waitForRender(host);
  const table = caseTableInSection(host, 'cora-rp-messages');
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
    allCaseSources: oneSource,
  });
  await waitForRender(host);
  const table = caseTableInSection(host, 'cora-rp-messages');
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
    allCaseSources: oneSource,
  });
  await waitForRender(host);
  const table = caseTableInSection(host, 'cora-rp-messages');
  assert.ok(table);
  assert.equal(table.cases.length, 0);
});

test('ResponsiblePartyDashboard: unread messages excludes cases with empty conversation', async () => {
  const cases = [makeCase({ id: 'c1', conversation: [] })];
  const host = ResponsiblePartyDashboard({
    client: /** @type {any} */ (makeClient(cases)),
    currentUserId: 'user-rp',
    allCaseSources: oneSource,
  });
  await waitForRender(host);
  const table = caseTableInSection(host, 'cora-rp-messages');
  assert.ok(table);
  assert.equal(table.cases.length, 0);
});

test('ResponsiblePartyDashboard: unread messages section uses cora-case-table with only unread cases', async () => {
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
    allCaseSources: oneSource,
  });
  await waitForRender(host);
  const allTables = findCaseTables(host);
  assert.equal(
    allTables.length,
    2,
    'should have two cora-case-table instances (remediation + unread)'
  );
  const unreadTable = caseTableInSection(host, 'cora-rp-messages');
  assert.ok(unreadTable, 'unread section should contain a cora-case-table');
  assert.equal(
    unreadTable.cases.length,
    2,
    'table should have the two unread cases'
  );
});

test('ResponsiblePartyDashboard: cora-case-open on unread table invokes onOpenConversation with the case row', async () => {
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
    allCaseSources: oneSource,
    onOpenConversation: (caseRow) => opened.push(caseRow),
  });
  await waitForRender(host);

  const unreadTable = caseTableInSection(host, 'cora-rp-messages');
  assert.ok(unreadTable, 'unread section should contain a cora-case-table');
  const handler = unreadTable._listeners['cora-case-open']?.[0];
  assert.ok(handler, 'cora-case-table should have a cora-case-open listener');
  const caseRow = { id: 'c1', caseType: 'example-review' };
  handler({ detail: { caseId: 'c1', caseRow } });
  assert.equal(opened.length, 1);
  assert.equal(opened[0], caseRow);
});

test('ResponsiblePartyDashboard: cora-case-open with no onOpenConversation prop does not throw', async () => {
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
    allCaseSources: oneSource,
  });
  await waitForRender(host);

  const unreadTable = caseTableInSection(host, 'cora-rp-messages');
  const handler = unreadTable._listeners['cora-case-open']?.[0];
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
    allCaseSources: oneSource,
    onOpenConversation: (caseRow) => opened.push(caseRow),
  });
  await waitForRender(host);

  const messagesSection = findAll(host, 'section').find(
    (s) => s.className === 'cora-rp-messages'
  );
  assert.ok(messagesSection, 'messages section should exist');
  const openBtn = findAll(messagesSection, 'button').find(
    (b) => b.className === 'cora-case-open-btn'
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
    allCaseSources: oneSource,
  });
  await waitForRender(host);

  const messagesSection = findAll(host, 'section').find(
    (s) => s.className === 'cora-rp-messages'
  );
  assert.ok(messagesSection, 'messages section should exist');
  const openBtn = findAll(messagesSection, 'button').find(
    (b) => b.className === 'cora-case-open-btn'
  );
  assert.ok(openBtn, 'Open button should exist in messages table');

  assert.doesNotThrow(() => {
    for (const h of openBtn._listeners['click'] ?? []) {
      h({ target: openBtn });
    }
  });
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
    allCaseSources: oneSource,
  });
  await waitForRender(host);

  const messagesTable = caseTableInSection(host, 'cora-rp-messages');
  assert.ok(messagesTable, 'messages table should exist');
  const lastMessageColumn = messagesTable._customColumns.find(
    (/** @type {any} */ c) => c.key === 'lastMessage'
  );
  assert.equal(lastMessageColumn.getValue(cases[0]), null);
  assert.equal(lastMessageColumn.renderCell(cases[0]), '—');
});
