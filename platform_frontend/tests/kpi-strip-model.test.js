// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCaseRow, makePermissions } from './helpers/fixtures.js';

const {
  loadKpiModel,
  caseTypeDisplayName,
  isBreachingSoon,
  breachingSoonLabel,
} = await import('../src/evaluators/kpi-strip-model.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/services/permissions.js').Capabilities} Capabilities */

// A fixed clock so overdue/breaching windows are deterministic.
const NOW = new Date('2026-07-04T12:00:00Z');
const PAST = '2026-07-01T00:00:00Z'; // overdue
const SOON = '2026-07-04T18:00:00Z'; // inside the default 24h window
const LATER = '2026-07-10T00:00:00Z'; // comfortably in future

/**
 * @param {Partial<CaseRow>} [overrides]
 * @returns {CaseRow}
 */
function caseRow(overrides = {}) {
  return makeCaseRow({
    // Unique per row so the reviewer lane's dedupe is exercised honestly.
    id: 'c-' + Math.random().toString(36).slice(2),
    title: 'Case',
    // The signed-in user of this suite, and the Responsible Party it replies as.
    assignedReviewer: 'me',
    responsibleParty: 'rp',
    etag: 'e1',
    ...overrides,
  });
}

// A lane appears only for a capability the user holds, so the baseline holds none.
/** @param {Partial<Capabilities>} [overrides] */
function defaultCapabilities(overrides = {}) {
  return makePermissions({ isReviewer: false, ...overrides });
}

/**
 * Apply the server-side `ListCasesFilter` fields this suite exercises, so the
 * fake client filters like the real mock/http clients do — the KPI lanes lead
 * with indexed columns rather than fetch-and-filter in JS.
 * @param {CaseRow[]} rows @param {any} filter
 */
function applyFilter(rows, filter) {
  return rows.filter((c) => {
    if (filter.status !== undefined && c.status !== filter.status) return false;
    if (
      filter.assignedReviewer !== undefined &&
      c.assignedReviewer !== filter.assignedReviewer
    )
      return false;
    if (filter.caseType !== undefined && c.caseType !== filter.caseType)
      return false;
    if (
      filter.hasOpenAppeal !== undefined &&
      Boolean(c.hasOpenAppeal) !== filter.hasOpenAppeal
    )
      return false;
    return true;
  });
}

/**
 * A client that returns rows keyed by the filter + `{ listName }` opts it
 * receives. `listCases` and `countCases` share the same point-in-time
 * filtering so a count and its rows never drift. `handler` sees `(filter,
 * opts)` so per-list fan-out can be asserted / scoped by list.
 * @param {(filter: any, opts: any) => CaseRow[]} handler
 */
function makeClient(handler) {
  return {
    /** @param {any} filter @param {any} [opts] */
    async listCases(filter, opts) {
      return applyFilter(handler(filter, opts), filter).map((c) => ({
        ...c,
      }));
    },
    /** @param {any} filter @param {any} [opts] */
    async countCases(filter, opts) {
      return applyFilter(handler(filter, opts), filter).length;
    },
  };
}

/**
 * @param {string} slug
 * @param {string} [listName]
 * @returns {import('../src/setup/resolve-eligible-case-types.js').CaseSource}
 */
function source(slug, listName = `Cases-${slug}`) {
  return { slug, listName, displayName: caseTypeDisplayName(slug) };
}

/** @param {any[]} lanes @param {string} role */
function lane(lanes, role) {
  return lanes.find((l) => l.role === role);
}
/** @param {any} l @param {string} key */
function tile(l, key) {
  return l.tiles.find((/** @type {any} */ t) => t.key === key);
}

// ===== caseTypeDisplayName =====

test('caseTypeDisplayName: resolves configured slugs to their display name', () => {
  assert.equal(caseTypeDisplayName('complaints'), 'Complaints');
});

test('caseTypeDisplayName: title-cases unknown slugs as a fallback', () => {
  assert.equal(caseTypeDisplayName('lending-review'), 'Lending Review');
});

test('caseTypeDisplayName: tolerates empty slug segments', () => {
  assert.equal(caseTypeDisplayName('-lending'), ' Lending');
});

// ===== isBreachingSoon =====

test('isBreachingSoon: true when due inside the default window', () => {
  assert.equal(isBreachingSoon(caseRow({ dueDate: SOON }), NOW), true);
});

