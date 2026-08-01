// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAssignmentStamp } from '../src/services/assignment-stamp.js';

const FROZEN = '2026-08-01T09:30:00.000Z';
const now = () => new Date(FROZEN);

test('a write that does not touch the Assigned Reviewer is handed back untouched', () => {
  const fields = { answers: {}, notes: 'a note' };
  // Identity, not equality: an ordinary Answers save is provably not rewritten.
  assert.equal(withAssignmentStamp(fields, now), fields);
});

test('assigning a Reviewer stamps the moment of assignment', () => {
  const fields = { assignedReviewer: 'jsmith' };
  const stamped = withAssignmentStamp(fields, now);
  assert.deepEqual(stamped, { assignedReviewer: 'jsmith', assignedAt: FROZEN });
  assert.deepEqual(fields, { assignedReviewer: 'jsmith' });
});

test('unassigning a Case clears the assignment time rather than leaving a stale one', () => {
  assert.deepEqual(withAssignmentStamp({ assignedReviewer: '' }, now), {
    assignedReviewer: '',
    assignedAt: null,
  });
});

test('an explicitly supplied assignment time wins and the clock is never read', () => {
  let reads = 0;
  const counting = () => {
    reads += 1;
    return new Date(FROZEN);
  };
  const fields = {
    assignedReviewer: 'jsmith',
    assignedAt: '2020-01-01T00:00:00.000Z',
  };
  assert.equal(withAssignmentStamp(fields, counting), fields);
  assert.equal(reads, 0);
});
