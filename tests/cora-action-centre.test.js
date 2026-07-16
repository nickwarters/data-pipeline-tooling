// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass, findAllByClass, walk } from './_dom-stub.js';

installDom();

const { ActionCentre, ActionCentreView, PAGE_SIZE } =
  await import('../src/components/collections/cora-action-centre.js');
const { MockSharePointClient } =
  await import('../src/services/mock-sharepoint-client.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/services/permissions.js').Capabilities} Capabilities */

/** Drain the async fetch/render chain (several awaited microtask turns). */
async function settle() {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

/**
 * Token-class query returning stub elements (with `_fire`) typed loosely.
 * @param {any} root @param {string} sel @returns {any[]}
 */
function q(root, sel) {
  return root.querySelectorAll(sel);
}

/**
 * Aggregate visible text across an element's descendants — the stub does not
 * compute `textContent` for elements with mixed children (real DOM does).
 * @param {any} node
 * @returns {string}
 */
function textOf(node) {
  if (!node) return '';
  if (!node._children || node._children.length === 0) return node.textContent;
  return node._children.map(textOf).join('');
}

const NOW = new Date('2026-07-04T00:00:00Z');
const PAST = '2020-01-01T00:00:00Z';
const ME = 'me';

/** @param {string} id @param {Partial<CaseRow>} [over] @returns {CaseRow} */
function caseRow(id, over = {}) {
  return /** @type {CaseRow} */ ({
    id,
    caseType: 'complaints',
    title: id,
    status: 'In-progress',
    assignedReviewer: ME,
    responsibleParty: '',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: `etag-${id}`,
    ...over,
  });
}

/** @param {Partial<Capabilities>} [over] @returns {Capabilities} */
function caps(over = {}) {
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
    ...over,
  };
}

/**
 * Reviewer fixture (all assigned to ME unless noted): 5 overdue-only, one
 * overdue+awaiting ("both", worst dueDate), two awaiting-only, two
 * review-required, and one overdue case assigned to another reviewer that must
 * never surface on ME's worklist.
 * @returns {CaseRow[]}
 */
function reviewerCases() {
  const overdueOnly = [1, 2, 3, 4, 5].map((n) =>
    caseRow(`od-${n}`, {
      dueDate: `2020-01-0${n}T00:00:00Z`,
      responsibleParty: `RP-${n}`,
    })
  );
  const both = caseRow('both-1', {
    dueDate: '2019-12-31T00:00:00Z',
    responsibleParty: 'RP-Both',
    awaitingResponsibleParty: true,
    awaitingSince: '2026-06-20T00:00:00Z',
  });
  const awaitingOnly = [
    caseRow('aw-1', {
      awaitingResponsibleParty: true,
      awaitingSince: '2026-06-01T00:00:00Z',
    }),
    caseRow('aw-2', {
      awaitingResponsibleParty: true,
      awaitingSince: '2026-06-20T00:00:00Z',
    }),
  ];
  const reviewRequired = [
    caseRow('rr-1', { reviewRequired: true, created: '2026-06-25T00:00:00Z' }),
    caseRow('rr-2', { reviewRequired: true, created: '2026-07-01T00:00:00Z' }),
  ];
  const othersCase = caseRow('od-other', {
    assignedReviewer: 'someone-else',
    dueDate: PAST,
  });
  return [...overdueOnly, both, ...awaitingOnly, ...reviewRequired, othersCase];
}

/**
 * The default single Case source for the existing (single-list) test
 * fixtures.
 */
const SOURCE = {
  slug: 'complaints',
  listName: 'Cases-Complaints',
  displayName: 'Complaints',
};

/** @param {CaseRow[]} cases */
function makeClient(cases) {
  return new MockSharePointClient({
    lists: { [SOURCE.listName]: cases },
    questionDefinitions: [],
    personas: { reviewer: { groups: [] } },
  });
}

/** @param {Capabilities} [capabilities] @param {CaseRow[]} [cases] */
function mount(
  capabilities = caps({ isReviewer: true }),
  cases = reviewerCases()
) {
  return ActionCentre({
    client: makeClient(cases),
    capabilities,
    currentUserId: ME,
    allCaseSources: [SOURCE],
    now: NOW,
  });
}

/** @param {any} root @param {string} reasonId */
function group(root, reasonId) {
  return findAllByClass(root, 'cora-ac-group').find(
    (g) => g.getAttribute('data-reason') === reasonId
  );
}