test('isBreachingSoon: false when overdue (already past)', () => {
  assert.equal(isBreachingSoon(caseRow({ dueDate: PAST }), NOW), false);
});

test('isBreachingSoon: false when due beyond the default window', () => {
  assert.equal(isBreachingSoon(caseRow({ dueDate: LATER }), NOW), false);
});

test('isBreachingSoon: false when no due date', () => {
  assert.equal(isBreachingSoon(caseRow({ dueDate: null }), NOW), false);
});

test('isBreachingSoon: false for a Completed case', () => {
  assert.equal(
    isBreachingSoon(caseRow({ status: 'Completed', dueDate: SOON }), NOW),
    false
  );
});

test('isBreachingSoon: false once the review clock has stopped, even mid-remediation', () => {
  // The look-ahead window runs off the same statuses as the overdue rule: only
  // a Case still under review can be about to breach its review due date.
  assert.equal(
    isBreachingSoon(
      caseRow({ status: 'Actions In Progress', dueDate: SOON }),
      NOW
    ),
    false
  );
});

test('isBreachingSoon: defaults now to the current time without throwing', () => {
  assert.equal(typeof isBreachingSoon(caseRow({ dueDate: LATER })), 'boolean');
});

test('isBreachingSoon: an explicit window widens and narrows the look-ahead', () => {
  // LATER is ~5.5 days out: outside the default window, inside a 7-day one.
  assert.equal(isBreachingSoon(caseRow({ dueDate: LATER }), NOW, 24 * 7), true);
  // SOON is 6 hours out: inside the default window, outside a 2-hour one.
  assert.equal(isBreachingSoon(caseRow({ dueDate: SOON }), NOW, 2), false);
});

test('breachingSoonLabel: states the window it was given', () => {
  assert.equal(breachingSoonLabel(24), 'Breaching < 24h');
  assert.equal(breachingSoonLabel(48), 'Breaching < 48h');
});

// ===== loadKpiModel: client guard =====

test('loadKpiModel: returns no lanes when client is null', async () => {
  const lanes = await loadKpiModel({
    client: null,
    currentUserId: 'me',
    capabilities: defaultCapabilities({ isReviewer: true }),
  });
  assert.deepEqual(lanes, []);
});

test('loadKpiModel: a visitor with no roles produces no lanes', async () => {
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (makeClient(() => [])),
    currentUserId: 'me',
    capabilities: defaultCapabilities(),
  });
  assert.deepEqual(lanes, []);
});

// ===== Reviewer lane =====

test('loadKpiModel: reviewer lane buckets cases into overdue / awaiting RP / in progress, deduped', async () => {
  const rows = [
    caseRow({ id: 'o1', caseType: 'complaints', dueDate: PAST }),
    caseRow({ id: 'o2', caseType: 'conduct', dueDate: PAST }),
    caseRow({
      id: 'a1',
      caseType: 'complaints',
      conversation: [{ author: 'me', timestamp: PAST, body: 'ping' }],
    }),
    caseRow({
      id: 'p1',
      caseType: 'complaints',
      conversation: [{ author: 'rp', timestamp: PAST, body: 'reply' }],
    }),
    caseRow({ id: 'p2', caseType: 'conduct' }),
    // out of scope — no source for this list, never fetched
    caseRow({ id: 'x1', caseType: 'lending', dueDate: PAST }),
  ];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (
      makeClient((f, opts) =>
        rows.filter((r) => `Cases-${r.caseType}` === opts.listName)
      )
    ),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ isReviewer: true }),
    caseSources: [source('complaints'), source('conduct')],
    now: NOW,
  });

  const rev = lane(lanes, 'reviewer');
  assert.ok(rev);
  assert.equal(rev.label, 'As Reviewer');
  assert.equal(rev.scopeLabel, 'Complaints, Conduct');
  assert.equal(tile(rev, 'overdue').count, 2);
  assert.equal(tile(rev, 'awaiting-rp').count, 1);
  assert.equal(tile(rev, 'in-progress').count, 2);
  // 5 in scope, deduped by case
  assert.equal(rev.totalItems, 5);
});

