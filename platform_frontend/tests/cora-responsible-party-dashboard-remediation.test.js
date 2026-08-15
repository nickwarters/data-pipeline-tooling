// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { tableHeaders } from './helpers/semantic-dom.js';
import { makeCaseRow } from './helpers/fixtures.js';

installDom();

const { outstandingRemediation, responsiblePartyView } =
  await import('../src/pages/responsible-party/view.js');

// The review SLA every row in this file carries, fixed and far in the future so
// it can never produce the overdue badge. This table is about the remediation
// clock, and a test here that passed because of the review one would be reading
// the wrong column without saying so.
const REVIEW_DUE_DATE = '2099-06-01T00:00:00Z';

/**
 * A sent-remediation Case, dated by the clock this table shows: its
 * **Remediation Due Date**.
 *
 * @param {string} id @param {string} caseType @param {string} remediationDueDate
 */
function row(id, caseType, remediationDueDate) {
  return makeCaseRow({
    id,
    caseType,
    title: id,
    status: 'Actions In Progress',
    assignedReviewer: 'reviewer',
    responsibleParty: 'rp-1',
    dueDate: REVIEW_DUE_DATE,
    remediationDueDate: remediationDueDate || null,
    answers: {
      q1: {
        value: 'No',
        remediationActions: [{ id: `action-${id}`, text: `Fix ${id}` }],
      },
    },
    etag: 'e',
  });
}

test('Responsible Party remediation uses the generic table, filtering, and overdue styling', () => {
  const cases = [
    row('c1', 'complaints', '2020-01-01T00:00:00Z'),
    row('c2', 'conduct', '2099-01-01T00:00:00Z'),
  ];
  /** @type {any[]} */
  const actions = [];
  const view = responsiblePartyView(
    {
      cases,
      currentUserId: 'rp-1',
      filter: 'complaints',
      remediationSort: { key: 'remediationDueDate', dir: 'asc' },
      messageSort: { key: 'lastMessage', dir: 'desc' },
    },
    {
      onFilterChange: (value) => actions.push(['filter', value]),
      onRemediationSort: (key) => actions.push(['remediation-sort', key]),
      onMessageSort: (key) => actions.push(['message-sort', key]),
    },
    new Date('2026-07-01T00:00:00Z')
  );

  const section = view.querySelector('.cora-rp-remediation');
  assert.equal(section?.querySelector('table')?.getAttribute('role'), 'grid');
  assert.match(section?.textContent ?? '', /Fix c1/);
  assert.doesNotMatch(section?.textContent ?? '', /Fix c2/);
  assert.equal(
    section?.querySelector('tbody')?.querySelector('tr')?.className,
    'cora-remediation-row cora-overdue'
  );

  const select = /** @type {any} */ (section?.querySelector('select'));
  select.value = 'conduct';
  select.dispatchEvent({ type: 'change', target: select });
  assert.deepEqual(actions[0], ['filter', 'conduct']);
});

test('the Outstanding Remediation Actions table renders the columns it renders today', () => {
  const view = responsiblePartyView(
    {
      cases: [row('c1', 'complaints', '2099-01-01T00:00:00Z')],
      currentUserId: 'rp-1',
      filter: '',
      remediationSort: { key: 'remediationDueDate', dir: 'asc' },
      messageSort: null,
    },
    {
      onFilterChange: () => {},
      onRemediationSort: () => {},
      onMessageSort: () => {},
    },
    new Date('2026-07-01T00:00:00Z')
  );
  const section = view.querySelector('.cora-rp-remediation');

  // The sorting half of this contract has converged: Reference and Case Type
  // are interactive here as on all six Case tables, because the same
  // Case-shaped column should not be inert on one of them. What remains pinned
  // is the divergence that convergence deliberately did *not* touch:
  //
  //   - Remediation due is this table's own column, left exactly as it was. Its
  //     'ascending' is the active sort; the other headings read 'none' because
  //     they are not the sort key, not because they are unsortable —
  //     data-table.js derives `aria-sort` and interactivity independently.
  //   - Action required stays plain text, as it has no sortable meaning.
  assert.deepEqual(tableHeaders(section), [
    ['Reference', 'none', true],
    ['Case Type', 'none', true],
    ['Remediation due', 'ascending', true],
    ['Action required', 'none', false],
  ]);

  // No column renders a link: the Reference column carries no `href`, unlike
  // the Cases with Unread Messages table below it, whose Reference cells link
  // to the Case. Still pinned, not fixed: the convergence decided sorting, not
  // linking, so
  // this table keeps its own Reference descriptor rather than adopting
  // caseReferenceColumn() and gaining a link as a side effect.
  //
  // Scope worth knowing: this pins the absence of a *column* href only. The
  // table also passes no `rowHref`, where the messages table does (view.js),
  // so its rows are not Enter-navigable either — but `rowHref` renders no
  // anchor at all (data-table.js turns it into a keydown handler), so nothing
  // here can see it. Asserting it needs an Enter-key round trip that writes
  // location.hash, not a DOM query; left unpinned rather than faked.
  assert.equal(section?.querySelector('a'), null);
});

