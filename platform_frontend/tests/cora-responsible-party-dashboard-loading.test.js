// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { fireEvent, getByRole } from './helpers/semantic-dom.js';
import { makeCaseRow } from './helpers/fixtures.js';

installDom();

const {
  createRouteSlice,
  initialResponsiblePartyState,
  reduceResponsibleParty,
  responsiblePartyPanelView,
} = await import('../src/pages/cora-responsible-party-dashboard.js');

function context() {
  return /** @type {any} */ ({
    client: {},
    chrome: {
      currentUser: { id: 'rp-1', displayName: 'RP' },
      permissions: {},
    },
    caseSources: [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
      },
    ],
  });
}

test('Responsible Party slice fetches across authorized sources with the current user filter', async () => {
  const ctx = context();
  /** @type {any[]} */
  const calls = [];
  /** @type {any[]} */
  const actions = [];
  /** @type {() => void} */
  let markLoaded = () => {};
  /** @type {Promise<void>} */
  const loaded = new Promise((resolve) => {
    markLoaded = resolve;
  });
  const slice = createRouteSlice({}, ctx, {
    listAcrossSources: async (...args) => {
      calls.push(args);
      return [];
    },
  });
  slice.start({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => {
      actions.push(action);
      markLoaded();
    },
    isActive: () => true,
  });
  await loaded;

  assert.equal(calls[0][2].responsibleParty, 'rp-1');
  assert.equal(calls[0][1], ctx.caseSources);
  assert.deepEqual(actions, [{ type: 'responsible-party/loaded', cases: [] }]);
});

test('Responsible Party slice cleanup suppresses a late fetch result', async () => {
  const ctx = context();
  /** @type {(rows: any[]) => void} */
  let resolveRows = () => {};
  const slice = createRouteSlice({}, ctx, {
    listAcrossSources: () =>
      new Promise((resolve) => {
        resolveRows = resolve;
      }),
  });
  /** @type {any[]} */
  const actions = [];
  let active = true;
  slice.start({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => actions.push(action),
    isActive: () => active,
  });
  active = false;
  resolveRows([]);
  await Promise.resolve();
  assert.deepEqual(actions, []);
});

test('Responsible Party reducer owns loaded rows, filters, and both table sorts', () => {
  const slice = createRouteSlice({}, context());
  let state = slice.reducer(slice.initialState, {
    type: 'responsible-party/loaded',
    cases: [{ id: 'c1' }],
  });
  state = slice.reducer(state, {
    type: 'responsible-party/filter-changed',
    value: 'complaints',
  });
  state = slice.reducer(state, {
    type: 'remediation-table/sort-requested',
    key: 'remediationDueDate',
  });
  state = slice.reducer(state, {
    type: 'unread-table/sort-requested',
    key: 'lastMessage',
  });

  assert.equal(state.routes.responsibleParty.cases.length, 1);
  assert.equal(state.routes.responsibleParty.filter, 'complaints');
  assert.equal(state.routes.responsibleParty.remediationSort?.dir, 'desc');
  assert.equal(state.routes.responsibleParty.messageSort?.dir, 'asc');
  assert.equal(slice.reducer(state, { type: 'ignored' }), state);
});

/** The panel needs one Case that is both remediation-outstanding and unread. */
function panelState() {
  return {
    ...initialResponsiblePartyState('rp-1'),
    cases: [
      makeCaseRow({
        id: 'c1',
        title: 'c1',
        status: 'Actions In Progress',
        assignedReviewer: 'reviewer',
        responsibleParty: 'rp-1',
        remediationDueDate: '2026-01-01T00:00:00Z',
        answers: {
          q1: {
            value: 'No',
            remediationActions: [{ id: 'a1', text: 'Fix c1' }],
          },
        },
        conversation: [
          { author: 'reviewer', timestamp: '2026-02-01T00:00:00Z', body: 'hi' },
        ],
        etag: 'e',
      }),
    ],
  };
}

test('Responsible Party panel: clicking the Remediation due header dispatches its table sort action', () => {
  /** @type {any[]} */
  const actions = [];
  const view = responsiblePartyPanelView(panelState(), {
    dispatch: (/** @type {any} */ action) => actions.push(action),
  });

  fireEvent(getByRole(view, 'button', { name: 'Remediation due' }), 'click');
  assert.deepEqual(actions, [
    { type: 'remediation-table/sort-requested', key: 'remediationDueDate' },
  ]);
});

