// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, waitFor, waitForRender } from './_dom-stub.js';
import { assertAllCoraElementsDefined } from './helpers/assert-defined-elements.js';
/** @typedef {import('./_dom-stub.js').StubEl} StubEl */

installDom();

// ===== IMPORTS (after stubs) =====
const { DashboardPage } = await import('../src/pages/cora-dashboard.js');

// ===== HELPERS =====
function makeClient() {
  return {
    async listCases() {
      return [];
    },
  };
}

/**
 * Find every descendant element whose tagName matches.
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

/** @param {any} root */
function hasOutstandingCasesHeading(root) {
  return findAll(root, 'h1').some((h) => h.textContent === 'Outstanding Cases');
}

/** @param {any} root @param {string} className */
function findSection(root, className) {
  return findAll(root, 'section').find((s) => s.className === className);
}

function defaultCapabilities(overrides = {}) {
  return {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
    ...overrides,
  };
}

// ===== TESTS =====

test('DashboardPage: reviewer capability — outstanding Cases heading and allocation visible, no owner summary', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-reviewer',
    capabilities: defaultCapabilities({ isReviewer: true }),
  });
  await waitForRender(host);

  assert.equal(
    hasOutstandingCasesHeading(host),
    true,
    'should render Outstanding Cases heading'
  );
  assert.equal(
    findAll(host, 'cora-allocation').length,
    1,
    'should render allocation button'
  );
  assert.equal(
    findAll(host, 'cora-owner-summary').length,
    0,
    'should NOT render owner summary'
  );
});

test('DashboardPage: reviewer capability — renders the role-scoped KPI strip', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-reviewer',
    capabilities: defaultCapabilities({ isReviewer: true }),
  });
  await waitForRender(host);

  assert.equal(
    findAll(host, 'cora-kpi-strip').length,
    1,
    'should render the KPI strip'
  );
});

test('DashboardPage: visitor capability — no KPI strip is rendered', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-visitor',
    capabilities: defaultCapabilities({ isVisitor: true }),
  });
  assert.equal(findAll(host, 'cora-kpi-strip').length, 0);
});

test('DashboardPage: owner-only capability — owner summary visible, no outstanding Cases, no allocation', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-owner',
    capabilities: defaultCapabilities({ ownedCaseTypes: ['example-review'] }),
  });
  assert.equal(
    hasOutstandingCasesHeading(host),
    false,
    'should NOT render Outstanding Cases heading'
  );
  assert.equal(
    findAll(host, 'cora-allocation').length,
    0,
    'should NOT render allocation button'
  );
  assert.equal(
    findAll(host, 'cora-owner-summary').length,
    1,
    'should render owner summary'
  );
});

test('DashboardPage: admin capability — both reviewer and owner sections visible', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-admin',
    capabilities: defaultCapabilities({
      isReviewer: true,
      ownedCaseTypes: ['example-review'],
    }),
  });
  await waitForRender(host);

  assert.equal(
    hasOutstandingCasesHeading(host),
    true,
    'should render Outstanding Cases heading'
  );
  assert.equal(
    findAll(host, 'cora-allocation').length,
    1,
    'should render allocation button'
  );
  assert.equal(
    findAll(host, 'cora-owner-summary').length,
    1,
    'should render owner summary'
  );
  assertAllCoraElementsDefined(host);
});

test('DashboardPage: a worklist role renders the Action Centre worklist (issue #287)', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-reviewer',
    capabilities: defaultCapabilities({ isReviewer: true }),
  });
  await waitForRender(host);

  assert.ok(
    findSection(host, 'cora-action-centre'),
    'should render the Action Centre section'
  );
});

test('DashboardPage: an adviser-only user gets no Action Centre (no worklist reason)', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-rp',
    capabilities: defaultCapabilities({ isAdviser: true }),
  });
  assert.equal(
    findSection(host, 'cora-action-centre'),
    undefined,
    'advisers have no Action Centre worklist'
  );
});