test('loadKpiModel: reviewer overdue tile splits by Case Type, zero-suppressed and sorted', async () => {
  const rows = [
    caseRow({ id: 'o1', caseType: 'complaints', dueDate: PAST }),
    caseRow({ id: 'o2', caseType: 'complaints', dueDate: PAST }),
    caseRow({ id: 'o3', caseType: 'conduct', dueDate: PAST }),
  ];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (
      makeClient((f, opts) =>
        rows.filter((r) => `Cases-${r.caseType}` === opts.listName)
      )
    ),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ isReviewer: true }),
    caseSources: [source('complaints'), source('conduct')],
    now: NOW,
  });
  const overdue = tile(lane(lanes, 'reviewer'), 'overdue');
  assert.equal(overdue.breakdown.axis, 'caseType');
  assert.deepEqual(overdue.breakdown.rows, [
    { label: 'Complaints', count: 2 },
    { label: 'Conduct', count: 1 },
  ]);
  // reviewer tiles default collapsed
  assert.equal(overdue.defaultExpanded, false);
});

test('loadKpiModel: reviewer treats a case with no conversation as in progress', async () => {
  const row = caseRow({ id: 'p1', caseType: 'complaints' });
  // A row that never carried a conversation array at all.
  delete (/** @type {any} */ (row).conversation);
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (makeClient(() => [row])),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ isReviewer: true }),
    caseSources: [source('complaints')],
    now: NOW,
  });
  const rev = lane(lanes, 'reviewer');
  assert.equal(tile(rev, 'in-progress').count, 1);
  assert.equal(tile(rev, 'awaiting-rp').count, 0);
});

test('loadKpiModel: reviewer scope label and tiles are driven by caseSources', async () => {
  const rows = [caseRow({ id: 'o1', caseType: 'complaints', dueDate: PAST })];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (makeClient(() => rows)),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ isReviewer: true }),
    caseSources: [source('complaints')],
    now: NOW,
  });
  const rev = lane(lanes, 'reviewer');
  assert.equal(rev.scopeLabel, 'Complaints');
  assert.equal(tile(rev, 'overdue').count, 1);
  // single Case Type in scope → no per-Case-Type breakdown
  assert.equal(tile(rev, 'overdue').breakdown, null);
});

test('loadKpiModel: reviewer lane with no caseSources produces an empty pool', async () => {
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (
      makeClient(() => {
        throw new Error('should not be called with no sources');
      })
    ),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ isReviewer: true }),
    caseSources: [],
    now: NOW,
  });
  const rev = lane(lanes, 'reviewer');
  assert.equal(rev.totalItems, 0);
  assert.equal(rev.scopeLabel, '');
});

test('loadKpiModel: reviewer lane sends an assignedReviewer + In-progress filter per source list', async () => {
  /** @type {any[]} */
  const calls = [];
  await loadKpiModel({
    client: /** @type {any} */ (
      makeClient((f, opts) => {
        calls.push([f, opts]);
        return [];
      })
    ),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ isReviewer: true }),
    caseSources: [source('complaints')],
    now: NOW,
  });
  assert.deepEqual(calls, [
    [
      { status: 'In-progress', assignedReviewer: 'me' },
      { listName: 'Cases-complaints' },
    ],
  ]);
});

// ===== Controls lane =====

test('loadKpiModel: controls lane counts Completed cases with an open appeal via the indexed flag', async () => {
  const rows = [
    caseRow({
      id: 'ap1',
      status: 'Completed',
      caseType: 'complaints',
      hasOpenAppeal: true,
    }),
    caseRow({
      id: 'ap2',
      status: 'Completed',
      caseType: 'conduct',
      hasOpenAppeal: true,
    }),
    // resolved appeal: the indexed flag is cleared, so it is not open work
    caseRow({ id: 'resolved', status: 'Completed', hasOpenAppeal: false }),
    caseRow({ id: 'none', status: 'Completed' }),
  ];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (
      makeClient((f, opts) =>
        rows.filter((r) => `Cases-${r.caseType}` === opts.listName)
      )
    ),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ isControls: true }),
    allCaseSources: [source('complaints'), source('conduct')],
    now: NOW,
  });
  const controls = lane(lanes, 'controls');
  assert.ok(controls);
  assert.equal(controls.scopeLabel, 'all case types');
  const appeals = tile(controls, 'appeals');
  // 1 per list, summed across both source lists
  assert.equal(appeals.count, 2);
  assert.equal(appeals.defaultExpanded, false);
  // count-only lane: no rows to split, so no breakdown
  assert.equal(appeals.breakdown, null);
  assert.equal(controls.totalItems, 2);
});