test('Responsible Party panel: clicking the unread Last message header dispatches its table sort action', () => {
  /** @type {any[]} */
  const actions = [];
  const view = responsiblePartyPanelView(panelState(), {
    dispatch: (/** @type {any} */ action) => actions.push(action),
  });

  fireEvent(getByRole(view, 'button', { name: 'Last message' }), 'click');
  assert.deepEqual(actions, [
    { type: 'unread-table/sort-requested', key: 'lastMessage' },
  ]);
});

/**
 * Two Cases, both remediation-outstanding and both unread, whose Reference and
 * Case Type disagree with the order they are listed in — so a sorted render is
 * distinguishable from an unsorted one.
 *
 * @param {string} id @param {string} caseType
 */
function unsortedCase(id, caseType) {
  return makeCaseRow({
    id,
    caseType,
    title: id,
    status: 'Actions In Progress',
    assignedReviewer: 'reviewer',
    responsibleParty: 'rp-1',
    remediationDueDate: '2026-01-01T00:00:00Z',
    answers: {
      q1: { value: 'No', remediationActions: [{ id: `a-${id}`, text: 'Fix' }] },
    },
    conversation: [
      { author: 'reviewer', timestamp: '2026-02-01T00:00:00Z', body: 'hi' },
    ],
    etag: 'e',
  });
}

/** @param {string} sectionClass @param {any} view */
function referencesIn(sectionClass, view) {
  return [
    ...(view
      .querySelector(sectionClass)
      ?.querySelector('tbody')
      ?.querySelectorAll('tr') ?? []),
  ].map((/** @type {any} */ row) => row.querySelectorAll('td')[0].textContent);
}

test('Responsible Party tables: Reference and Case Type sort for real on both tables', () => {
  const base = {
    ...initialResponsiblePartyState('rp-1'),
    cases: [
      unsortedCase('Zed case', 'sales'),
      unsortedCase('Alpha case', 'banking'),
    ],
  };
  // Neither table's deliberate default sort moves by gaining two sortable
  // columns.
  assert.deepEqual(base.remediationSort, {
    key: 'remediationDueDate',
    dir: 'asc',
  });
  assert.deepEqual(base.messageSort, { key: 'lastMessage', dir: 'desc' });

  for (const [table, sectionClass, sortKey] of [
    ['remediation', '.cora-rp-remediation', 'remediationSort'],
    ['unread', '.cora-rp-messages', 'messageSort'],
  ]) {
    for (const [column, key] of [
      ['Reference', 'reference'],
      ['Case Type', 'caseType'],
    ]) {
      /** @type {any[]} */
      const actions = [];
      const view = responsiblePartyPanelView(base, {
        dispatch: (/** @type {any} */ action) => actions.push(action),
      });
      // Scoped to the section, because both tables carry both headings.
      const section = view.querySelector(/** @type {string} */ (sectionClass));
      fireEvent(getByRole(section, 'button', { name: column }), 'click');
      assert.deepEqual(actions, [
        { type: `${table}-table/sort-requested`, key },
      ]);

      const sorted = reduceResponsibleParty(base, actions[0]);
      assert.deepEqual(/** @type {any} */ (sorted)[sortKey], {
        key,
        dir: 'asc',
      });
      assert.deepEqual(
        referencesIn(
          /** @type {string} */ (sectionClass),
          responsiblePartyPanelView(sorted, { dispatch: () => {} })
        ),
        ['Alpha case', 'Zed case']
      );
    }
  }
});

test('Responsible Party panel: choosing a Case Type filter dispatches the filter action', () => {
  const base = panelState();
  /** @type {any[]} */
  const actions = [];
  const view = responsiblePartyPanelView(base, {
    dispatch: (/** @type {any} */ action) => actions.push(action),
  });

  const filter = getByRole(view, 'combobox', { name: 'Filter by Case Type' });
  filter.value = 'complaints';
  fireEvent(filter, 'change', { target: filter });
  assert.deepEqual(actions, [
    { type: 'responsible-party/filter-changed', value: 'complaints' },
  ]);

  // …and the filter the reducer stores is the one the panel applies: a Case
  // Type nobody matches empties both tables.
  const filtered = reduceResponsibleParty(base, {
    type: 'responsible-party/filter-changed',
    value: 'banking',
  });
  assert.equal(
    responsiblePartyPanelView(filtered, { dispatch: () => {} })
      .querySelector('.cora-rp-remediation')
      ?.querySelector('tbody')
      ?.querySelectorAll('tr').length ?? 0,
    0
  );
});
