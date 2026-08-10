// @ts-check
/**
 * Instants and calendar dates are different things, and this module is the one
 * place in the app that crosses between them.
 *
 * A Case's `reportableAt` is an **instant**: a moment, carried as UTC. "How
 * many Cases did I finish on Tuesday?" is a question about a **calendar date**,
 * and the calendar a Reviewer means is the one on their own machine — the
 * browser's local zone. The two are not interchangeable: half past nine on a
 * Monday evening in London is already Tuesday in Tokyo, so the same instant
 * belongs to two different days depending on who is asking.
 *
 * So My Stats keeps one rule, spelled here: every date key it holds is a
 * browser-local calendar date (`YYYY-MM-DD`), and every value it sends to
 * SharePoint is an instant. Crossing that line anywhere else is how the page
 * would start disagreeing with itself about which day a Case landed on.
 */

/** @param {number} value @returns {string} */
function twoDigits(value) {
  return String(value).padStart(2, '0');
}

/**
 * The browser-local calendar date an **instant** falls on.
 *
 * Pass a `Date`, or a string carrying a time (`2026-08-10T22:30:00Z`). A
 * date-only string is not an instant — `new Date('2026-08-10')` is midnight
 * *UTC*, which is the 9th anywhere west of Greenwich — so nothing that already
 * holds a calendar date (the Report Feed's rows, a range descriptor) is ever
 * passed through here. It has nothing to convert.
 *
 * @param {Date | string | null | undefined} instant
 * @returns {string | null} `YYYY-MM-DD`, or null when there is no usable instant
 */
export function toLocalDateKey(instant) {
  const date =
    instant instanceof Date
      ? instant
      : typeof instant === 'string'
        ? new Date(instant)
        : null;
  if (date === null || !Number.isFinite(date.getTime())) return null;
  // The local-field getters are the conversion. Their UTC twins would answer a
  // question nobody asked — which day it was in Greenwich — and would agree
  // with these for most of the day, which is precisely what makes the mistake
  // survive a casual test.
  return `${String(date.getFullYear()).padStart(4, '0')}-${twoDigits(
    date.getMonth() + 1
  )}-${twoDigits(date.getDate())}`;
}

/**
 * Whether a value is a calendar date key this module can work with. Used where
 * one arrives from outside the app — a published file, a URL — and everything
 * downstream would otherwise trust it.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * The instant a browser-local calendar date begins. The inverse of
 * `toLocalDateKey`, and what turns a date key back into something a
 * SharePoint date filter can compare against.
 *
 * @param {string} dateKey `YYYY-MM-DD`
 * @returns {Date}
 */
export function startOfLocalDay(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

/**
 * Step a calendar date key by whole days.
 *
 * Deliberately arithmetic on the key, anchored in UTC, rather than on a local
 * `Date`: adding a day to a calendar date is a calendar operation, and a local
 * anchor would make it 23 or 25 hours on the two days a year a zone shifts.
 *
 * @param {string} dateKey `YYYY-MM-DD`
 * @param {number} days
 * @returns {string} `YYYY-MM-DD`
 */
export function shiftDateKey(dateKey, days) {
  const anchor = new Date(`${dateKey}T00:00:00.000Z`);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}

/**
 * The day of the week a calendar date key falls on, `0` Sunday to `6`
 * Saturday. Key arithmetic again, so the answer never depends on where the
 * browser is.
 *
 * @param {string} dateKey `YYYY-MM-DD`
 * @returns {number}
 */
export function weekdayOfDateKey(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}
