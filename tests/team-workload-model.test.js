// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCaseRow } from './helpers/fixtures.js';

const { buildTeamWorkload } =
  await import('../src/evaluators/team-workload-model.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/**
 * @param {string} id
 * @param {Partial<CaseRow>} overrides
 * @returns {CaseRow}
 */
function caseRow(id, overrides) {
  return makeCaseRow({
    id,
    title: id,
    assignedReviewer: 'reviewer-a',
    responsibleParty: 'rp',
    etag: 'e',
    ...overrides,
  });
}

const sources = [
  {
    slug: 'complaints',
    listName: 'Cases-Complaints',
    displayName: 'Complaints',
  },
  {
    slug: 'conduct',
    listName: 'Cases-Conduct',
    displayName: 'Conduct',
  },
];

test('buildTeamWorkload: counts outstanding allocated cases per reviewer and Case Type', () => {
  const model = buildTeamWorkload(
    [
      caseRow('a1', {
        assignedReviewer: 'reviewer-a',
        onHold: true,
        placedOnHoldAt: '2026-07-20T00:00:00.000Z',
      }),
      caseRow('a2', {
        assignedReviewer: 'reviewer-a',
        caseType: 'conduct',
        status: 'Actions In Progress',
        onHold: true,
        placedOnHoldAt: '2026-07-22T00:00:00.000Z',
      }),
      caseRow('b1', {
        assignedReviewer: 'reviewer-b',
        caseType: 'conduct',
        onHold: true,
        placedOnHoldAt: '2026-07-22T00:00:00.000Z',
      }),
      caseRow('completed', { status: 'Completed' }),
      caseRow('unallocated', { assignedReviewer: '' }),
      caseRow('unknown-type', { caseType: 'unknown' }),
    ],
    sources,
    new Date('2026-07-24T00:00:00.000Z')
  );

  assert.deepEqual(model, [
    {
      reviewerId: 'reviewer-a',
      reviewer: 'reviewer-a',
      countsByCaseType: { complaints: 1, conduct: 1 },
      totalOutstanding: 2,
      onHold: 2,
      longestHoldDays: 4,
      isTotal: false,
    },
    {
      reviewerId: 'reviewer-b',
      reviewer: 'reviewer-b',
      countsByCaseType: { complaints: 0, conduct: 1 },
      totalOutstanding: 1,
      onHold: 1,
      longestHoldDays: 2,
      isTotal: false,
    },
    {
      reviewerId: null,
      reviewer: 'Total',
      countsByCaseType: { complaints: 1, conduct: 2 },
      totalOutstanding: 3,
      onHold: 3,
      longestHoldDays: 4,
      isTotal: true,
    },
  ]);
});

test('buildTeamWorkload: held cases without usable timestamps still count and degrade safely', () => {
  const model = buildTeamWorkload(
    [
      caseRow('missing', { onHold: true, placedOnHoldAt: null }),
      caseRow('invalid', {
        onHold: true,
        placedOnHoldAt: 'not-a-date',
      }),
      caseRow('future', {
        onHold: true,
        placedOnHoldAt: '2026-07-25T00:00:00.000Z',
      }),
      caseRow('not-held', {
        onHold: false,
        placedOnHoldAt: '2026-07-01T00:00:00.000Z',
      }),
    ],
    sources,
    new Date('2026-07-24T00:00:00.000Z')
  );

  assert.equal(model[0].onHold, 3);
  assert.equal(model[0].longestHoldDays, 0);
  assert.equal(model.at(-1)?.longestHoldDays, 0);
});

test('buildTeamWorkload: an empty live position still returns the all-staff totals row', () => {
  assert.deepEqual(
    buildTeamWorkload([], sources, new Date('2026-07-24T00:00:00.000Z')),
    [
      {
        reviewerId: null,
        reviewer: 'Total',
        countsByCaseType: { complaints: 0, conduct: 0 },
        totalOutstanding: 0,
        onHold: 0,
        longestHoldDays: null,
        isTotal: true,
      },
    ]
  );
});