test('Responsible Party remediation ignores Answers carrying no remediation', () => {
  const withoutActions = {
    .../** @type {any} */ (row('none', 'complaints', '2099-01-01T00:00:00Z')),
    status: 'Actions In Progress',
    answers: { q1: { value: 'Yes' } },
  };
  assert.deepEqual(
    outstandingRemediation(/** @type {any} */ (withoutActions)),
    []
  );
  assert.deepEqual(
    outstandingRemediation(
      /** @type {any} */ ({ ...withoutActions, answers: undefined })
    ),
    []
  );
});

test('Responsible Party tables preserve missing dates and optional conversation navigation', () => {
  const missingDate = row('no-date', 'complaints', '');
  missingDate.title = '';
  missingDate.conversation = [
    {
      author: { loginName: 'reviewer', displayName: 'Robin Reviewer' },
      timestamp: '2026-06-01T00:00:00Z',
      body: 'Please respond',
    },
  ];
  const view = responsiblePartyView(
    {
      cases: [missingDate],
      currentUserId: 'rp-1',
      filter: '',
      remediationSort: null,
      messageSort: null,
    },
    {
      onFilterChange: () => {},
      onRemediationSort: () => {},
      onMessageSort: () => {},
    },
    new Date('2026-07-01T00:00:00Z')
  );

  const remediationRow = view
    .querySelector('.cora-rp-remediation')
    ?.querySelector('tbody')
    ?.querySelector('tr');
  assert.equal(remediationRow?.className, 'cora-remediation-row');
  assert.match(remediationRow?.textContent ?? '', /—/);
  assert.doesNotThrow(() =>
    [
      ...(view.querySelector('.cora-rp-messages')?.querySelectorAll('button') ??
        []),
    ]
      .at(-1)
      ?.dispatchEvent(/** @type {any} */ ({ type: 'click' }))
  );
});

/** @param {Partial<import('../src/sharepoint-client.js').CaseRow>} patch */
function rpView(patch) {
  const base = row('c1', 'complaints', '2099-01-01T00:00:00Z');
  return responsiblePartyView(
    {
      cases: [/** @type {any} */ ({ ...base, ...patch })],
      currentUserId: 'rp-1',
      filter: '',
      remediationSort: null,
      messageSort: null,
    },
    {
      onFilterChange: () => {},
      onRemediationSort: () => {},
      onMessageSort: () => {},
    },
    new Date('2026-07-01T00:00:00Z')
  ).querySelector('.cora-rp-remediation');
}

test('the Responsible Party works to the remediation clock, not the review SLA', () => {
  const section = rpView({
    dueDate: '2099-01-01T00:00:00Z',
    remediationDueDate: '2026-06-01T00:00:00Z',
  });
  // The column is the remediation SLA, worded as the Remediation tab words it.
  assert.match(section?.textContent ?? '', /Remediation due/);
  assert.doesNotMatch(section?.textContent ?? '', /Due Date/);
  assert.match(
    section?.querySelector('tbody')?.querySelector('tr')?.textContent ?? '',
    /2026/
  );
  // Overdue is judged against that same clock, so a Case inside its review SLA
  // but past its remediation deadline is badged.
  assert.equal(
    section?.querySelector('tbody')?.querySelector('tr')?.className,
    'cora-remediation-row cora-overdue'
  );
});

