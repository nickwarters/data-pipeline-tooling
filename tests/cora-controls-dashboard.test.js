// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
/** @typedef {import('./_dom-stub.js').StubEl} StubEl */

installDom();

// ===== IMPORTS (after stubs) =====
const { ControlsDashboard, hasOpenAppeal, openAppealOf } =
  await import('../src/pages/cora-controls-dashboard.js');

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

// ===== PREDICATE TESTS =====

test('hasOpenAppeal: true when a case has a raised appeal', () => {
  assert.equal(hasOpenAppeal(completedCase({ appeals: [appeal()] })), true);
});

test('hasOpenAppeal: true when a case has an underReview appeal', () => {
  assert.equal(
    hasOpenAppeal(
      completedCase({ appeals: [appeal({ state: 'underReview' })] })
    ),
    true
  );
});

test('hasOpenAppeal: false when the only appeal is resolved', () => {
  assert.equal(
    hasOpenAppeal(completedCase({ appeals: [appeal({ state: 'resolved' })] })),
    false
  );
});

test('hasOpenAppeal: false when there are no appeals', () => {
  assert.equal(hasOpenAppeal(completedCase()), false);
  assert.equal(hasOpenAppeal(completedCase({ appeals: [] })), false);
});

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

test('ControlsDashboard: fetches Completed cases and shows only those with an open appeal', async () => {
  /** @type {any[]} */
  const calls = [];
  const withOpen = completedCase({ id: 'c-open', appeals: [appeal()] });
  const withResolved = completedCase({
    id: 'c-resolved',
    appeals: [appeal({ state: 'resolved' })],
  });
  const noAppeal = completedCase({ id: 'c-none' });
  const client = {
    async listCases(/** @type {any} */ f) {
      calls.push(f);
      return [withOpen, withResolved, noAppeal];
    },
  };

  const host = ControlsDashboard({
    client: /** @type {any} */ (client),
    onOpenCase: () => {},
  });
  await flush();

  assert.ok(
    calls.some((f) => f.status === 'Completed'),
    'should list Completed cases'
  );

  const section = findSection(host, 'cora-controls-appeals');
  assert.ok(section, 'should render the outstanding appeals section');

  const table = /** @type {any} */ (findAll(section, 'cora-case-table')[0]);
  assert.ok(table, 'should render a case table');
  const rows = /** @type {CaseRow[]} */ (table.cases);
  assert.deepEqual(
    rows.map((r) => r.id),
    ['c-open'],
    'only the case with an open appeal should appear'
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
  const host = ControlsDashboard({ client: /** @type {any} */ (client) });
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
