// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
/** @typedef {import('./_dom-stub.js').StubEl} StubEl */

installDom();

// ===== IMPORTS (after stubs) =====
const { ControlsDashboard, PAGE_SIZE, openAppealOf } =
  await import('../src/components/collections/cora-controls-dashboard.js');
const { MockSharePointClient } =
  await import('../src/services/mock-sharepoint-client.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').Appeal} Appeal */

// ===== HELPERS =====
/** Flush a couple of microtask turns so post-fetch renders have happened. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * @param {any} root
 * @param {string} tagName
 * @returns {StubEl[]}
 */
function findAll(root, tagName) {
  /** @type {StubEl[]} */
  const out = [];
  /** @param {StubEl} n */
  function walk(n) {
    if (n.tagName === tagName.toUpperCase()) out.push(n);
    for (const c of n._children) walk(c);
  }
  walk(root);
  return out;
}

/** @param {any} root @param {string} className */
function findSection(root, className) {
  return findAll(root, 'section').find((s) => s.className === className);
}

/**
 * @param {Partial<Appeal>} [overrides]
 * @returns {Appeal}
 */
function appeal(overrides = {}) {
  return {
    id: 'a1',
    appellant: 'jo.owner',
    at: '2026-06-01T09:00:00Z',
    rationale: 'The outcome was too harsh.',
    state: 'raised',
    ...overrides,
  };
}

/**
 * @param {Partial<CaseRow>} [overrides]
 * @returns {CaseRow}
 */
function completedCase(overrides = {}) {
  return {
    id: 'c-1',
    caseType: 'complaints',
    title: 'Case 1',
    status: 'Completed',
    assignedReviewer: 'rev',
    responsibleParty: 'adv',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: '2026-05-30T00:00:00Z',
    etag: 'e1',
    ...overrides,
  };
}

/** Single-source list, for tests that don't care about fan-out. */
const oneSource = [
  {
    slug: 'complaints',
    listName: 'Cases-Complaints',
    displayName: 'Complaints',
  },
];

// ===== PREDICATE TESTS =====

test('openAppealOf: returns the open appeal, ignoring resolved ones', () => {
  const open = appeal({ id: 'open', state: 'raised' });
  const c = completedCase({
    appeals: [appeal({ id: 'old', state: 'resolved' }), open],
  });
  assert.equal(openAppealOf(c)?.id, 'open');
});

test('openAppealOf: returns null when nothing is open', () => {
  assert.equal(openAppealOf(completedCase()), null);
});

// ===== COMPONENT TESTS =====

test('ControlsDashboard: reads the indexed open-appeal set server-side, oldest raised first, with no full-Completed fetch', async () => {
  /** @type {any[]} */
  const calls = [];
  const client = {
    async listCases(/** @type {any} */ f, /** @type {any} */ opts) {
      calls.push({ filter: f, opts });
      return [completedCase({ id: 'c-open', appeals: [appeal()] })];
    },
  };

  const host = ControlsDashboard({
    client: /** @type {any} */ (client),
    allCaseSources: oneSource,
    onOpenCase: () => {},
  });
  await flush();

  assert.ok(calls.length >= 1, 'should query the case list');
  for (const { filter } of calls) {
    assert.equal(
      filter.hasOpenAppeal,
      true,
      'must lead with the indexed hasOpenAppeal flag'
    );
    assert.equal(
      filter.status,
      undefined,
      'must not fetch the full Completed set'
    );
  }
  const [{ opts }] = calls;
  assert.equal(opts.orderBy, 'appealRaisedAt', 'orders by appealRaisedAt');
  assert.equal(opts.orderDir, 'asc', 'oldest raised first');
  assert.equal(opts.top, PAGE_SIZE, 'pages the read');
  assert.equal(opts.skip, 0, 'first page starts at zero');
  assert.equal(
    opts.listName,
    'Cases-Complaints',
    'each page carries the source listName'
  );

  const section = findSection(host, 'cora-controls-appeals');
  assert.ok(section, 'should render the outstanding appeals section');

  const table = /** @type {any} */ (findAll(section, 'cora-case-table')[0]);
  assert.ok(table, 'should render a case table');
  const rows = /** @type {CaseRow[]} */ (table.cases);
  assert.deepEqual(
    rows.map((r) => r.id),
    ['c-open']
  );
});