test('a Case inside its remediation SLA is not overdue on the review clock', () => {
  const section = rpView({
    dueDate: '2020-01-01T00:00:00Z',
    remediationDueDate: '2099-01-01T00:00:00Z',
  });
  assert.equal(
    section?.querySelector('tbody')?.querySelector('tr')?.className,
    'cora-remediation-row'
  );
});

test('resolved remediation stops being outstanding on the Responsible Party surface', () => {
  const sent = /** @type {any} */ (row('c1', 'complaints', ''));
  sent.status = 'Actions In Progress';
  sent.remediationDueDate = '2026-08-01T00:00:00Z';
  // The Reviewer recorded the resolution on the Remediation tab — the one store
  // that is the record. Nothing ever writes `completed: true`.
  sent.answers.q1.remediationStatus = { status: 'complete' };
  assert.deepEqual(outstandingRemediation(sent), []);

  // A `partial` resolution missing its required details is *not* resolved, so
  // the work is still outstanding.
  sent.answers.q1.remediationStatus = { status: 'partial', details: '' };
  assert.deepEqual(outstandingRemediation(sent), ['Fix c1']);

  sent.answers.q1.remediationStatus = {
    status: 'partial',
    details: 'Half done',
  };
  assert.deepEqual(outstandingRemediation(sent), []);
});

test('free-form remediation is outstanding work too, and only once sent', () => {
  const sent = /** @type {any} */ (row('c2', 'complaints', ''));
  sent.status = 'Actions In Progress';
  sent.answers = { q1: { value: 'No', freeFormRemediation: 'Call back' } };
  assert.deepEqual(outstandingRemediation(sent), ['Call back']);

  // Before Send Actions the Reviewer is still capturing: nothing has been asked
  // of the Responsible Party yet, so nothing is outstanding for them.
  assert.deepEqual(
    outstandingRemediation({ ...sent, status: 'In-progress' }),
    []
  );
});

test('a Completed Case has no outstanding remediation, by construction', () => {
  // This dashboard lists Cases across every Case Type and holds no catalogue for
  // any of them, so it reads the Answers blob — a strict superset of the
  // Remediation tab's rows. Scoped to `Actions In Progress`, the one status in
  // which the Case is frozen *and* the tab is live, that superset can no longer
  // strand work: a Case only reaches it with ≥1 real row (the catalogue-aware
  // Send Actions fork), and it cannot leave it until every row is resolved (the
  // completion gate).
  //
  // Before this, an Answer whose Question had been deprecated carried its
  // remediation into the "Outstanding remediation" table of a Completed Case
  // *forever*: `remediationStatus` was never written and could never be written,
  // because its only writer is a row the tab does not render.
  const orphaned = /** @type {any} */ (row('c3', 'complaints', ''));
  orphaned.status = 'Completed';
  orphaned.completedAt = '2026-07-30T00:00:00Z';
  orphaned.answers = {
    'q-old': { value: 'No', freeFormRemediation: 'Refund the customer £40' },
  };
  assert.deepEqual(outstandingRemediation(orphaned), []);

  // …and so does a Case that closed with every row properly resolved.
  const closed = /** @type {any} */ (row('c4', 'complaints', ''));
  closed.status = 'Completed';
  closed.answers.q1.remediationStatus = { status: 'complete' };
  assert.deepEqual(outstandingRemediation(closed), []);
});

test('a Case with no remediation stamp shows no remediation deadline and is not overdue', () => {
  // A legacy Case that reached this table without a Remediation Due Date has no
  // remediation clock. The review SLA is the Assigned Reviewer's, so it must not
  // stand in — not as a date, and not as an overdue badge.
  const section = rpView({
    dueDate: '2021-03-04T00:00:00Z',
    remediationDueDate: null,
  });
  const tableRow = section?.querySelector('tbody')?.querySelector('tr');
  assert.match(tableRow?.textContent ?? '', /—/);
  assert.doesNotMatch(tableRow?.textContent ?? '', /2021/);
  assert.equal(tableRow?.className, 'cora-remediation-row');
});
