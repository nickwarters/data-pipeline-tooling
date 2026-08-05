// @ts-check

// The clean-room route owns the same explicit calendar contract as the current
// dashboard. Keep this short in-code source current through the operator runbook.
const ENGLAND_WALES_HOLIDAYS = new Set([
  '2026-01-01',
  '2026-04-03',
  '2026-04-06',
  '2026-05-04',
  '2026-05-25',
  '2026-08-31',
  '2026-12-25',
  '2026-12-28',
  '2027-01-01',
  '2027-03-26',
  '2027-03-29',
  '2027-05-03',
  '2027-05-31',
  '2027-08-30',
  '2027-12-27',
  '2027-12-28',
]);

/** @param {string} fromISO @param {number} days */
export function addWorkingDays(fromISO, days) {
  const date = new Date(`${fromISO.slice(0, 10)}T00:00:00.000Z`);
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const key = date.toISOString().slice(0, 10);
    if (
      date.getUTCDay() !== 0 &&
      date.getUTCDay() !== 6 &&
      !ENGLAND_WALES_HOLIDAYS.has(key)
    ) {
      remaining -= 1;
    }
  }
  return date.toISOString().slice(0, 10);
}
