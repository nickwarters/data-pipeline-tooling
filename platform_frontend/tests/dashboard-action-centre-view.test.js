// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { makeCaseRow, makePermissions } from './helpers/fixtures.js';

installDom();

const {
  ActionCentreView,
  PAGE_SIZE,
  initialActionCentreState,
  loadActionCentreCounts,
  loadActionCentrePage,
} = await import('../src/pages/dashboard/action-centre-view.js');

// Reasons are unlocked one capability at a time, so the baseline grants none.
/** @param {Partial<import('../src/services/permissions.js').Capabilities>} [overrides] */
function capabilities(overrides = {}) {
  return makePermissions({ isReviewer: false, ...overrides });
}

// Long overdue by default: every row here is meant to qualify for the Overdue
// reason unless a test overrides its clock.
/** @param {string} id */
function row(id) {
  return makeCaseRow({
    id,
    title: id,
    assignedReviewer: 'me',
    responsibleParty: 'rp',
    dueDate: '2020-01-01T00:00:00Z',
    overdue: true,
    etag: 'e',
  });
}

test('Action Centre state derives its reason descriptors from unchanged model flags', () => {
  const reviewer = initialActionCentreState(
    capabilities({ isReviewer: true }),
    [],
    new Date('2026-07-04T00:00:00Z')
  );
  assert.deepEqual(
    reviewer.reasons.map((reason) => reason.id),
    ['overdue', 'awaitingFrontline']
  );
  const multiRole = initialActionCentreState(
    capabilities({
      isReviewer: true,
      isControls: true,
      ownedCaseTypes: ['complaints'],
    }),
    []
  );
  assert.deepEqual(
    multiRole.reasons.map((reason) => reason.id),
    ['overdue', 'awaitingFrontline', 'appeals']
  );
});

test('Action Centre actions sum counts and merge a bounded worst-first page across sources', async () => {
  const reason = initialActionCentreState(
    capabilities({ isReviewer: true }),
    []
  ).reasons[0];
  /** @type {Record<string, import('../src/sharepoint-client.js').CaseRow[]>} */
  const lists = {
    A: [row('a1'), row('a2'), row('a3')],
    B: [row('b1'), row('b2')],
  };
  const client = /** @type {any} */ ({
    async countCases(/** @type {any} */ _filter, /** @type {any} */ options) {
      return lists[options.listName].length;
    },
    async listCases(/** @type {any} */ _filter, /** @type {any} */ options) {
      return lists[options.listName].slice(0, options.top);
    },
  });
  const sources = [
    { slug: 'a', listName: 'A', displayName: 'A' },
    { slug: 'b', listName: 'B', displayName: 'B' },
  ];
  const counts = await loadActionCentreCounts({
    client,
    sources,
    reasons: [reason],
    currentUserId: 'me',
  });
  const page = await loadActionCentrePage({
    client,
    sources,
    reason,
    currentUserId: 'me',
    skip: 0,
  });

  assert.equal(counts.counts.overdue, 5);
  assert.equal(counts.headline, 5);
  assert.equal(page.rows.length, PAGE_SIZE);
  assert.equal(page.exhausted, false);

  const tail = await loadActionCentrePage({
    client,
    sources,
    reason,
    currentUserId: 'me',
    skip: PAGE_SIZE,
  });
  assert.equal(tail.rows.length, 1);
  assert.equal(tail.exhausted, true);
});

test('Action Centre pure view renders descriptor rows and exposes store callbacks', () => {
  const state = initialActionCentreState(
    capabilities({ isReviewer: true }),
    [],
    new Date('2026-07-04T00:00:00Z')
  );
  const reason = state.reasons[0];
  state.counts = { overdue: 2, awaitingFrontline: 0 };
  state.headline = 2;
  state.expanded = new Set(['overdue']);
  state.pages = { overdue: [row('c1')] };
  /** @type {string[]} */
  const actions = [];
  const view = ActionCentreView(state, {
    onToggleNeedsAction: (value) => actions.push(`scope:${value}`),
    onToggleGroup: (item) => actions.push(`group:${item.id}`),
    onShowMore: (item) => actions.push(`more:${item.id}`),
    onOpenCase: (item) => actions.push(`open:${item.id}`),
  });
  assert.equal(view.querySelector('h2')?.textContent, 'Action Centre');
  assert.match(view.textContent, /2 cases · grouped by reason/);
  assert.equal(
    view.querySelector('a')?.getAttribute('href'),
    '#/case/complaints/c1'
  );

  const buttons = [...view.querySelectorAll('button')];
  const needs = /** @type {any} */ (
    buttons.find((button) => button.textContent === 'Needs action now')
  );
  const all = /** @type {any} */ (
    buttons.find((button) => button.textContent === 'All')
  );
  const group = /** @type {any} */ (
    buttons.find((button) => button.className === 'cora-ac-group-header')
  );
  const open = /** @type {any} */ (
    buttons.find((button) => button.className === 'cora-ac-open')
  );
  const more = /** @type {any} */ (
    buttons.find((button) => button.className === 'cora-ac-more')
  );
  needs?._fire('click', {});
  all?._fire('click', {});
  group?._fire('click', {});
  open?._fire('click', {});
  more?._fire('click', {});
  needs?._fire('click', {});
  all?._fire('click', {});
  group?._fire('click', {});
  open?._fire('click', {});
  more?._fire('click', {});
  needs?._fire('click', {});
  all?._fire('click', {});
  group?._fire('click', {});
  open?._fire('click', {});
  more?._fire('click', {});
  assert.equal(actions.length, 15);
  assert.ok(actions.includes(`group:${reason.id}`));

  // Existing DOM-stub debt retained until the shared debt ledger can move.
  assert.ok(/** @type {any} */ (view)._children);
  assert.ok(/** @type {any} */ (view)._children.length > 0);
  assert.ok(/** @type {any} */ (view)._children[0]);
});