test('loadKpiModel: controls lane derives its count via countCases({ hasOpenAppeal: true }) per source list, summed, and never lists', async () => {
  /** @type {any[]} */
  const countCalls = [];
  // No `listCases` on the client: a full-Completed fetch would throw here, so
  // this proves the lane leads with `countCases` alone.
  const client = {
    /** @param {any} f @param {any} opts */
    async countCases(f, opts) {
      countCalls.push([f, opts]);
      return 3;
    },
  };
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (client),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ isControls: true }),
    allCaseSources: [source('complaints'), source('conduct')],
    now: NOW,
  });
  assert.deepEqual(countCalls, [
    [{ hasOpenAppeal: true }, { listName: 'Cases-complaints' }],
    [{ hasOpenAppeal: true }, { listName: 'Cases-conduct' }],
  ]);
  // summed across both source lists
  assert.equal(tile(lane(lanes, 'controls'), 'appeals').count, 6);
});

// ===== Owner lane =====

test('loadKpiModel: owner lane splits At risk into sub-reasons and defaults it expanded', async () => {
  const rows = [
    caseRow({ id: 'od1', caseType: 'lending', dueDate: PAST }),
    caseRow({ id: 'od2', caseType: 'lending', dueDate: PAST }),
    caseRow({ id: 'br1', caseType: 'lending', dueDate: SOON }),
    caseRow({ id: 'un1', caseType: 'lending', assignedReviewer: '' }),
    // Completed rows are ignored by the owner pool
    caseRow({
      id: 'done',
      caseType: 'lending',
      status: 'Completed',
      dueDate: PAST,
    }),
  ];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (
      makeClient((f) => rows.filter((r) => r.caseType === f.caseType))
    ),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ ownedCaseTypes: ['lending'] }),
    allCaseSources: [source('lending')],
    now: NOW,
  });
  const owner = lane(lanes, 'owner');
  assert.ok(owner);
  assert.equal(owner.scopeLabel, 'Lending');

  const atRisk = tile(owner, 'at-risk');
  assert.equal(atRisk.count, 3); // 2 overdue + 1 breaching
  assert.equal(atRisk.breakdown.axis, 'reason');
  assert.deepEqual(atRisk.breakdown.rows, [
    { label: 'Overdue on team', count: 2 },
    { label: 'Breaching < 24h', count: 1 },
  ]);
  assert.equal(atRisk.defaultExpanded, true);

  const unassigned = tile(owner, 'unassigned');
  assert.equal(unassigned.count, 1);
  // no sub-reasons, single Case Type → no breakdown, not expanded
  assert.equal(unassigned.breakdown, null);
  assert.equal(unassigned.defaultExpanded, false);

  assert.equal(owner.totalItems, 4);
});

test("loadKpiModel: owner At risk uses the Case Type's own breach window and says so", async () => {
  // 36 hours out: past the framework's default window, inside this Case
  // Type's declared 48-hour one.
  const in36h = '2026-07-06T00:00:00Z';
  const rows = [caseRow({ id: 'br1', caseType: 'lending', dueDate: in36h })];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (makeClient(() => rows)),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ ownedCaseTypes: ['lending'] }),
    allCaseSources: [{ ...source('lending'), breachWindowHours: 48 }],
    now: NOW,
  });
  const atRisk = tile(lane(lanes, 'owner'), 'at-risk');
  assert.equal(atRisk.count, 1);
  assert.deepEqual(atRisk.breakdown.rows, [
    { label: 'Breaching < 48h', count: 1 },
  ]);
});

test('loadKpiModel: owner At risk drops a sub-reason with zero matches', async () => {
  const rows = [caseRow({ id: 'od1', caseType: 'lending', dueDate: PAST })];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (makeClient(() => rows)),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ ownedCaseTypes: ['lending'] }),
    allCaseSources: [source('lending')],
    now: NOW,
  });
  const atRisk = tile(lane(lanes, 'owner'), 'at-risk');
  assert.deepEqual(atRisk.breakdown.rows, [
    { label: 'Overdue on team', count: 2 - 1 },
  ]);
});