test('DashboardPage: reviewer with no ownedCaseTypes never renders owner section (no error)', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-reviewer',
    capabilities: defaultCapabilities({ isReviewer: true }),
  });
  // Must not throw.
  await waitForRender(host);

  assert.equal(findAll(host, 'cora-owner-summary').length, 0);
});

test('DashboardPage: renders nothing and does not throw when client is null and no capabilities are set', async () => {
  const host = DashboardPage({
    client: null,
    currentUserId: '',
    capabilities: defaultCapabilities(),
  });
  assert.equal(/** @type {any} */ (host)._children.length, 0);
});

test('DashboardPage: RP-only capability — responsible party dashboard rendered, reviewer sections absent', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-rp',
    capabilities: defaultCapabilities({ isAdviser: true }),
  });
  assert.ok(
    findSection(host, 'cora-rp-outcome-summary'),
    'should render RP outcome summary section'
  );
  assert.ok(
    findSection(host, 'cora-rp-remediation'),
    'should render RP remediation section'
  );
  assert.ok(
    findSection(host, 'cora-rp-messages'),
    'should render RP messages section'
  );
  assert.equal(
    hasOutstandingCasesHeading(host),
    false,
    'should NOT render reviewer heading'
  );
  assert.equal(
    findAll(host, 'cora-allocation').length,
    0,
    'should NOT render allocation button'
  );
  assert.equal(
    findAll(host, 'cora-owner-summary').length,
    0,
    'should NOT render owner summary'
  );
});

test('DashboardPage: Controls capability — outstanding appeals section visible, reviewer/owner/RP sections absent', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-controls',
    capabilities: defaultCapabilities({ isControls: true }),
  });
  assert.ok(
    findSection(host, 'cora-controls-appeals'),
    'should render the outstanding appeals section'
  );
  assert.equal(
    hasOutstandingCasesHeading(host),
    false,
    'should NOT render reviewer heading'
  );
  assert.equal(
    findAll(host, 'cora-owner-summary').length,
    0,
    'should NOT render owner summary'
  );
  assert.equal(
    findSection(host, 'cora-rp-outcome-summary'),
    undefined,
    'should NOT render RP section'
  );
});

test('DashboardPage: non-Controls user never sees the outstanding appeals section', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-reviewer',
    capabilities: defaultCapabilities({ isReviewer: true }),
  });
  await waitForRender(host);

  assert.equal(
    findSection(host, 'cora-controls-appeals'),
    undefined,
    'should NOT render the outstanding appeals section'
  );
});

test('DashboardPage: Controls open button navigates to the case hash', async () => {
  /** @type {any} */ (globalThis).location.hash = '';
  const caseRow = {
    id: 'c-appeal',
    caseType: 'complaints',
    title: 'Appealed Case',
    status: 'Completed',
    assignedReviewer: 'rev',
    responsibleParty: 'adv',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: '2026-05-30T00:00:00Z',
    appeals: [
      {
        id: 'a1',
        appellant: 'jo.owner',
        at: '2026-06-01T09:00:00Z',
        rationale: 'Too harsh',
        state: 'raised',
      },
    ],
    etag: 'e1',
  };
  const client = {
    async listCases() {
      return [caseRow];
    },
  };
  const host = DashboardPage({
    client: /** @type {any} */ (client),
    currentUserId: 'user-controls',
    capabilities: defaultCapabilities({ isControls: true }),
  });
  await waitFor(
    () =>
      Boolean(
        findAll(
          findSection(host, 'cora-controls-appeals'),
          'cora-case-table'
        )[0]
      ),
    'Controls appeals table'
  );

  const section = findSection(host, 'cora-controls-appeals');
  assert.ok(section, 'appeals section should exist');
  const table = findAll(section, 'cora-case-table')[0];
  for (const listener of /** @type {any} */ (table)._listeners[
    'cora-case-open'
  ] ?? []) {
    listener({ detail: { caseRow } });
  }

  assert.equal(
    /** @type {any} */ (globalThis).location.hash,
    '#/case/complaints/c-appeal'
  );
});

