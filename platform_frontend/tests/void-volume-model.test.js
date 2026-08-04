// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVoidVolumes } from '../src/evaluators/void-volume-model.js';
import { makeCaseRow } from './helpers/fixtures.js';

// Capability: the manager's void-volume report over a 30-day window.

const NOW = new Date('2026-07-24T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {number} days */
const daysAgo = (days) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

/** @type {import('../src/setup/resolve-eligible-case-types.js').CaseSource[]} */
const SOURCES = [
  {
    slug: 'complaints',
    listName: 'Cases-Complaints',
    displayName: 'Complaints',
  },
  { slug: 'conduct', listName: 'Cases-Conduct', displayName: 'Conduct' },
];

/**
 * @param {string} id
 * @param {Partial<import('../src/sharepoint-client.js').CaseRow>} over
 */
function voided(id, over) {
  return makeCaseRow({
    id,
    caseType: 'complaints',
    status: 'Void',
    voidReason: 'duplicate',
    voidedAt: daysAgo(1),
    voidedBy: 'reviewer-a',
    ...over,
  });
}

test('buildVoidVolumes: groups by who voided the Case', () => {
  const rows = buildVoidVolumes(
    [
      voided('a', { voidedBy: 'reviewer-a' }),
      voided('b', { voidedBy: 'reviewer-b' }),
      voided('c', { voidedBy: 'reviewer-a' }),
    ],
    SOURCES,
    NOW
  );

  assert.deepEqual(
    rows.map((row) => [row.reviewerId, row.last30]),
    [
      ['reviewer-a', 2],
      ['reviewer-b', 1],
      [null, 3],
    ]
  );
});

test('buildVoidVolumes: a Case voided eight days ago counts in 30 days, not in 7', () => {
  const [row] = buildVoidVolumes(
    [voided('a', { voidedAt: daysAgo(8) })],
    SOURCES,
    NOW
  );
  assert.equal(row.last7, 0);
  assert.equal(row.last30, 1);
});

test('buildVoidVolumes: each window starts inclusively', () => {
  const rows = buildVoidVolumes(
    [
      voided('exactly-7', { voidedAt: daysAgo(7) }),
      voided('exactly-30', { voidedAt: daysAgo(30) }),
      voided('long-ago', { voidedAt: daysAgo(31) }),
    ],
    SOURCES,
    NOW
  );
  const [row] = rows;
  assert.equal(
    row.last7,
    1,
    'exactly seven days ago is inside the 7-day window'
  );
  assert.equal(
    row.last30,
    2,
    'exactly thirty days ago is in, thirty-one is out'
  );
});

test('buildVoidVolumes: a Case Type outside the passed sources is ignored', () => {
  assert.deepEqual(
    buildVoidVolumes([voided('a', { caseType: 'not-a-source' })], SOURCES, NOW),
    [
      {
        reviewerId: null,
        reviewer: 'Total',
        last7: 0,
        last30: 0,
        countsByCaseType: { complaints: 0, conduct: 0 },
        leadingReason: '—',
        isTotal: true,
      },
    ]
  );
});

test('buildVoidVolumes: an unknown reason key renders as itself', () => {
  const [row] = buildVoidVolumes(
    [voided('a', { voidReason: 'retired-reason' })],
    SOURCES,
    NOW
  );
  assert.equal(row.leadingReason, 'retired-reason');

  // Tied with a reason the framework knows, the known one leads: an unknown key
  // sorts behind every listed reason rather than at an arbitrary position.
  const [tied] = buildVoidVolumes(
    [
      voided('a', { voidReason: 'retired-reason' }),
      voided('b', { voidReason: 'withdrawn' }),
    ],
    SOURCES,
    NOW
  );
  assert.equal(tied.leadingReason, 'Withdrawn by the business');
});

test('buildVoidVolumes: the leading reason is the most-used over 30 days, ties broken by display order', () => {
  const [modal] = buildVoidVolumes(
    [
      voided('a', { voidReason: 'withdrawn' }),
      voided('b', { voidReason: 'withdrawn' }),
      voided('c', { voidReason: 'duplicate' }),
    ],
    SOURCES,
    NOW
  );
  assert.equal(modal.leadingReason, 'Withdrawn by the business');

  const [tied] = buildVoidVolumes(
    [
      voided('a', { voidReason: 'withdrawn' }),
      voided('b', { voidReason: 'duplicate' }),
    ],
    SOURCES,
    NOW
  );
  assert.equal(
    tied.leadingReason,
    'Duplicate of another Case',
    'the framework display order settles a tie'
  );
});

test('buildVoidVolumes: the appended Total sums every column', () => {
  const rows = buildVoidVolumes(
    [
      voided('a', { voidedBy: 'reviewer-a', caseType: 'complaints' }),
      voided('b', {
        voidedBy: 'reviewer-b',
        caseType: 'conduct',
        voidedAt: daysAgo(20),
        voidReason: 'withdrawn',
      }),
    ],
    SOURCES,
    NOW
  );
  const total = rows.at(-1);
  assert.deepEqual(total, {
    reviewerId: null,
    reviewer: 'Total',
    last7: 1,
    last30: 2,
    countsByCaseType: { complaints: 1, conduct: 1 },
    leadingReason: 'Duplicate of another Case',
    isTotal: true,
  });
});

test('buildVoidVolumes: no voided Cases leaves just the Total row', () => {
  assert.deepEqual(
    buildVoidVolumes([], SOURCES, NOW).map((row) => row.reviewer),
    ['Total']
  );
});

test('buildVoidVolumes: a row nobody is recorded as voiding is ignored', () => {
  assert.deepEqual(
    buildVoidVolumes(
      [voided('a', { voidedBy: undefined }), voided('b', { voidedBy: '' })],
      SOURCES,
      NOW
    ).map((row) => row.reviewer),
    ['Total']
  );
});
