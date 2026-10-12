// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { makeCaseRow, makePermissions } from './helpers/fixtures.js';

installDom();

const { ACTION_CENTRE_REASONS } =
  await import('../src/services/action-centre-model.js');
const {
  ActionCentreView,
  COPY,
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
    ['overdue', 'awaitingFrontline', 'onHold', 'inProgress']
  );
  const multiRole = initialActionCentreState(
    capabilities({
      isReviewer: true,
      isControls: true,
      ownedCaseTypes: ['complaints'],
    }),
    []
  );
  // 'appeals' is absent only because the Appeals feature switch is off; restore
  // it to the tail of this list when the switch goes.
  assert.deepEqual(
    multiRole.reasons.map((reason) => reason.id),
    ['overdue', 'awaitingFrontline', 'onHold', 'inProgress']
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
    reviewerSources: sources,
    reasons: [reason],
    currentUserId: 'me',
  });
  const page = await loadActionCentrePage({
    client,
    sources,
    reviewerSources: sources,
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
    reviewerSources: sources,
    reason,
    currentUserId: 'me',
    skip: PAGE_SIZE,
  });
  assert.equal(tail.rows.length, 1);
  assert.equal(tail.exhausted, true);
});

/**
 * A client that filters like the real ones on the flags these tests use, so a count reflects which lists were asked.
 * @param {Record<string, any[]>} lists
 */
function filteringClient(lists) {
  /** @param {any} c @param {any} filter @returns {boolean} */
  const matches = (c, filter) =>
    Object.entries(filter).every(([key, value]) =>
      key === 'anyOf'
        ? value.some((/** @type {any} */ branch) => matches(c, branch))
        : Boolean(c[key]) === value || c[key] === value
    );
  return /** @type {any} */ ({
    async countCases(/** @type {any} */ filter, /** @type {any} */ options) {
      return lists[options.listName].filter((c) => matches(c, filter)).length;
    },
    async listCases(/** @type {any} */ filter, /** @type {any} */ options) {
      return lists[options.listName]
        .filter((c) => matches(c, filter))
        .slice(0, options.top);
    },
  });
}

test("Action Centre Reviewer groups read only the lists of the user's own reviewer groups", async () => {
  const reason = initialActionCentreState(
    capabilities({ isReviewer: true }),
    []
  ).reasons[0];
  const client = filteringClient({
    A: [row('a1'), row('a2')],
    // A list the user can read but is not a Reviewer on, holding a Case assigned to them anyway.
    B: [row('b1')],
  });
  const sources = [
    { slug: 'a', listName: 'A', displayName: 'A' },
    { slug: 'b', listName: 'B', displayName: 'B' },
  ];
  const reviewerSources = [sources[0]];

  const counts = await loadActionCentreCounts({
    client,
    sources,
    reviewerSources,
    reasons: [reason],
    currentUserId: 'me',
  });
  const page = await loadActionCentrePage({
    client,
    sources,
    reviewerSources,
    reason,
    currentUserId: 'me',
    skip: 0,
  });

  assert.equal(counts.counts.overdue, 2);
  assert.equal(counts.headline, 2);
  assert.equal(counts.peeks.overdue?.id.startsWith('a'), true);
  assert.deepEqual(page.rows.map((r) => r.id).sort(), ['a1', 'a2']);
});

