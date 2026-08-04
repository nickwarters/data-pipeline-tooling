// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ENGLAND_WALES_HOLIDAYS,
  REMEDIATION_SLA_WORKING_DAYS,
} from '../src/config/working-days.js';
import { addWorkingDays } from '../src/lib/add-working-days.js';

test('working-days config: the SLA is 10 working days', () => {
  assert.equal(REMEDIATION_SLA_WORKING_DAYS, 10);
});

test('working-days config: holidays are unique, sorted ISO dates', () => {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  for (const d of ENGLAND_WALES_HOLIDAYS) {
    assert.match(d, isoDate, `${d} is a YYYY-MM-DD ISO date`);
  }
  const sorted = [...ENGLAND_WALES_HOLIDAYS].sort();
  assert.deepEqual([...ENGLAND_WALES_HOLIDAYS], sorted, 'chronological');
  assert.equal(
    new Set(ENGLAND_WALES_HOLIDAYS).size,
    ENGLAND_WALES_HOLIDAYS.length,
    'no duplicates'
  );
});

test('working-days config: the holiday list is frozen', () => {
  assert.throws(() => {
    // @ts-expect-error — verifying the frozen array rejects mutation.
    ENGLAND_WALES_HOLIDAYS.push('2099-01-01');
  });
});

test('working-days config: drives a real SLA date over the Christmas block', () => {
  // Send Actions on Fri 2026-12-18 + 10 working days. The run jumps the two
  // Christmas holidays (25 & 28 Dec), New Year's Day (1 Jan 2027), and three
  // weekends, landing on Wed 2027-01-06.
  assert.equal(
    addWorkingDays(
      '2026-12-18',
      REMEDIATION_SLA_WORKING_DAYS,
      ENGLAND_WALES_HOLIDAYS
    ),
    '2027-01-06'
  );
});
