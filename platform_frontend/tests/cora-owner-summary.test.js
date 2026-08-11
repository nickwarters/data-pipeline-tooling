// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { loadOwnerSummaries, OwnerSummary } =
  await import('../src/components/sections/cora-owner-summary.js');

test('loadOwnerSummaries derives bounded per-source ownership metrics', async () => {
  /** @type {any[]} */
  const listCalls = [];
  /** @type {any[]} */
  const countCalls = [];
  const summaries = await loadOwnerSummaries({
    client: /** @type {any} */ ({
      async listCases(/** @type {any} */ filter, /** @type {any} */ options) {
        listCalls.push([filter, options]);
        // The rows carry the status the query asked for: the overdue count is
        // now a status-aware derivation, not a bare date compare.
        return [
          {
            assignedReviewer: '',
            status: 'In-progress',
            dueDate: '2026-07-18T00:00:00.000Z',
          },
          {
            assignedReviewer: 'u1',
            status: 'In-progress',
            dueDate: '2026-07-22T00:00:00.000Z',
          },
        ];
      },
      async countCases(/** @type {any} */ filter, /** @type {any} */ options) {
        countCalls.push([filter, options]);
        return countCalls.length;
      },
    }),
    ownedCaseTypes: ['complaints', 'stale'],
    allCaseSources: [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
      },
    ],
    now: new Date('2026-07-20T12:00:00.000Z'),
  });
  assert.deepEqual(summaries, [
    {
      caseType: 'complaints',
      outstanding: 1,
      assigned: 1,
      overdue: 1,
      completedToday: 1,
      completedLast7Days: 36,
    },
  ]);
  assert.deepEqual(listCalls, [
    [{ status: 'In-progress' }, { listName: 'Cases-Complaints' }],
  ]);
  assert.equal(countCalls.length, 8);
  assert.ok(countCalls.every(([filter]) => !('caseType' in filter)));
  assert.ok(
    countCalls.every(([, options]) => options.listName === 'Cases-Complaints')
  );
});

test('OwnerSummary renders one semantic card with all route-owned metrics', () => {
  const root = document.createElement('section');
  root.append(
    ...OwnerSummary({
      summaries: [
        {
          caseType: 'complaints',
          outstanding: 1,
          assigned: 2,
          overdue: 3,
          completedToday: 4,
          completedLast7Days: 5,
        },
      ],
    })
  );
  assert.equal(
    root.querySelector('.cora-owner-summary-heading')?.textContent,
    'Case Type Ownership Summary'
  );
  assert.match(
    root.textContent,
    /complaintsOutstanding1Assigned2Overdue3Completed today4Completed \(last 7 days\)5/
  );
});

test('loadOwnerSummaries accepts the current time default for an empty ownership set', async () => {
  assert.deepEqual(
    await loadOwnerSummaries({
      client: /** @type {any} */ ({}),
      ownedCaseTypes: [],
    }),
    []
  );
});
