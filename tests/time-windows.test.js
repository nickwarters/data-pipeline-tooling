// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { computeTimeWindows } =
  await import('../src/evaluators/time-windows.js');

test('computeTimeWindows: sevenDaysAgo is midnight of 6 calendar days ago', () => {
  const now = new Date(2026, 4, 17, 15, 30, 0); // May 17 2026, 3:30pm local
  const { sevenDaysAgo } = computeTimeWindows(now);
  const expected = new Date(2026, 4, 11, 0, 0, 0); // May 11 2026, midnight local
  assert.equal(sevenDaysAgo.getTime(), expected.getTime());
});

test('computeTimeWindows: thirtyDaysAgo is midnight of 29 calendar days ago', () => {
  const now = new Date(2026, 4, 17, 15, 30, 0); // May 17 2026, 3:30pm local
  const { thirtyDaysAgo } = computeTimeWindows(now);
  const expected = new Date(2026, 3, 18, 0, 0, 0); // Apr 18 2026, midnight local (29 days before May 17)
  assert.equal(thirtyDaysAgo.getTime(), expected.getTime());
});
