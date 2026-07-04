// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass, findAllByClass, walk } from './_dom-stub.js';

installDom();

const { ActionCentre, ActionCentreView, PAGE_SIZE } =
  await import('../src/pages/cora-action-centre.js');
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

/** @param {string} id @param {Partial<CaseRow>} [over] @returns {CaseRow} */
function caseRow(id, over = {}) {
  return /** @type {CaseRow} */ ({
    id,
    caseType: 'complaints',
    title: id,
    status: 'In-progress',
    assignedReviewer: '',
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
 * Reviewer fixture: 5 overdue-only, one overdue+awaiting ("both"), two
 * awaiting-only cases. `both` sorts worst (earliest dueDate) so it lands on the
 * overdue group's first page.
 * @returns {CaseRow[]}
 */
function reviewerCases() {
  const overdueOnly = [1, 2, 3, 4, 5].map((n) =>
    caseRow(`od-${n}`, {
      dueDate: `2020-01-0${n}T00:00:00Z`,
      responsibleParty: `RP-${n}`,
      assignedReviewer: `REV-${n}`,
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
  return [...overdueOnly, both, ...awaitingOnly];
}

/** @param {CaseRow[]} cases */
function makeClient(cases) {
  return new MockSharePointClient({
    cases,
    questionDefinitions: [],
    personas: { reviewer: { groups: [] } },
  });
}

/** @param {any} root @param {string} reasonId */
function group(root, reasonId) {
  return findAllByClass(root, 'cora-ac-group').find(
    (g) => g.getAttribute('data-reason') === reasonId
  );
}

/** @param {any} root @returns {string[]} row refs in order */
function rowRefs(root) {
  return findAllByClass(root, 'cora-ac-row-ref').map((a) => a.textContent);
}

// ===== TESTS =====

test('ActionCentre: reviewer sees a header, toggle, and both reviewer groups', async () => {
  const host = ActionCentre({
    client: makeClient(reviewerCases()),
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();

  assert.ok(findByClass(host, 'cora-action-centre'), 'renders the section');
  assert.equal(
    findByClass(host, 'cora-ac-title')?.textContent,
    'Action Centre'
  );
  assert.equal(host.querySelectorAll('.cora-ac-toggle-btn').length, 2);

  const groups = findAllByClass(host, 'cora-ac-group').map((g) =>
    g.getAttribute('data-reason')
  );
  assert.deepEqual(groups, ['overdue', 'awaitingRp']);
});

test('ActionCentre: group headers show the server-side count', async () => {
  const host = ActionCentre({
    client: makeClient(reviewerCases()),
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();

  const overdueCount = group(host, 'overdue').querySelector(
    '.cora-ac-count--overdue'
  );
  assert.equal(overdueCount.textContent, '6', 'od-1..5 + both = 6');
  // Needs-action-now narrows Awaiting RP to the overdue-and-awaiting case.
  const awaitingCount = group(host, 'awaitingRp').querySelector(
    '.cora-ac-count--awaiting'
  );
  assert.equal(awaitingCount.textContent, '1');
});

test('ActionCentre: the top-priority group auto-expands and pages worst-first', async () => {
  const host = ActionCentre({
    client: makeClient(reviewerCases()),
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();

  // First page is PAGE_SIZE rows, oldest dueDate first (both-1 is worst).
  const refs = rowRefs(group(host, 'overdue'));
  assert.equal(refs.length, PAGE_SIZE);
  assert.deepEqual(refs, ['both-1', 'od-1', 'od-2', 'od-3']);
});

test('ActionCentre: a two-reason row notes its secondary reason inline', async () => {
  const host = ActionCentre({
    client: makeClient(reviewerCases()),
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();

  const subs = findAllByClass(group(host, 'overdue'), 'cora-ac-row-sub').map(
    (d) => d.textContent
  );
  assert.ok(
    subs.some((s) => s.includes('RP-Both') && s.includes('also Awaiting RP')),
    `expected an "also Awaiting RP" note, got: ${JSON.stringify(subs)}`
  );
});

test('ActionCentre: overdue rows carry the breached waiting style', async () => {
  const host = ActionCentre({
    client: makeClient(reviewerCases()),
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();

  const waits = findAllByClass(
    group(host, 'overdue'),
    'cora-ac-wait cora-ac-wait--overdue'
  );
  assert.ok(waits.length > 0, 'overdue is breached by definition');
  assert.ok(waits[0].textContent.includes('over'));
});

test('ActionCentre: "Show N more" pages the rest and corrects the count on the final page', async () => {
  const host = ActionCentre({
    client: makeClient(reviewerCases()),
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();

  const more = findByClass(group(host, 'overdue'), 'cora-ac-more');
  assert.equal(more.textContent, 'Show 2 more overdue →');

  more._fire('click');
  await settle();

  const refs = rowRefs(group(host, 'overdue'));
  assert.equal(refs.length, 6, 'all overdue rows are now in the DOM');
  assert.equal(
    findByClass(group(host, 'overdue'), 'cora-ac-more'),
    null,
    'pager gone once fully paged'
  );
});

test('ActionCentre: collapsed groups show a worst-item peek', async () => {
  const host = ActionCentre({
    client: makeClient(reviewerCases()),
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();

  // Awaiting RP is collapsed by default; its peek is the one overdue+awaiting case.
  const peek = findByClass(group(host, 'awaitingRp'), 'cora-ac-peek');
  assert.ok(peek, 'collapsed group has a peek');
  assert.ok(textOf(peek).includes('both-1'));
  assert.ok(textOf(peek).includes('no reply'));
});

test('ActionCentre: toggling a group header collapses and re-expands it', async () => {
  const host = ActionCentre({
    client: makeClient(reviewerCases()),
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();

  const header = () =>
    findByClass(group(host, 'overdue'), 'cora-ac-group-header');
  assert.ok(findByClass(group(host, 'overdue'), 'cora-ac-rows'), 'starts open');

  header()._fire('click');
  await settle();
  assert.equal(
    findByClass(group(host, 'overdue'), 'cora-ac-rows'),
    null,
    'collapsed'
  );

  header()._fire('click');
  await settle();
  assert.ok(findByClass(group(host, 'overdue'), 'cora-ac-rows'), 're-expanded');
});

test('ActionCentre: expanding a second group loads its rows', async () => {
  const host = ActionCentre({
    client: makeClient(reviewerCases()),
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();

  assert.equal(findByClass(group(host, 'awaitingRp'), 'cora-ac-rows'), null);
  findByClass(group(host, 'awaitingRp'), 'cora-ac-group-header')._fire('click');
  await settle();

  assert.deepEqual(rowRefs(group(host, 'awaitingRp')), ['both-1']);
});

test('ActionCentre: the All toggle broadens the counts, and back again', async () => {
  const host = ActionCentre({
    client: makeClient(reviewerCases()),
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();

  const allBtn = q(host, '.cora-ac-toggle-btn')[1];
  allBtn._fire('click');
  await settle();

  assert.equal(
    group(host, 'awaitingRp').querySelector('.cora-ac-count--awaiting')
      .textContent,
    '3',
    'All shows every awaiting case, not just the overdue ones'
  );

  // Toggling back to the same value is a no-op; toggling to needs-action restores.
  const needsBtn = q(host, '.cora-ac-toggle-btn')[0];
  needsBtn._fire('click');
  await settle();
  assert.equal(
    group(host, 'awaitingRp').querySelector('.cora-ac-count--awaiting')
      .textContent,
    '1'
  );
});

test('ActionCentre: re-clicking the active toggle is a no-op', async () => {
  const host = ActionCentre({
    client: makeClient(reviewerCases()),
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();

  // "Needs action now" is already active — clicking it must not change counts.
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
  const host = ActionCentre({
    client: makeClient(reviewerCases()),
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();

  assert.doesNotThrow(() =>
    findByClass(group(host, 'overdue'), 'cora-ac-open')._fire('click')
  );
});

test('ActionCentre: a row without a title falls back to its id', async () => {
  const host = ActionCentre({
    client: makeClient([
      caseRow('od-x', { title: '', dueDate: PAST, responsibleParty: 'RP' }),
    ]),
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();

  assert.deepEqual(rowRefs(group(host, 'overdue')), ['od-x']);
});

test('ActionCentre: an empty worklist shows a friendly note', async () => {
  const host = ActionCentre({
    client: makeClient([
      caseRow('done', {
        status: 'Completed',
        completedAt: '2026-01-01T00:00:00Z',
      }),
    ]),
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();

  assert.ok(findByClass(host, 'cora-ac-empty'), 'shows the empty note');
  assert.equal(findAllByClass(host, 'cora-ac-group').length, 0);
});

test('ActionCentre: a client without countCases degrades to the empty note', async () => {
  const host = ActionCentre({
    client: /** @type {any} */ ({ listCases: async () => [] }),
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();

  assert.ok(findByClass(host, 'cora-ac-empty'));
});

test('ActionCentre: a null client renders the empty note and its toggle stays inert', async () => {
  const host = ActionCentre({
    client: null,
    capabilities: caps({ isReviewer: true }),
    now: NOW,
  });
  await settle();
  assert.ok(findByClass(host, 'cora-ac-empty'));

  // The header/toggle still render; clicking must not throw with no client.
  assert.doesNotThrow(() => q(host, '.cora-ac-toggle-btn')[1]._fire('click'));
  await settle();
  assert.ok(findByClass(host, 'cora-ac-empty'), 'still inert after toggling');
});

test('ActionCentre: a visitor with no worklist reasons shows the empty note', async () => {
  const host = ActionCentre({
    client: makeClient(reviewerCases()),
    capabilities: caps({ isVisitor: true }),
    now: NOW,
  });
  await settle();

  assert.ok(findByClass(host, 'cora-ac-empty'));
  assert.equal(findAllByClass(host, 'cora-ac-group').length, 0);
});

test('ActionCentre: multi-role user sees all four reason groups', async () => {
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
  const host = ActionCentre({
    client: makeClient(cases),
    capabilities: caps({
      isReviewer: true,
      isControls: true,
      ownedCaseTypes: ['complaints'],
    }),
    now: NOW,
  });
  await settle();

  assert.deepEqual(
    findAllByClass(host, 'cora-ac-group').map((g) =>
      g.getAttribute('data-reason')
    ),
    ['overdue', 'awaitingRp', 'appeals', 'reopened']
  );
});

test('ActionCentre: reopened within SLA is not styled as breached', async () => {
  const host = ActionCentre({
    client: makeClient([
      caseRow('re-late', {
        reopened: true,
        reopenedAt: '2026-06-28T00:00:00Z',
      }), // 6 days
      caseRow('re-fresh', {
        reopened: true,
        reopenedAt: '2026-07-02T00:00:00Z',
      }), // 2 days
    ]),
    capabilities: caps({ ownedCaseTypes: ['complaints'] }),
    now: NOW,
  });
  await settle();

  const g = group(host, 'reopened');
  const breached = findAllByClass(g, 'cora-ac-wait cora-ac-wait--reopened');
  const within = findAllByClass(g, 'cora-ac-wait');
  assert.equal(breached.length, 1, 're-late (6d) is breached');
  assert.equal(within.length, 1, 're-fresh (2d) is plain');
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
  needsActionFilter: { overdue: true },
  slaDays: 0,
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
  const [needs, all] = findAllByClass(view, 'cora-ac-toggle-btn').length
    ? [walkFind(view, 'Needs action now'), walkFind(view, 'All')]
    : [];
  assert.equal(needs.getAttribute('aria-pressed'), 'false');
  assert.equal(all.getAttribute('aria-pressed'), 'true');
  assert.ok(all.className.includes('cora-ac-toggle-btn--on'));
});

test('ActionCentreView: a two-reason row with an empty sub-line omits the leading separator', () => {
  const row = caseRow('multi', {
    overdue: true,
    awaitingResponsibleParty: true,
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
    'also Awaiting RP'
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
