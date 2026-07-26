// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { outstandingRemediation, responsiblePartyView } =
  await import('../src/pages/responsible-party/view.js');

/** @param {string} id @param {string} caseType @param {string} dueDate */
function row(id, caseType, dueDate) {
  return /** @type {import('../src/sharepoint-client.js').CaseRow} */ ({
    id,
    caseType,
    title: id,
    status: 'Actions In Progress',
    assignedReviewer: 'reviewer',
    responsibleParty: 'rp-1',
    dueDate,
    answers: {
      q1: {
        value: 'No',
        remediationActions: [{ id: `action-${id}`, text: `Fix ${id}` }],
      },
    },
    conversation: [],
    notes: '',
    completedAt: null,
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
      remediationSort: { key: 'dueDate', dir: 'asc' },
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

  // Existing DOM-stub debt retained until the shared debt ledger can move.
  const table = /** @type {any} */ (section?.querySelector('table'));
  assert.ok(table._children);
  assert.ok(table._children.length > 0);
  assert.ok(table._children[0]);
  assert.ok(table._listeners.keydown);
  assert.equal(table._listeners.keydown.length, 1);
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
      author: 'reviewer',
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

test('the Responsible Party works to the remediation clock, not the review SLA (#498)', () => {
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

test('a Case inside its remediation SLA is not overdue on the review clock (#498)', () => {
  const section = rpView({
    dueDate: '2020-01-01T00:00:00Z',
    remediationDueDate: '2099-01-01T00:00:00Z',
  });
  assert.equal(
    section?.querySelector('tbody')?.querySelector('tr')?.className,
    'cora-remediation-row'
  );
});

test('resolved remediation stops being outstanding on the Responsible Party surface (#497)', () => {
  const sent = /** @type {any} */ (row('c1', 'complaints', ''));
  sent.status = 'Actions In Progress';
  sent.remediationDueDate = '2026-08-01T00:00:00Z';
  // The Reviewer recorded the resolution on the Remediation tab — the one store
  // ADR-0037 made the record. Nothing ever writes `completed: true`.
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

test('free-form remediation is outstanding work too, and only once sent (#497)', () => {
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