/** @param {any} root */
function groupIds(root) {
  return findAllByClass(root, 'cora-ac-group').map((g) =>
    g.getAttribute('data-reason')
  );
}

/** @param {any} root @returns {string[]} row refs in order */
function rowRefs(root) {
  return findAllByClass(root, 'cora-ac-row-ref').map((a) => a.textContent);
}

// ===== TESTS =====

test('ActionCentre: reviewer sees the two needs-action groups by default (tail hidden)', async () => {
  const host = mount();
  await settle();

  assert.ok(findByClass(host, 'cora-action-centre'));
  assert.equal(
    findByClass(host, 'cora-ac-title')?.textContent,
    'Action Centre'
  );
  assert.equal(q(host, '.cora-ac-toggle-btn').length, 2);
  assert.deepEqual(groupIds(host), ['overdue', 'awaitingFrontline']);
});

test('ActionCentre: group headers show reviewer-scoped server-side counts', async () => {
  const host = mount();
  await settle();

  assert.equal(
    group(host, 'overdue').querySelector('.cora-ac-count--overdue').textContent,
    '6',
    'od-1..5 + both, all mine'
  );
  assert.equal(
    group(host, 'awaitingFrontline').querySelector('.cora-ac-count--awaiting')
      .textContent,
    '3',
    'both + aw-1 + aw-2'
  );
});

test('ActionCentre: another reviewer’s case never appears on my worklist', async () => {
  const host = mount();
  await settle();
  assert.ok(
    !rowRefs(group(host, 'overdue')).includes('od-other'),
    'od-other belongs to someone else'
  );
  // The count would be 7 if scoping leaked; it is 6.
  assert.equal(
    group(host, 'overdue').querySelector('.cora-ac-count--overdue').textContent,
    '6'
  );
});

test('ActionCentre: the top-priority group auto-expands and pages worst-first', async () => {
  const host = mount();
  await settle();

  const refs = rowRefs(group(host, 'overdue'));
  assert.equal(refs.length, PAGE_SIZE);
  assert.deepEqual(refs, ['both-1', 'od-1', 'od-2', 'od-3']);
});

test('ActionCentre: a two-reason row notes its secondary reason inline', async () => {
  const host = mount();
  await settle();

  const subs = findAllByClass(group(host, 'overdue'), 'cora-ac-row-sub').map(
    (d) => d.textContent
  );
  assert.ok(
    subs.some(
      (s) => s.includes('RP-Both') && s.includes('also Awaiting Frontline')
    ),
    `expected an "also Awaiting Frontline" note, got: ${JSON.stringify(subs)}`
  );
});

test('ActionCentre: overdue rows carry the breached waiting style', async () => {
  const host = mount();
  await settle();

  const waits = findAllByClass(
    group(host, 'overdue'),
    'cora-ac-wait cora-ac-wait--overdue'
  );
  assert.ok(waits.length > 0);
  assert.ok(waits[0].textContent.includes('over'));
});

test('ActionCentre: "Show N more" pages the rest and corrects the count', async () => {
  const host = mount();
  await settle();

  const more = findByClass(group(host, 'overdue'), 'cora-ac-more');
  assert.equal(more.textContent, 'Show 2 more overdue →');

  more._fire('click');
  await settle();

  assert.equal(rowRefs(group(host, 'overdue')).length, 6);
  assert.equal(findByClass(group(host, 'overdue'), 'cora-ac-more'), null);
});

test('ActionCentre: collapsed groups show a worst-item peek', async () => {
  const host = mount();
  await settle();

  const peek = findByClass(group(host, 'awaitingFrontline'), 'cora-ac-peek');
  assert.ok(peek);
  assert.ok(textOf(peek).includes('aw-1'), 'aw-1 is the oldest awaiting case');
  assert.ok(textOf(peek).includes('no reply'));
});

test('ActionCentre: toggling a group header collapses and re-expands it', async () => {
  const host = mount();
  await settle();

  const header = () =>
    findByClass(group(host, 'overdue'), 'cora-ac-group-header');
  assert.ok(findByClass(group(host, 'overdue'), 'cora-ac-rows'));

  header()._fire('click');
  await settle();
  assert.equal(findByClass(group(host, 'overdue'), 'cora-ac-rows'), null);

  header()._fire('click');
  await settle();
  assert.ok(findByClass(group(host, 'overdue'), 'cora-ac-rows'));
});

