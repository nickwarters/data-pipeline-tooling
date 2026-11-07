// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCaseRow } from './helpers/fixtures.js';

const { buildTeamWorkload } =
  await import('../src/evaluators/team-workload-model.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

// Days in progress count calendar dates in the viewer's own zone, so the zone
// is pinned once and the fixtures below mean the dates they read as.
process.env.TZ = 'UTC';

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
        assignedAt: '2026-07-10T12:00:00.000Z',
        onHold: true,
        placedOnHoldAt: '2026-07-20T00:00:00.000Z',
      }),
      caseRow('a2', {
        assignedReviewer: 'reviewer-a',
        caseType: 'conduct',
        status: 'Actions In Progress',
        assignedAt: '2026-07-21T12:00:00.000Z',
        onHold: true,
        placedOnHoldAt: '2026-07-22T00:00:00.000Z',
      }),
      caseRow('b1', {
        assignedReviewer: 'reviewer-b',
        caseType: 'conduct',
        assignedAt: '2026-07-23T12:00:00.000Z',
        onHold: true,
        placedOnHoldAt: '2026-07-22T00:00:00.000Z',
      }),
      caseRow('completed', { status: 'Completed' }),
      caseRow('unallocated', { assignedReviewer: '' }),
      caseRow('unknown-type', { caseType: 'unknown' }),
    ],
    sources,
    new Date('2026-07-24T12:00:00.000Z')
  );

  assert.deepEqual(model, [
    {
      reviewerId: 'reviewer-a',
      reviewer: 'reviewer-a',
      countsByCaseType: { complaints: 1, conduct: 1 },
      totalOutstanding: 2,
      longestInProgressDays: 14,
      onHold: 2,
      longestHoldDays: 4,
      isTotal: false,
    },
    {
      reviewerId: 'reviewer-b',
      reviewer: 'reviewer-b',
      countsByCaseType: { complaints: 0, conduct: 1 },
      totalOutstanding: 1,
      longestInProgressDays: 1,
      onHold: 1,
      longestHoldDays: 2,
      isTotal: false,
    },
    {
      reviewerId: null,
      reviewer: 'Total',
      countsByCaseType: { complaints: 1, conduct: 2 },
      totalOutstanding: 3,
      longestInProgressDays: 14,
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
        longestInProgressDays: null,
        onHold: 0,
        longestHoldDays: null,
        isTotal: true,
      },
    ]
  );
});

test('buildTeamWorkload: longest in progress is the oldest allocation, held or not, in calendar days', () => {
  const model = buildTeamWorkload(
    [
      caseRow('held', {
        assignedAt: '2026-07-04T12:00:00.000Z',
        onHold: true,
        placedOnHoldAt: '2026-07-20T12:00:00.000Z',
      }),
      caseRow('recent', { assignedAt: '2026-07-22T12:00:00.000Z' }),
      caseRow('unstamped', { assignedAt: null }),
      caseRow('unreadable', { assignedAt: 'not-a-date' }),
      caseRow('future', { assignedAt: '2026-07-30T12:00:00.000Z' }),
      caseRow('today', {
        assignedReviewer: 'reviewer-b',
        assignedAt: '2026-07-24T09:00:00.000Z',
      }),
      caseRow('unknown-only', {
        assignedReviewer: 'reviewer-c',
        assignedAt: null,
      }),
    ],
    sources,
    new Date('2026-07-24T15:00:00.000Z')
  );

  assert.deepEqual(
    model.map((row) => [row.reviewer, row.longestInProgressDays]),
    [
      ['reviewer-a', 20],
      ['reviewer-b', 0],
      ['reviewer-c', null],
      ['Total', 20],
    ]
  );
});

test('buildTeamWorkload: a Case allocated late yesterday is a day in progress by early today', () => {
  const [row] = buildTeamWorkload(
    [caseRow('overnight', { assignedAt: '2026-07-23T23:00:00.000Z' })],
    sources,
    new Date('2026-07-24T01:00:00.000Z')
  );

  assert.equal(row.longestInProgressDays, 1);
});