test('DashboardPage: reviewer + RP capability — both reviewer and RP sections visible', async () => {
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-reviewer-rp',
    capabilities: defaultCapabilities({ isReviewer: true, isAdviser: true }),
  });
  await waitForRender(host);

  assert.equal(
    hasOutstandingCasesHeading(host),
    true,
    'should render reviewer heading'
  );
  assert.equal(
    findAll(host, 'cora-allocation').length,
    1,
    'should render allocation button'
  );
  assert.ok(
    findSection(host, 'cora-rp-outcome-summary'),
    'should render RP section'
  );
});

test('DashboardPage: RP dashboard fetches cases with responsibleParty filter using currentUserId', async () => {
  /** @type {any[]} */
  const calls = [];
  const client = {
    async listCases(/** @type {any} */ f) {
      calls.push(f);
      return [];
    },
  };
  const host = DashboardPage({
    client: /** @type {any} */ (client),
    currentUserId: 'user-rp',
    capabilities: defaultCapabilities({ isAdviser: true }),
    allCaseSources: [
      {
        slug: 'example-review',
        listName: 'Cases-ExampleReview',
        displayName: 'Example Review',
      },
    ],
  });
  assert.ok(
    calls.some(
      (f) => f.responsibleParty === 'user-rp' && !('assignedReviewer' in f)
    ),
    'RP dashboard should list cases filtered by responsibleParty'
  );
});

test('DashboardPage: open button in RP unread-messages section navigates to conversation hash via onOpenConversation', async () => {
  /** @type {any} */ (globalThis).location.hash = '';
  const caseRow = {
    id: 'c-42',
    caseType: 'example-review',
    title: 'Case 42',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {},
    conversation: [
      { author: 'user-reviewer', timestamp: '2026-05-07T09:00:00Z', body: 'Q' },
    ],
    notes: '',
    completedAt: null,
    etag: 'e1',
  };
  const client = {
    async listCases() {
      return [caseRow];
    },
  };
  const host = DashboardPage({
    client: /** @type {any} */ (client),
    currentUserId: 'user-rp',
    capabilities: defaultCapabilities({ isAdviser: true }),
  });
  await waitFor(
    () =>
      Boolean(
        findAll(findSection(host, 'cora-rp-messages'), 'cora-case-table')[0]
      ),
    'Responsible Party messages table'
  );

  const messagesSection = findSection(host, 'cora-rp-messages');
  assert.ok(messagesSection, 'messages section should exist');
  const messagesTable = findAll(messagesSection, 'cora-case-table')[0];
  assert.ok(messagesTable, 'messages case table should exist');
  for (const h of /** @type {any} */ (messagesTable)._listeners[
    'cora-case-open'
  ] ?? []) {
    h({ detail: { caseRow } });
  }

  assert.equal(
    /** @type {any} */ (globalThis).location.hash,
    '#/conversation/example-review/c-42'
  );
});

test('DashboardPage: cora-allocation element receives allocationSources from props', async () => {
  const allocationSources = [
    { slug: 'example-review', listName: 'Cases-ExampleReview' },
    { slug: 'product-sale-review', listName: 'Cases-ProductSaleReview' },
  ];
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-reviewer',
    capabilities: defaultCapabilities({ isReviewer: true }),
    allocationSources,
  });
  await waitForRender(host);

  const allocationEls = findAll(host, 'cora-allocation');
  assert.equal(allocationEls.length, 1);
  assert.deepEqual(
    /** @type {any} */ (allocationEls[0]).allocationSources,
    allocationSources
  );
});