test('ActionCentre: expanding a second group loads its rows', async () => {
  const host = mount();
  await settle();

  assert.equal(
    findByClass(group(host, 'awaitingFrontline'), 'cora-ac-rows'),
    null
  );
  findByClass(group(host, 'awaitingFrontline'), 'cora-ac-group-header')._fire(
    'click'
  );
  await settle();

  const refs = rowRefs(group(host, 'awaitingFrontline'));
  assert.equal(refs.length, 3);
  assert.ok(refs.includes('aw-1'));
});

test('ActionCentre: the All toggle reveals the Review Required tail and grows the headline', async () => {
  const host = mount();
  await settle();

  assert.equal(group(host, 'reviewRequired'), undefined, 'hidden by default');
  const headlineBefore = findByClass(host, 'cora-ac-subtitle').textContent;
  assert.ok(headlineBefore.startsWith('8 cases'), headlineBefore);

  q(host, '.cora-ac-toggle-btn')[1]._fire('click'); // "All"
  await settle();

  assert.deepEqual(groupIds(host), [
    'overdue',
    'awaitingFrontline',
    'reviewRequired',
  ]);
  assert.equal(
    group(host, 'reviewRequired').querySelector('.cora-ac-count--review')
      .textContent,
    '2'
  );
  assert.ok(
    findByClass(host, 'cora-ac-subtitle').textContent.startsWith('10 cases'),
    'headline OR-count now includes the review-required tail'
  );
});

test('ActionCentre: the Review Required rows use the "open" clock and review tone', async () => {
  const host = mount();
  await settle();
  q(host, '.cora-ac-toggle-btn')[1]._fire('click'); // "All"
  await settle();

  findByClass(group(host, 'reviewRequired'), 'cora-ac-group-header')._fire(
    'click'
  );
  await settle();

  const refs = rowRefs(group(host, 'reviewRequired'));
  assert.deepEqual(refs, ['rr-1', 'rr-2'], 'oldest created first');
  const waits = findAllByClass(
    group(host, 'reviewRequired'),
    'cora-ac-wait'
  ).concat(
    findAllByClass(
      group(host, 'reviewRequired'),
      'cora-ac-wait cora-ac-wait--review'
    )
  );
  assert.ok(
    waits.some((w) => w.textContent.includes('open')),
    'review-required age reads as "N days open"'
  );
  assert.ok(
    group(host, 'reviewRequired').querySelector('.cora-ac-dot--review')
  );
});

test('ActionCentre: switching back to Needs action now hides the tail again', async () => {
  const host = mount();
  await settle();
  q(host, '.cora-ac-toggle-btn')[1]._fire('click'); // All
  await settle();
  assert.ok(group(host, 'reviewRequired'));

  q(host, '.cora-ac-toggle-btn')[0]._fire('click'); // Needs action now
  await settle();
  assert.equal(group(host, 'reviewRequired'), undefined);
});

test('ActionCentre: re-clicking the active toggle is a no-op', async () => {
  const host = mount();
  await settle();

  q(host, '.cora-ac-toggle-btn')[0]._fire('click');
  await settle();
  assert.equal(
    group(host, 'overdue').querySelector('.cora-ac-count--overdue').textContent,
    '6'
  );
});

test('ActionCentre: Open dispatches the case to onOpenCase', async () => {
  /** @type {CaseRow | null} */
  let opened = null;
  const host = ActionCentre({
    client: makeClient(reviewerCases()),
    capabilities: caps({ isReviewer: true }),
    currentUserId: ME,
    allCaseSources: [SOURCE],
    onOpenCase: (row) => {
      opened = row;
    },
    now: NOW,
  });
  await settle();

  findByClass(group(host, 'overdue'), 'cora-ac-open')._fire('click');
  assert.equal(/** @type {any} */ (opened)?.id, 'both-1');
});

test('ActionCentre: Open without an onOpenCase handler does not throw', async () => {
  const host = mount();
  await settle();
  assert.doesNotThrow(() =>
    findByClass(group(host, 'overdue'), 'cora-ac-open')._fire('click')
  );
});

test('ActionCentre: a row without a title falls back to its id', async () => {
  const host = mount(caps({ isReviewer: true }), [
    caseRow('od-x', { title: '', dueDate: PAST, responsibleParty: 'RP' }),
  ]);
  await settle();
  assert.deepEqual(rowRefs(group(host, 'overdue')), ['od-x']);
});

test('ActionCentre: an empty worklist shows a friendly note', async () => {
  const host = mount(caps({ isReviewer: true }), [
    caseRow('done', {
      status: 'Completed',
      completedAt: '2026-01-01T00:00:00Z',
    }),
  ]);
  await settle();

  assert.ok(findByClass(host, 'cora-empty cora-ac-empty'));
  assert.equal(findAllByClass(host, 'cora-ac-group').length, 0);
});