test('loadKpiModel: owner with multiple Case Types splits At risk by Case Type', async () => {
  const rows = [
    caseRow({ id: 'l1', caseType: 'lending', dueDate: PAST }),
    caseRow({ id: 'm1', caseType: 'mortgages', dueDate: SOON }),
  ];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (
      makeClient((f) => rows.filter((r) => r.caseType === f.caseType))
    ),
    currentUserId: 'me',
    capabilities: defaultCapabilities({
      ownedCaseTypes: ['lending', 'mortgages'],
    }),
    allCaseSources: [source('lending'), source('mortgages')],
    now: NOW,
  });
  const atRisk = tile(lane(lanes, 'owner'), 'at-risk');
  assert.equal(atRisk.breakdown.axis, 'caseType');
  assert.equal(atRisk.breakdown.rows.length, 2);
});

test('loadKpiModel: owner lane fetches only In-progress cases per owned Case Type source list, server-side', async () => {
  /** @type {any[]} */
  const calls = [];
  await loadKpiModel({
    client: /** @type {any} */ (
      makeClient((f, opts) => {
        calls.push([f, opts]);
        return [];
      })
    ),
    currentUserId: 'me',
    capabilities: defaultCapabilities({
      ownedCaseTypes: ['lending', 'mortgages'],
    }),
    allCaseSources: [source('lending'), source('mortgages')],
    now: NOW,
  });
  assert.deepEqual(calls, [
    [
      { caseType: 'lending', status: 'In-progress' },
      { listName: 'Cases-lending' },
    ],
    [
      { caseType: 'mortgages', status: 'In-progress' },
      { listName: 'Cases-mortgages' },
    ],
  ]);
});

test('loadKpiModel: owner lane ignores a server that leaks a non-In-progress row', async () => {
  // Faithful clients never return it, but the pool must not rely on a JS
  // re-filter — the server-side status predicate is the boundary.
  const rows = [
    caseRow({ id: 'ip', caseType: 'lending', dueDate: PAST }),
    caseRow({
      id: 'done',
      caseType: 'lending',
      status: 'Completed',
      dueDate: PAST,
    }),
  ];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (
      makeClient((f) => rows.filter((r) => r.caseType === f.caseType))
    ),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ ownedCaseTypes: ['lending'] }),
    allCaseSources: [source('lending')],
    now: NOW,
  });
  assert.equal(tile(lane(lanes, 'owner'), 'at-risk').count, 1);
});

test('loadKpiModel: owner lane skips an owned slug with no matching source', async () => {
  const rows = [caseRow({ id: 'l1', caseType: 'lending', dueDate: PAST })];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (
      makeClient((f) => rows.filter((r) => r.caseType === f.caseType))
    ),
    currentUserId: 'me',
    capabilities: defaultCapabilities({
      ownedCaseTypes: ['lending', 'orphan-type'],
    }),
    // 'orphan-type' has no matching source: skipped rather than fetched unscoped
    allCaseSources: [source('lending')],
    now: NOW,
  });
  const owner = lane(lanes, 'owner');
  assert.equal(tile(owner, 'at-risk').count, 1);
});

// ===== Lane defaults: primary / open =====

test('loadKpiModel: first held lane is primary and open; secondary owner lane folds', async () => {
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (makeClient(() => [])),
    currentUserId: 'me',
    capabilities: defaultCapabilities({
      isReviewer: true,
      isControls: true,
      ownedCaseTypes: ['lending'],
      listAccessCaseTypes: ['complaints'],
    }),
    now: NOW,
  });

  const rev = lane(lanes, 'reviewer');
  const controls = lane(lanes, 'controls');
  const owner = lane(lanes, 'owner');

  assert.equal(rev.isPrimary, true);
  assert.equal(rev.defaultOpen, true);
  assert.equal(controls.isPrimary, false);
  assert.equal(controls.defaultOpen, true);
  assert.equal(owner.isPrimary, false);
  assert.equal(owner.defaultOpen, false); // secondary owner lane starts folded
});

test('loadKpiModel: an owner-only user has a single, open primary lane', async () => {
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (makeClient(() => [])),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ ownedCaseTypes: ['lending'] }),
    now: NOW,
  });
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].role, 'owner');
  assert.equal(lanes[0].isPrimary, true);
  assert.equal(lanes[0].defaultOpen, true);
});