test('DashboardPage: cora-allocation element listens for cora-allocated and re-fetches cases on allocation', async () => {
  let fetchCount = 0;
  const client = {
    async listCases() {
      fetchCount++;
      return [];
    },
  };

  const host = DashboardPage({
    client: /** @type {any} */ (client),
    currentUserId: 'user-reviewer',
    capabilities: defaultCapabilities({ isReviewer: true }),
    caseSources: [
      {
        slug: 'example-review',
        listName: 'Cases-ExampleReview',
        displayName: 'Example Review',
      },
    ],
  });
  await waitForRender(host);
  const initialFetchCount = fetchCount;

  const allocationEls = findAll(host, 'cora-allocation');
  assert.equal(allocationEls.length, 1, 'should have allocation element');

  const allocEvent = { type: 'cora-allocated', detail: { caseId: 'c-new' } };
  for (const h of /** @type {any} */ (allocationEls[0])._listeners[
    'cora-allocated'
  ] ?? []) {
    await h(allocEvent);
  }

  assert.ok(
    fetchCount > initialFetchCount,
    'should re-fetch cases after cora-allocated event'
  );
});

test('DashboardPage: cora-case-open event on case table navigates to #/case/{id}', async () => {
  /** @type {any} */ (globalThis).location.hash = '';
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-reviewer',
    capabilities: defaultCapabilities({ isReviewer: true }),
  });
  await waitForRender(host);

  const caseTable = findAll(host, 'cora-case-table')[0];
  assert.ok(caseTable, 'should have a case table');

  const event = {
    type: 'cora-case-open',
    detail: {
      caseId: 'case-42',
      caseRow: { id: 'case-42', caseType: 'example-review' },
    },
  };
  for (const h of /** @type {any} */ (caseTable)._listeners['cora-case-open'] ??
    []) {
    h(event);
  }

  assert.equal(
    /** @type {any} */ (globalThis).location.hash,
    '#/case/example-review/case-42'
  );
});

// --- overdue flag ---

test('DashboardPage: stamps overdue:true on rows whose dueDate is in the past', async () => {
  const PAST = '2020-01-01T00:00:00Z';
  const FUTURE = '2099-01-01T00:00:00Z';
  /** @type {import('../src/sharepoint-client.js').CaseRow[]} */
  const fetchedCases = [
    {
      id: 'od-past',
      caseType: 'example-review',
      title: 'Overdue',
      status: 'In-progress',
      assignedReviewer: 'u1',
      responsibleParty: '',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      dueDate: PAST,
      etag: 'e1',
    },
    {
      id: 'od-future',
      caseType: 'example-review',
      title: 'On Time',
      status: 'In-progress',
      assignedReviewer: 'u1',
      responsibleParty: '',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      dueDate: FUTURE,
      etag: 'e2',
    },
    {
      id: 'od-none',
      caseType: 'example-review',
      title: 'No Due Date',
      status: 'In-progress',
      assignedReviewer: 'u1',
      responsibleParty: '',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      etag: 'e3',
    },
  ];

  const client = {
    async listCases() {
      return fetchedCases;
    },
  };
  const host = DashboardPage({
    client: /** @type {any} */ (client),
    currentUserId: 'u1',
    capabilities: defaultCapabilities({ isReviewer: true }),
    caseSources: [
      {
        slug: 'example-review',
        listName: 'Cases-ExampleReview',
        displayName: 'Example Review',
      },
    ],
  });
  await waitForRender(host);

  const caseTable = /** @type {any} */ (findAll(host, 'cora-case-table')[0]);
  const rows = /** @type {import('../src/sharepoint-client.js').CaseRow[]} */ (
    caseTable.cases
  );
  assert.ok(Array.isArray(rows), 'case table should have cases set');

  const pastRow = rows.find((r) => r.id === 'od-past');
  const futureRow = rows.find((r) => r.id === 'od-future');
  const noneRow = rows.find((r) => r.id === 'od-none');

  assert.strictEqual(
    pastRow?.overdue,
    true,
    'past dueDate row should be flagged overdue'
  );
  assert.strictEqual(
    futureRow?.overdue,
    false,
    'future dueDate row should not be overdue'
  );
  assert.strictEqual(
    noneRow?.overdue,
    false,
    'no-dueDate row should not be overdue'
  );
});