test('ActionCentre: a client without countCases degrades to the empty note', async () => {
  const host = ActionCentre({
    client: /** @type {any} */ ({ listCases: async () => [] }),
    capabilities: caps({ isReviewer: true }),
    currentUserId: ME,
    now: NOW,
  });
  await settle();
  assert.ok(findByClass(host, 'cora-empty cora-ac-empty'));
});

test('ActionCentre: a null client renders the empty note and its toggle stays inert', async () => {
  const host = ActionCentre({
    client: null,
    capabilities: caps({ isReviewer: true }),
    currentUserId: ME,
    now: NOW,
  });
  await settle();
  assert.ok(findByClass(host, 'cora-empty cora-ac-empty'));

  assert.doesNotThrow(() => q(host, '.cora-ac-toggle-btn')[1]._fire('click'));
  await settle();
  assert.ok(findByClass(host, 'cora-empty cora-ac-empty'));
});

test('ActionCentre: a visitor with no worklist reasons shows the empty note', async () => {
  const host = mount(caps({ isVisitor: true }));
  await settle();
  assert.ok(findByClass(host, 'cora-empty cora-ac-empty'));
  assert.equal(findAllByClass(host, 'cora-ac-group').length, 0);
});

test('ActionCentre: multi-role user sees every non-tail reason by default', async () => {
  const cases = [
    caseRow('od-1', { dueDate: PAST }),
    caseRow('ap-1', {
      status: 'Completed',
      completedAt: '2026-06-10T00:00:00Z',
      hasOpenAppeal: true,
      appealRaisedAt: '2026-06-28T00:00:00Z',
    }),
    caseRow('re-1', { reopened: true, reopenedAt: '2026-06-29T00:00:00Z' }),
  ];
  const host = mount(
    caps({
      isReviewer: true,
      isControls: true,
      ownedCaseTypes: ['complaints'],
    }),
    cases
  );
  await settle();

  assert.deepEqual(groupIds(host), [
    'overdue',
    'awaitingFrontline',
    'appeals',
    'reopened',
  ]);
});

test('ActionCentre: reopened within SLA is not styled as breached', async () => {
  const host = mount(caps({ ownedCaseTypes: ['complaints'] }), [
    caseRow('re-late', { reopened: true, reopenedAt: '2026-06-28T00:00:00Z' }),
    caseRow('re-fresh', { reopened: true, reopenedAt: '2026-07-02T00:00:00Z' }),
  ]);
  await settle();

  const g = group(host, 'reopened');
  const breached = findAllByClass(g, 'cora-ac-wait cora-ac-wait--reopened');
  const within = findAllByClass(g, 'cora-ac-wait');
  assert.equal(breached.length, 1);
  assert.equal(within.length, 1);
});

// ===== Multi-source fan-out (Cases spread across several lists) =====

/**
 * A hand-rolled fake client — like the other per-list fetcher test suites
 * (`team-cases-fetcher.test.js`, `journey-cases-fetcher.test.js`) — that
 * actually scopes `listCases`/`countCases` to `opts.listName`, unlike
 * `MockSharePointClient` (which aggregates every list regardless of
 * `listName`). Needed here because the behaviour under test — summing counts
 * and merging worst-first rows across lists — only shows up when each list's
 * query really is list-scoped.
 *
 * @param {Record<string, CaseRow[]>} listsByName
 */
function makeMultiListClient(listsByName) {
  /** @param {CaseRow} row @param {any} filter @returns {boolean} */
  function matches(row, filter) {
    if (filter.anyOf)
      return filter.anyOf.some(/** @param {any} f */ (f) => matches(row, f));
    if (filter.overdue === true) {
      if (row.status === 'Completed') return false;
      if (!row.dueDate) return false;
      if (new Date(row.dueDate) >= NOW) return false;
    }
    const anyRow = /** @type {any} */ (row);
    for (const key of [
      'assignedReviewer',
      'awaitingResponsibleParty',
      'reviewRequired',
      'hasOpenAppeal',
      'reopened',
    ]) {
      if (filter[key] === undefined) continue;
      const actual =
        key === 'assignedReviewer' ? anyRow[key] : Boolean(anyRow[key]);
      if (actual !== filter[key]) return false;
    }
    return true;
  }

  return {
    /** @param {any} filter @param {any} opts */
    async countCases(filter, opts = {}) {
      const rows = listsByName[opts.listName] ?? [];
      return rows.filter((r) => matches(r, filter)).length;
    },
    /** @param {any} filter @param {any} opts */
    async listCases(filter, opts = {}) {
      let rows = (listsByName[opts.listName] ?? []).filter((r) =>
        matches(r, filter)
      );
      if (opts.orderBy) {
        const key = opts.orderBy;
        const dir = opts.orderDir === 'desc' ? -1 : 1;
        rows = rows.slice().sort((a, b) => {
          const av = /** @type {any} */ (a)[key] ?? '';
          const bv = /** @type {any} */ (b)[key] ?? '';
          if (av < bv) return -1 * dir;
          if (av > bv) return 1 * dir;
          return 0;
        });
      }
      const skip = opts.skip ?? 0;
      const end = opts.top !== undefined ? skip + opts.top : undefined;
      return rows.slice(skip, end).map((c) => ({ ...c }));
    },
  };
}