test('Action Centre pure view renders collapsed peeks and the true empty state', () => {
  const state = initialActionCentreState(
    capabilities({ isReviewer: true }),
    [],
    new Date('2026-07-04T00:00:00Z')
  );
  state.counts = { overdue: 1, awaitingFrontline: 0 };
  state.headline = 1;
  state.peeks = { overdue: row('peek') };
  const handlers = {
    onToggleNeedsAction: () => {},
    onToggleGroup: () => {},
    onShowMore: () => {},
    onOpenCase: () => {},
  };
  const collapsed = ActionCentreView(state, handlers);
  assert.match(
    collapsed.querySelector('.cora-ac-peek')?.textContent ?? '',
    /peek/
  );

  const empty = ActionCentreView(
    { ...state, counts: {}, headline: 0, peeks: {} },
    handlers
  );
  assert.match(empty.textContent, /Nothing needs your action right now/);
});

test('Action Centre rows preserve fallback references, secondary reasons, and within-SLA clocks', () => {
  const state = initialActionCentreState(
    capabilities({
      isReviewer: true,
      isControls: true,
    }),
    [],
    new Date('2026-07-04T00:00:00Z')
  );
  const appeals = state.reasons.find((reason) => reason.id === 'appeals');
  assert.ok(appeals);
  const appealRow = {
    ...row('fallback-id'),
    title: '',
    overdue: true,
    hasOpenAppeal: true,
    appealRaisedAt: '2026-07-03T00:00:00Z',
  };
  state.counts = { appeals: 1, overdue: 1 };
  state.headline = 1;
  state.expanded = new Set(['appeals']);
  state.pages = { appeals: [appealRow] };
  const view = ActionCentreView(state, {
    onToggleNeedsAction: () => {},
    onToggleGroup: () => {},
    onShowMore: () => {},
    onOpenCase: () => {},
  });

  const groups = [...view.querySelectorAll('.cora-ac-group')];
  const appealsGroup = groups.find(
    (group) => group.getAttribute('data-reason') === 'appeals'
  );
  assert.equal(
    appealsGroup?.querySelector('.cora-ac-row-ref')?.textContent,
    'fallback-id'
  );
  assert.match(
    appealsGroup?.querySelector('.cora-ac-row-sub')?.textContent ?? '',
    /also Overdue/
  );
  assert.equal(
    appealsGroup?.querySelector('.cora-ac-wait')?.className,
    'cora-ac-wait'
  );
  assert.equal(appealsGroup?.querySelector('.cora-ac-more'), null);
  const awaitingGroup = groups.find(
    (group) => group.getAttribute('data-reason') === 'awaitingFrontline'
  );
  assert.equal(
    awaitingGroup?.querySelector('.cora-ac-count')?.textContent,
    '0'
  );
});

// Owning a Case Type is no longer a reason to act on anything, so an Owner
// holding no other role reaches the loader with an empty reason list. The
// headline is the OR of those reasons: with none, it is zero and the client is
// never asked — an OR of no branches is not a query the two clients agree on.
test('Action Centre asks nothing at all for a viewer with no reasons', async () => {
  const state = initialActionCentreState(
    capabilities({ ownedCaseTypes: ['complaints'] }),
    []
  );
  assert.deepEqual(state.reasons, []);

  let asked = 0;
  const result = await loadActionCentreCounts({
    client: /** @type {any} */ ({
      countCases: async () => {
        asked += 1;
        return 99;
      },
      listCases: async () => [],
    }),
    sources: [
      {
        slug: 'complaints',
        displayName: 'Complaints',
        listName: 'Cases-Complaints',
      },
    ],
    reasons: state.reasons,
    currentUserId: 'owner-1',
  });

  assert.equal(asked, 0);
  assert.deepEqual(result, { counts: {}, peeks: {}, headline: 0 });
});

test("Action Centre judges a row's wait against its own Case Type's cadence", () => {
  // Two Case Types, one of which allows the Responsible Party 30 days to reply
  // where the framework allows 7. Two rows waiting the same 10 days: the
  // divergent Case Type's is still within its SLA, the other's has breached.
  const now = new Date('2026-07-11T00:00:00Z');
  const state = initialActionCentreState(
    capabilities({ isReviewer: true }),
    [
      { slug: 'complaints', listName: 'A', displayName: 'Complaints' },
      {
        slug: 'example-review',
        listName: 'B',
        displayName: 'Example Review',
        actionCentreSlaDays: { awaitingFrontline: 30 },
      },
    ],
    now
  );
  /** @param {string} slug */
  const waitingRow = (slug) => ({
    ...row(`${slug}-1`),
    caseType: slug,
    awaitingResponsibleParty: true,
    awaitingSince: '2026-07-01T00:00:00Z',
  });
  state.counts = { awaitingFrontline: 2 };
  state.expanded = new Set(['awaitingFrontline']);
  state.pages = {
    awaitingFrontline: [waitingRow('complaints'), waitingRow('example-review')],
  };

  const view = ActionCentreView(state, {
    onToggleNeedsAction: () => {},
    onToggleGroup: () => {},
    onShowMore: () => {},
    onOpenCase: () => {},
  });
  const group = [...view.querySelectorAll('.cora-ac-group')].find(
    (g) => g.getAttribute('data-reason') === 'awaitingFrontline'
  );
  const classes = [...(group?.querySelectorAll('.cora-ac-wait') ?? [])].map(
    (chip) => chip.className
  );
  assert.deepEqual(classes, [
    'cora-ac-wait cora-ac-wait--awaiting',
    'cora-ac-wait',
  ]);
});
