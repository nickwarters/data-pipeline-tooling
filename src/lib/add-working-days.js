// @ts-check

/**
 * Whether `date` (a UTC-anchored `Date`) is a working day: not a Saturday,
 * Sunday, or listed holiday.
 *
 * @param {Date} date
 * @param {Set<string>} holidaySet - ISO `YYYY-MM-DD` dates treated as holidays.
 * @returns {boolean}
 */
function isWorkingDay(date, holidaySet) {
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !holidaySet.has(date.toISOString().slice(0, 10));
}

/**
 * Add `n` working days to a date, skipping weekends and holidays (ADR-0025).
 *
 * A pure, dependency-free framework primitive with no domain knowledge. It
 * steps forward one calendar day at a time from `fromISO`; each day that is not
 * a Saturday, Sunday, or listed holiday counts as one working day. The result
 * is the date on which the `n`-th working day lands, so it is always itself a
 * working day — a holiday that would otherwise fall on the due date is skipped
 * rather than returned.
 *
 * Only the calendar date of `fromISO` is used; any time-of-day component is
 * ignored and the UTC date is taken, so local offsets and DST never shift a
 * day. `n === 0` returns `fromISO`'s own date unchanged.
 *
 * @param {string} fromISO - ISO date or datetime, e.g. `'2026-07-02'` or
 *   `'2026-07-02T09:00:00.000Z'`.
 * @param {number} n - Number of working days to add (non-negative integer).
 * @param {readonly string[]} [holidays] - ISO `YYYY-MM-DD` dates to treat as
 *   non-working, in addition to weekends.
 * @returns {string} The resulting date as `'YYYY-MM-DD'`.
 */
export function addWorkingDays(fromISO, n, holidays = []) {
  const holidaySet = new Set(holidays);
  // Anchor on the UTC calendar date so time zones / DST never move a day.
  const date = new Date(`${fromISO.slice(0, 10)}T00:00:00.000Z`);
  let remaining = n;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isWorkingDay(date, holidaySet)) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}
