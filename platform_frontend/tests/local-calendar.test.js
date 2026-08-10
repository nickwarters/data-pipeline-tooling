// @ts-check

/**
 * These tests pin their own zone rather than inheriting the runner's, and that
 * is the whole point of them.
 *
 * Converting an instant to a calendar date is only visibly wrong for part of
 * the day, and only in some zones. A test that asserts a date from an instant
 * in whatever zone the machine happens to be in either passes everywhere by
 * luck or fails on somebody else's laptop — and the repair for that is usually
 * to feed it a date-only fixture, which skips the conversion altogether and
 * leaves it covered by nothing at all. So each case names the zone it is asking
 * about and states the answer for that zone, and the zone is restored
 * afterwards so nothing leaks into the next test.
 *
 * The five zones span 25 hours, from UTC+14 to UTC-11. No single instant keeps
 * one calendar date across all of them, which is exactly why the expectations
 * differ per zone instead of being shared.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDateKey,
  shiftDateKey,
  startOfLocalDay,
  toLocalDateKey,
  weekdayOfDateKey,
} from '../src/lib/local-calendar.js';

/**
 * @template T
 * @param {string} zone
 * @param {() => T} run
 * @returns {T}
 */
function inTimeZone(zone, run) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

/** Late-evening UTC: already tomorrow east of Greenwich. */
const LATE_EVENING_UTC = '2026-08-10T23:30:00.000Z';
/** Early-morning UTC: still yesterday west of Greenwich. */
const EARLY_MORNING_UTC = '2026-08-10T00:30:00.000Z';

/** @type {[string, string, string][]} zone, late-evening date, early-morning date */
const ZONE_CASES = [
  ['Pacific/Kiritimati', '2026-08-11', '2026-08-10'],
  ['Asia/Tokyo', '2026-08-11', '2026-08-10'],
  ['Europe/London', '2026-08-11', '2026-08-10'],
  ['America/Los_Angeles', '2026-08-10', '2026-08-09'],
  ['Pacific/Midway', '2026-08-10', '2026-08-09'],
];

for (const [zone, lateEvening, earlyMorning] of ZONE_CASES) {
  test(`toLocalDateKey: an instant lands on the browser's own date in ${zone}`, () => {
    inTimeZone(zone, () => {
      assert.equal(
        toLocalDateKey(new Date(LATE_EVENING_UTC)),
        lateEvening,
        `${LATE_EVENING_UTC} is ${lateEvening} in ${zone}`
      );
      assert.equal(
        toLocalDateKey(new Date(EARLY_MORNING_UTC)),
        earlyMorning,
        `${EARLY_MORNING_UTC} is ${earlyMorning} in ${zone}`
      );
    });
  });
}

test('toLocalDateKey: the two sample instants disagree with UTC in every pinned zone', () => {
  // The guard on the guard. Between them the two instants differ from the UTC
  // calendar date in all five zones, so swapping the local getters for their
  // UTC twins cannot pass anywhere the suite runs.
  const utcDates = ['2026-08-10', '2026-08-10'];
  for (const [zone, lateEvening, earlyMorning] of ZONE_CASES) {
    assert.ok(
      lateEvening !== utcDates[0] || earlyMorning !== utcDates[1],
      `${zone} must have at least one sample instant whose local date is not the UTC date`
    );
  }
});

test('toLocalDateKey: accepts an instant string as well as a Date', () => {
  inTimeZone('Asia/Tokyo', () => {
    assert.equal(toLocalDateKey(LATE_EVENING_UTC), '2026-08-11');
  });
});

test('toLocalDateKey: pads a single-digit month and day', () => {
  inTimeZone('Europe/London', () => {
    assert.equal(
      toLocalDateKey(new Date('2026-01-02T12:00:00.000Z')),
      '2026-01-02'
    );
  });
});

test('toLocalDateKey: there is no date without a usable instant', () => {
  assert.equal(toLocalDateKey(null), null);
  assert.equal(toLocalDateKey(undefined), null);
  assert.equal(toLocalDateKey('not a date'), null);
  assert.equal(toLocalDateKey(new Date('not a date')), null);
});

test('startOfLocalDay: a calendar date begins at a different instant in each zone', () => {
  assert.equal(
    inTimeZone('Asia/Tokyo', () => startOfLocalDay('2026-08-10').toISOString()),
    '2026-08-09T15:00:00.000Z'
  );
  assert.equal(
    inTimeZone('America/Los_Angeles', () =>
      startOfLocalDay('2026-08-10').toISOString()
    ),
    '2026-08-10T07:00:00.000Z'
  );
  assert.equal(
    inTimeZone('Pacific/Kiritimati', () =>
      startOfLocalDay('2026-08-10').toISOString()
    ),
    '2026-08-09T10:00:00.000Z'
  );
});

test('startOfLocalDay and toLocalDateKey are inverses within a zone', () => {
  for (const [zone] of ZONE_CASES) {
    inTimeZone(zone, () => {
      for (const dateKey of [
        '2026-01-01',
        '2026-03-29',
        '2026-10-25',
        '2026-12-31',
      ]) {
        assert.equal(
          toLocalDateKey(startOfLocalDay(dateKey)),
          dateKey,
          `${dateKey} should survive the round trip in ${zone}`
        );
      }
    });
  }
});

test('shiftDateKey: whole calendar days, including across a zone change', () => {
  const shifts = () => [
    shiftDateKey('2026-08-10', 1),
    shiftDateKey('2026-08-10', -1),
    shiftDateKey('2026-08-31', 1),
    shiftDateKey('2026-01-01', -1),
    // British Summer Time begins on 29 March 2026; that day is still one day.
    shiftDateKey('2026-03-28', 1),
    shiftDateKey('2026-08-10', 0),
  ];
  const expected = [
    '2026-08-11',
    '2026-08-09',
    '2026-09-01',
    '2025-12-31',
    '2026-03-29',
    '2026-08-10',
  ];

  // Calendar arithmetic answers the same everywhere, which is what makes it
  // safe to do once and reuse in any zone.
  assert.deepEqual(inTimeZone('Europe/London', shifts), expected);
  assert.deepEqual(inTimeZone('Pacific/Kiritimati', shifts), expected);
  assert.deepEqual(inTimeZone('Pacific/Midway', shifts), expected);
});

test('weekdayOfDateKey: the weekday of a date, not of an instant', () => {
  const weekdays = () =>
    ['2026-08-08', '2026-08-09', '2026-08-10', '2026-08-14'].map(
      weekdayOfDateKey
    );

  assert.deepEqual(inTimeZone('Pacific/Kiritimati', weekdays), [6, 0, 1, 5]);
  assert.deepEqual(inTimeZone('Pacific/Midway', weekdays), [6, 0, 1, 5]);
});

test('isDateKey: only a calendar date key passes', () => {
  assert.equal(isDateKey('2026-08-10'), true);
  assert.equal(isDateKey('2026-8-10'), false);
  assert.equal(isDateKey('2026-08-10T00:00:00.000Z'), false);
  assert.equal(isDateKey(''), false);
  assert.equal(isDateKey(null), false);
  assert.equal(isDateKey(20260810), false);
});