test('Action Centre headline counts a non-Reviewer group across every list without counting a Case twice', async () => {
  const [overdue] = initialActionCentreState(
    capabilities({ isReviewer: true }),
    []
  ).reasons;
  // Read off the model so the test holds whichever groups the feature switches leave visible.
  const broad = ACTION_CENTRE_REASONS.find((reason) => !reason.reviewerScoped);
  assert.ok(broad);
  const flag = /** @type {string} */ (broad.flagField);
  const other = (/** @type {string} */ id) =>
    makeCaseRow({ id, assignedReviewer: 'someone-else', [flag]: true });
  const client = filteringClient({
    A: [{ ...row('a1'), [flag]: true }, row('a2'), other('a3')],
    B: [row('b1'), other('b2')],
  });
  const sources = [
    { slug: 'a', listName: 'A', displayName: 'A' },
    { slug: 'b', listName: 'B', displayName: 'B' },
  ];

  const counts = await loadActionCentreCounts({
    client,
    sources,
    reviewerSources: [sources[0]],
    reasons: [overdue, broad],
    currentUserId: 'me',
  });

  assert.equal(counts.counts.overdue, 2);
  assert.equal(counts.counts[broad.id], 3);
  // a1 is in both groups and counted once; b1 is on a list the user does not review, so it is in neither.
  assert.equal(counts.headline, 4);
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
    onToggleGroup: (item) => actions.push(`group:${item.id}`),
    onShowMore: (item) => actions.push(`more:${item.id}`),
    onOpenCase: (item) => actions.push(`open:${item.id}`),
  });
  assert.equal(view.querySelector('h2')?.textContent, COPY.heading);
  assert.match(view.textContent, /2 cases · grouped by reason/);
  assert.equal(
    view.querySelector('a')?.getAttribute('href'),
    '#/case/complaints/c1'
  );

  const buttons = [...view.querySelectorAll('button')];
  // The scope toggle is gone: one view, no control to switch it.
  assert.equal(view.querySelector('.cora-ac-toggle'), null);
  const group = /** @type {any} */ (
    buttons.find((button) => button.className === 'cora-ac-group-header')
  );
  const open = /** @type {any} */ (
    buttons.find((button) => button.className === 'cora-ac-open')
  );
  const more = /** @type {any} */ (
    buttons.find((button) => button.className === 'cora-ac-more')
  );
  group?._fire('click', {});
  open?._fire('click', {});
  more?._fire('click', {});
  group?._fire('click', {});
  open?._fire('click', {});
  more?._fire('click', {});
  group?._fire('click', {});
  open?._fire('click', {});
  more?._fire('click', {});
  assert.equal(actions.length, 9);
  assert.ok(actions.includes(`group:${reason.id}`));
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
  assert.match(empty.textContent, /Nothing in your worklist right now/);
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
  // Three generic row behaviours, exercised on one group: the reference falls
  // back to the id when a Case has no title, a Case matching more than one
  // reason names the others in its sub-line, and a clock still inside its SLA
  // gets the plain wait class. This used the Appeals group until that feature
  // was switched off; Awaiting Frontline carries the same three properties, and
  // none of the three is specific to either reason.
  const awaiting = state.reasons.find(
    (reason) => reason.id === 'awaitingFrontline'
  );
  assert.ok(awaiting);
  const awaitingRow = {
    ...row('fallback-id'),
    title: '',
    overdue: true,
    awaitingResponsibleParty: true,
    awaitingSince: '2026-07-03T00:00:00Z',
  };
  state.counts = { awaitingFrontline: 1 };
  state.headline = 1;
  state.expanded = new Set(['awaitingFrontline']);
  state.pages = { awaitingFrontline: [awaitingRow] };
  const view = ActionCentreView(state, {
    onToggleGroup: () => {},
    onShowMore: () => {},
    onOpenCase: () => {},
  });

  const groups = [...view.querySelectorAll('.cora-ac-group')];
  const awaitingGroup = groups.find(
    (group) => group.getAttribute('data-reason') === 'awaitingFrontline'
  );
  assert.equal(
    awaitingGroup?.querySelector('.cora-ac-row-ref')?.textContent,
    'fallback-id'
  );
  assert.match(
    awaitingGroup?.querySelector('.cora-ac-row-sub')?.textContent ?? '',
    /also Overdue/
  );
  assert.equal(
    awaitingGroup?.querySelector('.cora-ac-wait')?.className,
    'cora-ac-wait'
  );
  assert.equal(awaitingGroup?.querySelector('.cora-ac-more'), null);
  const overdueGroup = groups.find(
    (group) => group.getAttribute('data-reason') === 'overdue'
  );
  assert.equal(overdueGroup?.querySelector('.cora-ac-count')?.textContent, '0');
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
    reviewerSources: [],
    reasons: state.reasons,
    currentUserId: 'owner-1',
  });

  assert.equal(asked, 0);
  assert.deepEqual(result, { counts: {}, peeks: {}, headline: 0 });
});