test('ControlsDashboard: pages until a short page, accumulating every open appeal (MockSharePointClient)', async () => {
  // One more open-appeal case than a single page holds, so the loop must fetch
  // a second page and stop on the short tail — proving no full-list fetch and
  // that paging accumulates the whole worklist.
  /** @type {CaseRow[]} */
  const cases = [];
  for (let i = 0; i < PAGE_SIZE + 1; i++) {
    cases.push(
      completedCase({
        id: `c-${i}`,
        hasOpenAppeal: true,
        // Oldest raised first: ascending ids share ascending timestamps.
        appealRaisedAt: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
        appeals: [
          appeal({ at: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z` }),
        ],
      })
    );
  }
  // A resolved-only Completed case must be excluded server-side (no flag).
  cases.push(completedCase({ id: 'c-resolved', hasOpenAppeal: false }));

  const client = new MockSharePointClient({
    lists: { 'Cases-Complaints': cases },
    questionDefinitions: [],
    personas: {},
  });

  const host = ControlsDashboard({
    client: /** @type {any} */ (client),
    allCaseSources: oneSource,
    onOpenCase: () => {},
  });
  await flush();
  await flush();

  const section = findSection(host, 'cora-controls-appeals');
  const table = /** @type {any} */ (findAll(section, 'cora-case-table')[0]);
  const rows = /** @type {CaseRow[]} */ (table.cases);
  assert.equal(rows.length, PAGE_SIZE + 1, 'accumulates both pages');
  assert.ok(
    rows.every((r) => r.id !== 'c-resolved'),
    'the case without an open appeal is filtered out server-side'
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    cases.slice(0, PAGE_SIZE + 1).map((c) => c.id),
    'rows arrive oldest-raised first'
  );
});

test('ControlsDashboard: fans out across multiple sources, pages each to exhaustion, and merges by appealRaisedAt asc', async () => {
  const sources = [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      displayName: 'Complaints',
    },
    {
      slug: 'stress-review',
      listName: 'Cases-StressReview',
      displayName: 'Stress Review',
    },
  ];
  /** @type {Record<string, CaseRow[]>} */
  const byList = {
    'Cases-Complaints': [
      completedCase({
        id: 'c-mid',
        appeals: [appeal({ at: '2026-06-15T00:00:00Z' })],
      }),
    ],
    'Cases-StressReview': [
      completedCase({
        id: 's-early',
        appeals: [appeal({ at: '2026-06-01T00:00:00Z' })],
      }),
      completedCase({
        id: 's-late',
        appeals: [appeal({ at: '2026-06-30T00:00:00Z' })],
      }),
    ],
  };
  /** @type {any[]} */
  const calls = [];
  const client = {
    async listCases(/** @type {any} */ f, /** @type {any} */ opts) {
      calls.push({ filter: f, opts });
      const rows = byList[opts.listName] ?? [];
      // Emulate server-side paging: a short page (< top) ends the loop.
      return rows.slice(opts.skip, opts.skip + opts.top);
    },
  };

  const host = ControlsDashboard({
    client: /** @type {any} */ (client),
    allCaseSources: sources,
    onOpenCase: () => {},
  });
  await flush();
  await flush();

  assert.deepEqual(
    [...new Set(calls.map((c) => c.opts.listName))].sort(),
    ['Cases-Complaints', 'Cases-StressReview'],
    'pages each source list'
  );

  const section = findSection(host, 'cora-controls-appeals');
  const table = /** @type {any} */ (findAll(section, 'cora-case-table')[0]);
  const rows = /** @type {CaseRow[]} */ (table.cases);
  assert.deepEqual(
    rows.map((r) => r.id),
    ['s-early', 'c-mid', 's-late'],
    'rows from every source merge, sorted oldest-appealRaisedAt-first'
  );
});

test('ControlsDashboard: merge sort covers equal timestamps and a row with no open appeal', async () => {
  const sources = [
    { slug: 'a', listName: 'Cases-A', displayName: 'A' },
    { slug: 'b', listName: 'Cases-B', displayName: 'B' },
  ];
  /** @type {Record<string, CaseRow[]>} */
  const byList = {
    'Cases-A': [
      // Same `at` as the row from Cases-B below, exercising the
      // comparator's equal branch (both `<` and `>` are false).
      completedCase({
        id: 'a-same',
        appeals: [appeal({ at: '2026-06-10T00:00:00Z' })],
      }),
      // No open appeal at all — `openAppealOf` returns null, exercising the
      // `?? ''` fallback in the sort key.
      completedCase({ id: 'a-no-appeal', appeals: [] }),
    ],
    'Cases-B': [
      completedCase({
        id: 'b-same',
        appeals: [appeal({ at: '2026-06-10T00:00:00Z' })],
      }),
    ],
  };
  const client = {
    async listCases(/** @type {any} */ f, /** @type {any} */ opts) {
      return byList[opts.listName] ?? [];
    },
  };

  const host = ControlsDashboard({
    client: /** @type {any} */ (client),
    allCaseSources: sources,
    onOpenCase: () => {},
  });
  await flush();

  const section = findSection(host, 'cora-controls-appeals');
  const table = /** @type {any} */ (findAll(section, 'cora-case-table')[0]);
  const rows = /** @type {CaseRow[]} */ (table.cases);
  assert.equal(rows.length, 3, 'every row from every source is present');
  assert.deepEqual(
    new Set(rows.map((r) => r.id)),
    new Set(['a-same', 'a-no-appeal', 'b-same'])
  );
});

test('ControlsDashboard: renders nothing and does not throw when client is null', async () => {
  const host = ControlsDashboard({ client: null, onOpenCase: () => {} });
  await flush();
  assert.equal(/** @type {any} */ (host)._children.length, 0);
});

test('ControlsDashboard: columns expose appeal detail and render reference/raised/actions cells', async () => {
  const withOpen = completedCase({
    id: 'c-open',
    title: 'Appealed Case',
    appeals: [appeal({ appellant: 'jo.owner', rationale: 'Too harsh' })],
  });
  const client = {
    async listCases() {
      return [withOpen];
    },
  };
  /** @type {CaseRow[]} */
  const opened = [];
  const host = ControlsDashboard({
    client: /** @type {any} */ (client),
    allCaseSources: oneSource,
    onOpenCase: (/** @type {CaseRow} */ c) => opened.push(c),
  });
  await flush();

  const section = findSection(host, 'cora-controls-appeals');
  const table = /** @type {any} */ (findAll(section, 'cora-case-table')[0]);
  const columns = table._customColumns;

  const byKey = (/** @type {string} */ key) =>
    columns.find((/** @type {any} */ c) => c.key === key);

  assert.equal(byKey('appellant').getValue(withOpen), 'jo.owner');
  assert.equal(byKey('rationale').getValue(withOpen), 'Too harsh');
  assert.equal(byKey('caseType').getValue(withOpen), 'complaints');
  assert.equal(byKey('responsibleParty').getValue(withOpen), 'adv');

  const refCell = byKey('reference').renderCell(withOpen);
  assert.equal(refCell.textContent, 'Appealed Case');

  assert.equal(byKey('raised').getValue(withOpen), '2026-06-01T09:00:00Z');
  const raisedCell = byKey('raised').renderCell(withOpen);
  assert.equal(typeof raisedCell, 'string');
  assert.notEqual(raisedCell, '—');

  const actionsCell = byKey('actions').renderCell(withOpen);
  assert.equal(actionsCell.getAttribute('aria-label'), 'Open Appealed Case');
  for (const listener of actionsCell._listeners['click'] ?? []) listener();
  assert.deepEqual(
    opened.map((c) => c.id),
    ['c-open'],
    'clicking Open invokes onOpenCase'
  );
});

test('ControlsDashboard: appeal columns fall back to empty/em-dash when no open appeal is present', async () => {
  // A resolved-only case would be filtered out of the table, but the column
  // accessors must still degrade gracefully if handed such a row.
  const resolvedOnly = completedCase({
    id: 'c-resolved',
    title: '',
    appeals: [appeal({ state: 'resolved' })],
  });
  const client = {
    async listCases() {
      return [completedCase({ id: 'c-open', appeals: [appeal()] })];
    },
  };
  const host = ControlsDashboard({
    client: /** @type {any} */ (client),
    allCaseSources: oneSource,
    onOpenCase: () => {},
  });
  await flush();

  const section = findSection(host, 'cora-controls-appeals');
  const table = /** @type {any} */ (findAll(section, 'cora-case-table')[0]);
  const byKey = (/** @type {string} */ key) =>
    table._customColumns.find((/** @type {any} */ c) => c.key === key);

  assert.equal(byKey('appellant').getValue(resolvedOnly), '');
  assert.equal(byKey('rationale').getValue(resolvedOnly), '');
  assert.equal(byKey('raised').getValue(resolvedOnly), null);
  assert.equal(byKey('raised').renderCell(resolvedOnly), '—');
  // reference falls back to id when title is blank
  assert.equal(
    byKey('reference').renderCell(resolvedOnly).textContent,
    'c-resolved'
  );
});

test('ControlsDashboard: reference getValue falls back to id, and open is a no-op when onOpenCase is omitted', async () => {
  const noTitle = completedCase({
    id: 'c-open',
    title: '',
    appeals: [appeal()],
  });
  const client = {
    async listCases() {
      return [noTitle];
    },
  };
  // No onOpenCase provided — the optional-chained handlers must not throw.
  const host = ControlsDashboard({
    client: /** @type {any} */ (client),
    allCaseSources: oneSource,
  });
  await flush();

  const section = findSection(host, 'cora-controls-appeals');
  const table = /** @type {any} */ (findAll(section, 'cora-case-table')[0]);
  const byKey = (/** @type {string} */ key) =>
    table._customColumns.find((/** @type {any} */ c) => c.key === key);

  assert.equal(byKey('reference').getValue(noTitle), 'c-open');

  const actionsCell = byKey('actions').renderCell(noTitle);
  assert.equal(actionsCell.getAttribute('aria-label'), 'Open c-open');
  // Clicking with no handler must not throw.
  for (const listener of actionsCell._listeners['click'] ?? []) listener();

  // The table-level cora-case-open handler must also no-op safely.
  for (const listener of /** @type {any} */ (table)._listeners[
    'cora-case-open'
  ] ?? []) {
    listener({ detail: { caseRow: noTitle } });
  }
});

test('ControlsDashboard: Open button invokes onOpenCase with the case row', async () => {
  /** @type {CaseRow[]} */
  const opened = [];
  const withOpen = completedCase({ id: 'c-open', appeals: [appeal()] });
  const client = {
    async listCases() {
      return [withOpen];
    },
  };

  const host = ControlsDashboard({
    client: /** @type {any} */ (client),
    allCaseSources: oneSource,
    onOpenCase: (/** @type {CaseRow} */ c) => opened.push(c),
  });
  await flush();

  const section = findSection(host, 'cora-controls-appeals');
  const table = findAll(section, 'cora-case-table')[0];
  for (const listener of /** @type {any} */ (table)._listeners[
    'cora-case-open'
  ] ?? []) {
    listener({ detail: { caseRow: withOpen } });
  }

  assert.equal(opened.length, 1);
  assert.equal(opened[0].id, 'c-open');
});
