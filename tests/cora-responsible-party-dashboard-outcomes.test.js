// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveResponsibleParty } from '../src/pages/responsible-party/view.js';
import { responsiblePartyView } from '../src/pages/responsible-party/view.js';
import { installDom } from './_dom-stub.js';

installDom();

/** @param {string} id @param {Partial<import('../src/sharepoint-client.js').CaseRow>} overrides */
function row(id, overrides = {}) {
  return /** @type {import('../src/sharepoint-client.js').CaseRow} */ ({
    id,
    caseType: 'complaints',
    title: id,
    status: 'In-progress',
    assignedReviewer: 'reviewer',
    responsibleParty: 'rp-1',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'e',
    ...overrides,
  });
}

test('Responsible Party derivation summarises only the last twelve months of completed outcomes', () => {
  const result = deriveResponsibleParty(
    [
      row('recent-pass', {
        status: 'Completed',
        completedAt: '2026-06-01T00:00:00Z',
        outcome: 'Pass',
      }),
      row('recent-fail', {
        status: 'Completed',
        completedAt: '2026-05-01T00:00:00Z',
        outcome: 'Fail',
      }),
      row('recent-unknown', {
        status: 'Completed',
        completedAt: '2026-05-15T00:00:00Z',
      }),
      row('old', {
        status: 'Completed',
        completedAt: '2024-01-01T00:00:00Z',
        outcome: 'Pass',
      }),
    ],
    'rp-1',
    new Date('2026-07-01T00:00:00Z')
  );

  assert.equal(result.outcomeSummary.totalCompleted, 3);
  assert.deepEqual(result.outcomeSummary.byOutcome, {
    Pass: 1,
    Fail: 1,
    Unknown: 1,
  });
  assert.deepEqual(
    result.outcomeSummary.byMonth.map((entry) => entry.month),
    ['2026-05', '2026-06']
  );
});

test('Responsible Party pure view renders outcome totals and the month matrix', () => {
  const completed = row('recent-pass', {
    status: 'Completed',
    completedAt: '2026-06-01T00:00:00Z',
    outcome: 'Pass',
  });
  const failed = row('recent-fail', {
    status: 'Completed',
    completedAt: '2026-05-01T00:00:00Z',
    outcome: 'Fail',
  });
  const view = responsiblePartyView(
    {
      cases: [completed, failed],
      currentUserId: 'rp-1',
      filter: '',
      remediationSort: { key: 'remediationDueDate', dir: 'asc' },
      messageSort: { key: 'lastMessage', dir: 'desc' },
    },
    {
      onFilterChange: () => {},
      onRemediationSort: () => {},
      onMessageSort: () => {},
    },
    new Date('2026-07-01T00:00:00Z')
  );

  assert.equal(view.querySelector('.cora-rp-outcome-total')?.textContent, '2');
  assert.equal(view.querySelector('.cora-rp-outcome-pass')?.textContent, '1');
  assert.equal(view.querySelector('.cora-rp-outcome-fail')?.textContent, '1');
  assert.match(
    view.querySelector('.cora-rp-outcome-table')?.textContent ?? '',
    /2026-05012026-0610/
  );
});