test('DashboardPage: reviewer outstanding fetch fans out one listCases per source (with its listName) and merges', async () => {
  /** @type {Array<{ filter: any, opts: any }>} */
  const calls = [];
  const client = {
    async listCases(/** @type {any} */ filter, /** @type {any} */ opts = {}) {
      calls.push({ filter, opts });
      return [
        {
          id: `case-${opts.listName}`,
          caseType: 'x',
          title: 't',
          status: 'In-progress',
          assignedReviewer: 'u1',
          responsibleParty: '',
          answers: {},
          conversation: [],
          notes: '',
          completedAt: null,
          etag: 'e',
        },
      ];
    },
  };
  const host = DashboardPage({
    client: /** @type {any} */ (client),
    currentUserId: 'u1',
    capabilities: defaultCapabilities({ isReviewer: true }),
    caseSources: [
      { slug: 'a', listName: 'Cases-A', displayName: 'A' },
      { slug: 'b', listName: 'Cases-B', displayName: 'B' },
    ],
  });
  await waitForRender(host);

  assert.deepEqual(
    calls.map((c) => c.opts.listName).sort(),
    ['Cases-A', 'Cases-B'],
    'one listCases per source, each carrying its listName'
  );
  for (const { filter } of calls) {
    assert.equal(filter.assignedReviewer, 'u1');
    assert.equal(filter.status, 'In-progress');
  }

  const caseTable = /** @type {any} */ (findAll(host, 'cora-case-table')[0]);
  const rows = /** @type {any[]} */ (caseTable.cases);
  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    ['case-Cases-A', 'case-Cases-B'],
    'merges rows from every source list'
  );
});

test('DashboardPage: threads eligible caseSources and full allCaseSources to child sections', async () => {
  const caseSources = [{ slug: 'a', listName: 'Cases-A', displayName: 'A' }];
  const allCaseSources = [
    { slug: 'a', listName: 'Cases-A', displayName: 'A' },
    { slug: 'b', listName: 'Cases-B', displayName: 'B' },
  ];
  const host = DashboardPage({
    client: /** @type {any} */ (makeClient()),
    currentUserId: 'user-reviewer',
    capabilities: defaultCapabilities({
      isReviewer: true,
      isControls: true,
      ownedCaseTypes: ['a'],
    }),
    caseSources,
    allCaseSources,
  });
  await waitForRender(host);

  const kpi = /** @type {any} */ (findAll(host, 'cora-kpi-strip')[0]);
  assert.deepEqual(kpi.caseSources, caseSources);
  assert.deepEqual(kpi.allCaseSources, allCaseSources);
  const owner = /** @type {any} */ (findAll(host, 'cora-owner-summary')[0]);
  assert.deepEqual(owner.allCaseSources, allCaseSources);
});

test('DashboardPage: opening a case from the Action Centre routes to the case (issue #287)', async () => {
  const overdue = {
    id: 'od-1',
    caseType: 'complaints',
    title: 'Overdue One',
    status: 'In-progress',
    assignedReviewer: 'rev',
    responsibleParty: 'rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    dueDate: '2020-01-01T00:00:00Z',
    overdue: true,
    etag: 'e-od-1',
  };
  const worklistClient = {
    async listCases(/** @type {any} */ filter) {
      return filter && filter.overdue ? [overdue] : [];
    },
    async countCases(/** @type {any} */ filter) {
      return filter && filter.overdue ? 1 : 0;
    },
  };

  const originalHash = globalThis.location.hash;
  const host = DashboardPage({
    client: /** @type {any} */ (worklistClient),
    currentUserId: 'user-reviewer',
    capabilities: defaultCapabilities({ isReviewer: true }),
    allCaseSources: [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
      },
    ],
  });
  await waitFor(
    () => Boolean(host.querySelectorAll('.cora-ac-open')[0]),
    'Action Centre row'
  );

  /** @type {any} */
  let openBtn = null;
  /** @param {any} n */
  const findOpen = (n) => {
    if (n.className === 'cora-ac-open') openBtn = n;
    for (const c of n._children) findOpen(c);
  };
  findOpen(host);
  assert.ok(
    openBtn,
    'the Action Centre renders an Open button for the overdue row'
  );

  openBtn._fire('click');
  assert.notEqual(
    globalThis.location.hash,
    originalHash,
    'navigates to the case'
  );
  assert.ok(globalThis.location.hash.includes('od-1'));
});