const SOURCE_A = { slug: 'a', listName: 'ListA', displayName: 'A' };
const SOURCE_B = { slug: 'b', listName: 'ListB', displayName: 'B' };

test('ActionCentre: per-reason and headline counts sum across every Case source', async () => {
  const client = makeMultiListClient({
    ListA: [
      caseRow('a1', { dueDate: '2020-01-01T00:00:00Z' }),
      caseRow('a2', { dueDate: '2020-01-05T00:00:00Z' }),
    ],
    ListB: [
      caseRow('b1', { dueDate: '2020-01-03T00:00:00Z' }),
      caseRow('b2', { dueDate: '2020-01-02T00:00:00Z' }),
    ],
  });
  const host = ActionCentre({
    client: /** @type {any} */ (client),
    capabilities: caps({ isReviewer: true }),
    currentUserId: ME,
    allCaseSources: [SOURCE_A, SOURCE_B],
    now: NOW,
  });
  await settle();

  assert.equal(
    group(host, 'overdue').querySelector('.cora-ac-count--overdue').textContent,
    '4',
    'a1+a2+b1+b2, summed across both lists'
  );
  assert.ok(
    findByClass(host, 'cora-ac-subtitle').textContent.startsWith('4 cases')
  );
});

test("ActionCentre: the collapsed-group peek is the global worst across lists, not just the first list's", async () => {
  const client = makeMultiListClient({
    // ListA's own worst is a1 (2020-01-01); ListB's own worst is b2
    // (2020-01-02). The global worst is still a1 — verifies the peek isn't
    // just "first source's worst" or "last source's worst".
    ListA: [
      caseRow('a1', { dueDate: '2020-01-01T00:00:00Z' }),
      caseRow('a2', { dueDate: '2020-01-05T00:00:00Z' }),
    ],
    ListB: [
      caseRow('b1', { dueDate: '2020-01-03T00:00:00Z' }),
      caseRow('b2', { dueDate: '2020-01-02T00:00:00Z' }),
    ],
  });
  const host = ActionCentre({
    client: /** @type {any} */ (client),
    capabilities: caps({ isReviewer: true }),
    currentUserId: ME,
    allCaseSources: [SOURCE_A, SOURCE_B],
    now: NOW,
  });
  await settle();

  // Collapse the auto-expanded overdue group to see its peek.
  findByClass(group(host, 'overdue'), 'cora-ac-group-header')._fire('click');
  await settle();

  const peek = findByClass(group(host, 'overdue'), 'cora-ac-peek');
  assert.ok(peek);
  assert.ok(textOf(peek).includes('a1'), `expected a1, got: ${textOf(peek)}`);
});

