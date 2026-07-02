// @ts-check

/**
 * The remediation SLA: **10 working days after Send Actions** (ADR-0024). The
 * due date is computed once at the reportable milestone and stored on the Case
 * row (ADR-0025); it is never recomputed on read.
 */
export const REMEDIATION_SLA_WORKING_DAYS = 10;

/**
 * England & Wales public holidays — the default in-code holiday source for the
 * working-day SLA calculation (ADR-0025). ISO `YYYY-MM-DD` dates.
 *
 * **Maintenance burden (ADR-0025):** this list must be refreshed annually, or
 * whenever holidays change. A stale list silently produces *early* due dates.
 * The Maintainer runbook owns keeping it current. Switching the source to a
 * SharePoint list later is a boot-time wiring change (the `addWorkingDays`
 * helper takes `holidays` as a parameter), not a logic change.
 *
 * @type {readonly string[]}
 */
export const ENGLAND_WALES_HOLIDAYS = Object.freeze([
  // 2026
  '2026-01-01', // New Year's Day
  '2026-04-03', // Good Friday
  '2026-04-06', // Easter Monday
  '2026-05-04', // Early May bank holiday
  '2026-05-25', // Spring bank holiday
  '2026-08-31', // Summer bank holiday
  '2026-12-25', // Christmas Day
  '2026-12-28', // Boxing Day (substitute — 26 Dec is a Saturday)
  // 2027
  '2027-01-01', // New Year's Day
  '2027-03-26', // Good Friday
  '2027-03-29', // Easter Monday
  '2027-05-03', // Early May bank holiday
  '2027-05-31', // Spring bank holiday
  '2027-08-30', // Summer bank holiday
  '2027-12-27', // Christmas Day (substitute — 25 Dec is a Saturday)
  '2027-12-28', // Boxing Day (substitute — 26 Dec is a Sunday)
]);
