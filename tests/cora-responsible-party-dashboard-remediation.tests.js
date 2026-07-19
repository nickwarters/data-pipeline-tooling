// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { openRemediationActions, responsiblePartyView } =
  await import('../src/pages/responsible-party/view.js');

/** @param {string} id @param {string} caseType @param {string} dueDate */
function row(id, caseType, dueDate) {
  return /** @type {import('../src/sharepoint-client.js').CaseRow} */ ({
    id,
    caseType,
    title: id,
    status: 'In-progress',
    assignedReviewer: 'reviewer',
    responsibleParty: 'rp-1',
    dueDate,
    answers: {
      q1: {
        value: 'No',
        remediationActions: [
          { id: `action-${id}`, text: `Fix ${id}`, completed: false },
        ],
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

test('Responsible Party remediation ignores completed actions and absent action lists', () => {
  const withCompleted = row('done', 'complaints', '2099-01-01T00:00:00Z');
  /** @type {any} */ (
    withCompleted.answers.q1
  ).remediationActions[0].completed = true;
  const withoutActions = {
    ...row('none', 'complaints', '2099-01-01T00:00:00Z'),
    answers: { q1: { value: 'Yes' } },
  };
  assert.deepEqual(openRemediationActions(withCompleted), []);
  assert.deepEqual(
    openRemediationActions(/** @type {any} */ (withoutActions)),
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