test('ActionCentre: a page over-fetches, merges, and slices worst-first across lists; a short merged page still corrects the count', async () => {
  const client = makeMultiListClient({
    ListA: [
      caseRow('a1', { dueDate: '2020-01-01T00:00:00Z' }), // rank 1
      caseRow('a2', { dueDate: '2020-01-05T00:00:00Z' }), // rank 4
      caseRow('a3', { dueDate: '2020-01-07T00:00:00Z' }), // rank 6
    ],
    ListB: [
      caseRow('b1', { dueDate: '2020-01-03T00:00:00Z' }), // rank 3
      caseRow('b2', { dueDate: '2020-01-02T00:00:00Z' }), // rank 2
      caseRow('b3', { dueDate: '2020-01-06T00:00:00Z' }), // rank 5
    ],
  });
  const host = ActionCentre({
    client: /** @type {any} */ (client),
    capabilities: caps({ isReviewer: true }),
    currentUserId: ME,
    allCaseSources: [SOURCE_A, SOURCE_B],
    now: NOW,
  });
  await settle();

  // First page (PAGE_SIZE = 4): global worst-first order across both lists.
  assert.deepEqual(rowRefs(group(host, 'overdue')), ['a1', 'b2', 'b1', 'a2']);

  // "Show more": only 2 Cases remain (b3, a3) — fewer than PAGE_SIZE, so the
  // merged page is short and corrects the header count to the true total (6).
  const more = findByClass(group(host, 'overdue'), 'cora-ac-more');
  assert.equal(more.textContent, 'Show 2 more overdue →');
  more._fire('click');
  await settle();

  assert.deepEqual(rowRefs(group(host, 'overdue')), [
    'a1',
    'b2',
    'b1',
    'a2',
    'b3',
    'a3',
  ]);
  assert.equal(findByClass(group(host, 'overdue'), 'cora-ac-more'), null);
  assert.equal(
    group(host, 'overdue').querySelector('.cora-ac-count--overdue').textContent,
    '6'
  );
});

test('ActionCentre: with no eligible Case sources, degrades to zero counts and no rows', async () => {
  const host = ActionCentre({
    client: /** @type {any} */ (makeMultiListClient({})),
    capabilities: caps({ isReviewer: true }),
    currentUserId: ME,
    allCaseSources: [],
    now: NOW,
  });
  await settle();

  assert.ok(findByClass(host, 'cora-empty cora-ac-empty'));
});

// ===== Pure view tests (branches awkward to reach via the orchestrator) =====

/**
 * Minimal reason stub for the pure view.
 * @type {import('../src/services/action-centre-model.js').Reason}
 */
const stubReason = {
  id: 'overdue',
  label: 'Overdue',
  role: 'Reviewer',
  tone: 'overdue',
  clockField: 'dueDate',
  flagField: 'overdue',
  filter: { overdue: true },
  slaDays: 0,
  reviewerScoped: true,
  tailOnly: false,
  requires: () => true,
  waitingLabel: (/** @type {number} */ d) => `${d} days over`,
  subLine: () => '',
};

test('ActionCentreView: singular headline reads "1 case"', () => {
  const view = ActionCentreView(
    {
      reasons: [stubReason],
      counts: { overdue: 1 },
      headline: 1,
      peeks: {},
      expanded: new Set(),
      pages: {},
      needsActionNow: true,
      now: NOW,
    },
    {
      onToggleNeedsAction() {},
      onToggleGroup() {},
      onShowMore() {},
      onOpenCase() {},
    }
  );
  assert.ok(
    findByClass(view, 'cora-ac-subtitle').textContent.startsWith('1 case ·')
  );
});

test('ActionCentreView: the All state marks the All button pressed', () => {
  const view = ActionCentreView(
    {
      reasons: [stubReason],
      counts: { overdue: 2 },
      headline: 2,
      peeks: {},
      expanded: new Set(),
      pages: {},
      needsActionNow: false,
      now: NOW,
    },
    {
      onToggleNeedsAction() {},
      onToggleGroup() {},
      onShowMore() {},
      onOpenCase() {},
    }
  );
  const needs = walkFind(view, 'Needs action now');
  const all = walkFind(view, 'All');
  assert.equal(needs.getAttribute('aria-pressed'), 'false');
  assert.equal(all.getAttribute('aria-pressed'), 'true');
  assert.ok(all.className.includes('cora-ac-toggle-btn--on'));
});

test('ActionCentreView: a two-reason row with an empty sub-line omits the leading separator', () => {
  const row = caseRow('multi', {
    overdue: true,
    awaitingResponsibleParty: true,
    responsibleParty: '',
    assignedReviewer: '',
  });
  const view = ActionCentreView(
    {
      reasons: [stubReason],
      counts: { overdue: 1 },
      headline: 1,
      peeks: {},
      expanded: new Set(['overdue']),
      pages: { overdue: [row] },
      needsActionNow: true,
      now: NOW,
    },
    {
      onToggleNeedsAction() {},
      onToggleGroup() {},
      onShowMore() {},
      onOpenCase() {},
    }
  );
  assert.equal(
    findByClass(view, 'cora-ac-row-sub').textContent,
    'also Awaiting Frontline'
  );
});

/** @param {any} root @param {string} text */
function walkFind(root, text) {
  /** @type {any} */
  let found = null;
  walk(root, (n) => {
    if (!found && n.textContent === text) found = n;
  });
  return found;
}
