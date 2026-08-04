// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addWorkingDays } from '../src/lib/add-working-days.js';

test('addWorkingDays: adds days within a single working week', () => {
  // Mon 2026-06-01 + 3 working days = Thu 2026-06-04.
  assert.equal(addWorkingDays('2026-06-01', 3), '2026-06-04');
});

test('addWorkingDays: skips the weekend', () => {
  // Fri 2026-06-05 + 1 working day skips Sat/Sun to Mon 2026-06-08.
  assert.equal(addWorkingDays('2026-06-05', 1), '2026-06-08');
});

test('addWorkingDays: n === 0 returns the start date unchanged', () => {
  assert.equal(addWorkingDays('2026-06-01', 0), '2026-06-01');
});

test('addWorkingDays: ignores the time-of-day component of the input', () => {
  assert.equal(addWorkingDays('2026-06-01T23:30:00.000Z', 1), '2026-06-02');
});

test('addWorkingDays: a holiday landing on the due date is skipped', () => {
  // Mon 2026-06-01 + 1 working day would land on Tue 2026-06-02, but that day
  // is a holiday, so the due date rolls forward to Wed 2026-06-03.
  assert.equal(addWorkingDays('2026-06-01', 1, ['2026-06-02']), '2026-06-03');
});

test('addWorkingDays: a run straddling a holiday block skips every listed day', () => {
  // Mon 2026-06-01 + 3 working days with Wed/Thu as holidays: Tue counts (1),
  // Wed+Thu skipped, Fri (2), Sat/Sun skipped, Mon (3) = 2026-06-08.
  assert.equal(
    addWorkingDays('2026-06-01', 3, ['2026-06-03', '2026-06-04']),
    '2026-06-08'
  );
});
