// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { loadKpiModel, caseTypeDisplayName, isBreachingWithin24h } =
  await import('../src/evaluators/kpi-strip-model.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

// A fixed clock so overdue/breaching windows are deterministic.
const NOW = new Date('2026-07-04T12:00:00Z');
const PAST = '2026-07-01T00:00:00Z'; // overdue
const SOON = '2026-07-04T18:00:00Z'; // breaching < 24h
const LATER = '2026-07-10T00:00:00Z'; // comfortably in future

/**
 * @param {Partial<CaseRow>} [overrides]
 * @returns {CaseRow}
 */
function caseRow(overrides = {}) {
  return {
    id: 'c-' + Math.random().toString(36).slice(2),
    caseType: 'complaints',
    title: 'Case',
    status: 'In-progress',
    assignedReviewer: 'me',
    responsibleParty: 'rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'e1',
    ...overrides,
  };
}

function defaultCapabilities(overrides = {}) {
  return {
    isReviewer: false,
    listAccessCaseTypes: [],
    isAdviser: false,
    ownedCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isVisitor: false,
    ...overrides,
  };
}

/**
 * A client that returns rows keyed by the filter it receives.
 * @param {(filter: any) => CaseRow[]} handler
 */
function makeClient(handler) {
  return {
    /** @param {any} filter */
    async listCases(filter) {
      return handler(filter).map((c) => ({ ...c }));
    },
  };
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

// ===== isBreachingWithin24h =====

test('isBreachingWithin24h: true when due within the next 24h', () => {
  assert.equal(isBreachingWithin24h(caseRow({ dueDate: SOON }), NOW), true);
});

test('isBreachingWithin24h: false when overdue (already past)', () => {
  assert.equal(isBreachingWithin24h(caseRow({ dueDate: PAST }), NOW), false);
});

test('isBreachingWithin24h: false when due beyond 24h', () => {
  assert.equal(isBreachingWithin24h(caseRow({ dueDate: LATER }), NOW), false);
});

test('isBreachingWithin24h: false when no due date', () => {
  assert.equal(isBreachingWithin24h(caseRow({ dueDate: null }), NOW), false);
});

test('isBreachingWithin24h: false for a Completed case', () => {
  assert.equal(
    isBreachingWithin24h(caseRow({ status: 'Completed', dueDate: SOON }), NOW),
    false
  );
});

test('isBreachingWithin24h: defaults now to the current time without throwing', () => {
  assert.equal(
    typeof isBreachingWithin24h(caseRow({ dueDate: LATER })),
    'boolean'
  );
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
    // out of scope — filtered away
    caseRow({ id: 'x1', caseType: 'lending', dueDate: PAST }),
  ];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (makeClient(() => rows)),
    currentUserId: 'me',
    capabilities: defaultCapabilities({
      isReviewer: true,
      listAccessCaseTypes: ['complaints', 'conduct'],
    }),
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
    client: /** @type {any} */ (makeClient(() => rows)),
    currentUserId: 'me',
    capabilities: defaultCapabilities({
      isReviewer: true,
      listAccessCaseTypes: ['complaints', 'conduct'],
    }),
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
    capabilities: defaultCapabilities({
      isReviewer: true,
      listAccessCaseTypes: ['complaints'],
    }),
    now: NOW,
  });
  const rev = lane(lanes, 'reviewer');
  assert.equal(tile(rev, 'in-progress').count, 1);
  assert.equal(tile(rev, 'awaiting-rp').count, 0);
});

test('loadKpiModel: reviewer scope falls back to eligibleCaseTypes when no list-access types', async () => {
  const rows = [caseRow({ id: 'o1', caseType: 'complaints', dueDate: PAST })];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (makeClient(() => rows)),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ isReviewer: true }),
    eligibleCaseTypes: ['complaints'],
    now: NOW,
  });
  const rev = lane(lanes, 'reviewer');
  assert.equal(rev.scopeLabel, 'Complaints');
  assert.equal(tile(rev, 'overdue').count, 1);
  // single Case Type in scope → no per-Case-Type breakdown
  assert.equal(tile(rev, 'overdue').breakdown, null);
});

test('loadKpiModel: reviewer lane sends an assignedReviewer + In-progress filter', async () => {
  /** @type {any[]} */
  const calls = [];
  await loadKpiModel({
    client: /** @type {any} */ (
      makeClient((f) => {
        calls.push(f);
        return [];
      })
    ),
    currentUserId: 'me',
    capabilities: defaultCapabilities({
      isReviewer: true,
      listAccessCaseTypes: ['complaints'],
    }),
    now: NOW,
  });
  assert.deepEqual(calls, [{ status: 'In-progress', assignedReviewer: 'me' }]);
});

// ===== Controls lane =====

test('loadKpiModel: controls lane counts only Completed cases with an open appeal', async () => {
  const rows = [
    caseRow({
      id: 'ap1',
      status: 'Completed',
      caseType: 'complaints',
      appeals: [
        { id: 'a', appellant: 'jo', at: PAST, rationale: 'x', state: 'raised' },
      ],
    }),
    caseRow({
      id: 'ap2',
      status: 'Completed',
      caseType: 'conduct',
      appeals: [
        {
          id: 'b',
          appellant: 'jo',
          at: PAST,
          rationale: 'x',
          state: 'underReview',
        },
      ],
    }),
    caseRow({
      id: 'resolved',
      status: 'Completed',
      appeals: [
        {
          id: 'c',
          appellant: 'jo',
          at: PAST,
          rationale: 'x',
          state: 'resolved',
        },
      ],
    }),
    caseRow({ id: 'none', status: 'Completed' }),
  ];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (makeClient(() => rows)),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ isControls: true }),
    now: NOW,
  });
  const controls = lane(lanes, 'controls');
  assert.ok(controls);
  assert.equal(controls.scopeLabel, 'all case types');
  const appeals = tile(controls, 'appeals');
  assert.equal(appeals.count, 2);
  assert.equal(appeals.breakdown.axis, 'caseType');
  assert.equal(appeals.breakdown.rows.length, 2);
});

test('loadKpiModel: controls appeals tile has no breakdown when appeals share one Case Type', async () => {
  const rows = [
    caseRow({
      id: 'ap1',
      status: 'Completed',
      caseType: 'complaints',
      appeals: [
        { id: 'a', appellant: 'jo', at: PAST, rationale: 'x', state: 'raised' },
      ],
    }),
  ];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (makeClient(() => rows)),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ isControls: true }),
    now: NOW,
  });
  assert.equal(tile(lane(lanes, 'controls'), 'appeals').breakdown, null);
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

test('loadKpiModel: owner At risk drops a sub-reason with zero matches', async () => {
  const rows = [caseRow({ id: 'od1', caseType: 'lending', dueDate: PAST })];
  const lanes = await loadKpiModel({
    client: /** @type {any} */ (makeClient(() => rows)),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ ownedCaseTypes: ['lending'] }),
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
    now: NOW,
  });
  const atRisk = tile(lane(lanes, 'owner'), 'at-risk');
  assert.equal(atRisk.breakdown.axis, 'caseType');
  assert.equal(atRisk.breakdown.rows.length, 2);
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