test('Action Centre renders the On Hold group below Awaiting Frontline with its own tone and wording', () => {
  const now = new Date('2026-07-04T00:00:00Z');
  const state = initialActionCentreState(
    capabilities({ isReviewer: true }),
    [],
    now
  );
  const parked = {
    ...row('h1'),
    overdue: false,
    dueDate: null,
    onHold: true,
    placedOnHoldAt: '2026-06-13T00:00:00Z', // 21 days — past the 14-day cadence
  };
  state.counts = { overdue: 0, awaitingFrontline: 0, onHold: 6 };
  state.headline = 6;
  state.peeks = { onHold: parked };
  state.expanded = new Set(['onHold']);
  state.pages = { onHold: [parked] };
  const view = ActionCentreView(state, {
    onToggleGroup: () => {},
    onShowMore: () => {},
    onOpenCase: () => {},
  });

  const groups = [...view.querySelectorAll('.cora-ac-group')].map((group) =>
    group.getAttribute('data-reason')
  );
  assert.deepEqual(groups, [
    'overdue',
    'awaitingFrontline',
    'onHold',
    'inProgress',
  ]);

  const holdGroup = [...view.querySelectorAll('.cora-ac-group')].find(
    (group) => group.getAttribute('data-reason') === 'onHold'
  );
  assert.equal(
    holdGroup?.querySelector('.cora-ac-count')?.className,
    'cora-ac-count cora-ac-count--hold'
  );
  assert.equal(
    holdGroup?.querySelector('.cora-ac-dot')?.className,
    'cora-ac-dot cora-ac-dot--hold'
  );
  assert.match(
    holdGroup?.querySelector('.cora-ac-wait')?.textContent ?? '',
    /21 days on hold/
  );
  assert.equal(
    holdGroup?.querySelector('.cora-ac-wait')?.className,
    'cora-ac-wait cora-ac-wait--hold'
  );
  assert.equal(
    holdGroup?.querySelector('.cora-ac-more')?.textContent,
    'Show 5 more on hold →'
  );
});

test('Action Centre renders the In progress group with its own tone and wording', () => {
  const now = new Date('2026-07-04T00:00:00Z');
  const state = initialActionCentreState(
    capabilities({ isReviewer: true }),
    [],
    now
  );
  const held = {
    ...row('p1'),
    created: '2026-01-01T00:00:00Z',
    assignedAt: '2026-06-27T00:00:00Z',
  };
  state.counts = { inProgress: 3 };
  state.headline = 3;
  state.expanded = new Set(['inProgress']);
  state.pages = { inProgress: [held] };
  const view = ActionCentreView(state, {
    onToggleGroup: () => {},
    onShowMore: () => {},
    onOpenCase: () => {},
  });

  const group = [...view.querySelectorAll('.cora-ac-group')].find(
    (item) => item.getAttribute('data-reason') === 'inProgress'
  );
  assert.equal(
    group?.querySelector('.cora-ac-dot')?.className,
    'cora-ac-dot cora-ac-dot--progress'
  );
  assert.equal(
    group?.querySelector('.cora-ac-count')?.className,
    'cora-ac-count cora-ac-count--progress'
  );
  assert.match(
    group?.querySelector('.cora-ac-wait')?.textContent ?? '',
    /7 days in progress/
  );
  assert.equal(
    group?.querySelector('.cora-ac-more')?.textContent,
    'Show 2 more in progress →'
  );
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

test('an Action Centre row marks a Case whose Conversation holds Messages', () => {
  const state = initialActionCentreState(
    capabilities({ isReviewer: true }),
    [],
    new Date('2026-07-04T00:00:00Z')
  );
  const quiet = { ...row('quiet'), conversation: [] };
  const talkative = {
    ...row('talkative'),
    conversation: [/** @type {any} */ ({}), /** @type {any} */ ({})],
  };
  state.counts = { overdue: 2 };
  state.headline = 2;
  state.expanded = new Set(['overdue']);
  state.pages = { overdue: [quiet, talkative] };

  const view = ActionCentreView(state, {
    onToggleGroup: () => {},
    onShowMore: () => {},
    onOpenCase: () => {},
  });
  const overdue = [...view.querySelectorAll('.cora-ac-group')].find(
    (group) => group.getAttribute('data-reason') === 'overdue'
  );
  const rows = [...(overdue?.querySelectorAll('.cora-ac-row') ?? [])];
  assert.equal(rows.length, 2);
  // Only the Case with Messages carries the mark, and it names the count.
  assert.equal(rows[0].querySelector('.cora-case-flag'), null);
  const mark = rows[1].querySelector('.cora-case-flag');
  assert.equal(mark?.getAttribute('aria-label'), '2 messages');
  // Read as an attribute: an SVG element's `className` is a read-only
  // `SVGAnimatedString`, never the string a caller wrote.
  assert.equal(
    mark?.getAttribute('class'),
    'cora-case-flag cora-case-flag--messages'
  );
  // Outside the reference link, so the link still announces just the Case.
  assert.equal(
    rows[1].querySelector('.cora-ac-row-ref')?.textContent,
    'talkative'
  );
  assert.equal(rows[1].querySelector('.cora-ac-row-ref svg'), null);
});