test('DashboardPage: the Action Centre "All" toggle survives the dashboard render (issue #287)', async () => {
  // Reason-flagged rows: one overdue (default group) and one review-required
  // (tail group, revealed only by "All"), both assigned to the current user.
  const rows = [
    {
      id: 'od-1',
      caseType: 'complaints',
      title: 'Overdue',
      status: 'In-progress',
      assignedReviewer: 'me',
      responsibleParty: 'rp',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      dueDate: '2020-01-01T00:00:00Z',
      overdue: true,
      reviewRequired: false,
      etag: 'e1',
    },
    {
      id: 'rr-1',
      caseType: 'complaints',
      title: 'Review required',
      status: 'In-progress',
      assignedReviewer: 'me',
      responsibleParty: 'rp',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      reviewRequired: true,
      created: '2026-06-01T00:00:00Z',
      etag: 'e2',
    },
  ];
  /** @param {any} filter */
  const matches = (filter) => (/** @type {any} */ c) => {
    if (
      filter.assignedReviewer &&
      c.assignedReviewer !== filter.assignedReviewer
    )
      return false;
    if (
      filter.reviewRequired !== undefined &&
      !!c.reviewRequired !== filter.reviewRequired
    )
      return false;
    if (filter.overdue === true && !c.overdue) return false;
    return true;
  };
  const client = {
    async listCases(/** @type {any} */ filter, /** @type {any} */ opts = {}) {
      let out = rows.filter(matches(filter));
      if (filter.anyOf)
        out = rows.filter((c) =>
          filter.anyOf.some((/** @type {any} */ f) => matches(f)(c))
        );
      return opts.top !== undefined
        ? out.slice(opts.skip ?? 0, (opts.skip ?? 0) + opts.top)
        : out;
    },
    async countCases(/** @type {any} */ filter) {
      if (filter.anyOf)
        return rows.filter((c) =>
          filter.anyOf.some((/** @type {any} */ f) => matches(f)(c))
        ).length;
      return rows.filter(matches(filter)).length;
    },
  };

  const host = DashboardPage({
    client: /** @type {any} */ (client),
    currentUserId: 'me',
    capabilities: defaultCapabilities({ isReviewer: true }),
    allCaseSources: [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
      },
    ],
  });
  await waitFor(
    () => Boolean(host.querySelectorAll('.cora-ac-rows')[0]),
    'Action Centre rows'
  );

  const reasonIds = () =>
    findAll(host, 'section')
      .filter((s) => s.className === 'cora-ac-group')
      .map((s) => s.getAttribute('data-reason'));

  assert.ok(
    !reasonIds().includes('reviewRequired'),
    'Review Required hidden under the default Needs-action-now toggle'
  );

  const toggleBtns = /** @type {any} */ (
    host.querySelectorAll('.cora-ac-toggle-btn')
  );
  const allBtn = toggleBtns.find(
    (/** @type {any} */ b) => b.textContent === 'All'
  );
  allBtn._fire('click');
  await waitFor(
    () => reasonIds().includes('reviewRequired'),
    'Review Required group'
  );

  assert.ok(
    reasonIds().includes('reviewRequired'),
    'clicking All reveals Review Required without the dashboard discarding the toggle'
  );
});
