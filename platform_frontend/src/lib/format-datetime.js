// @ts-check
/**
 * How a stored date or instant is written on screen.
 *
 * The app stores time the way SharePoint hands it back: an ISO instant
 * (`2026-06-18T08:00:00Z`) for anything stamped by a clock, and a bare
 * calendar date key (`2026-06-18`) for anything a working-day calculation
 * produced. Neither is something to read. This module is the one place that
 * turns them into display text, so every surface writes a date the same way.
 *
 * Two shapes, because the domain has two ideas:
 *
 * - **A date** — the day something is due, the day a complaint was made —
 *   renders `dd/mm/yyyy`. There is no time of day to show and none is invented.
 * - **A timestamp** — when a Case was created, assigned, completed, or a
 *   message sent — renders `18 Jun 2026, 08:00`. The month is named so the
 *   number that follows cannot be misread as a second date field, and the
 *   clock is 24-hour.
 *
 * The output is spelled here rather than delegated to `toLocaleDateString()`,
 * for two reasons. It used to be, and that made the format a property of the
 * *reader's* browser: a Reviewer with a US locale saw `6/18/2026` on the same
 * Case a UK Reviewer read as `18/06/2026`, and the two disagree about which
 * number is the day. And an `Intl` format is not stable across ICU versions —
 * the separators in a formatted time have changed under Node — so a test
 * asserting the rendered string would be asserting the build's ICU data.
 *
 * A calendar date key is rendered as written; an instant is resolved to the
 * viewer's local calendar first, through `local-calendar.js` — the one module
 * allowed to cross between the two.
 */
import { isDateKey, toLocalDateKey } from './local-calendar.js';

/**
 * What every surface shows in place of a date it does not have. An em dash,
 * not an empty cell: "not set" and "failed to render" look identical when both
 * are blank.
 */
export const NO_VALUE = '—';

const MONTH_NAMES = Object.freeze([
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]);

/** @param {number} value @returns {string} */
function twoDigits(value) {
  return String(value).padStart(2, '0');
}

/**
 * The calendar date a value falls on, as a `YYYY-MM-DD` key.
 *
 * A key is already an answer and is returned untouched — parsing it would read
 * it as midnight UTC, which is the day before anywhere west of Greenwich, and
 * would move a due date by a day for exactly the readers least likely to
 * notice. Anything else is an instant and resolves to the viewer's local day.
 *
 * @param {unknown} value
 * @returns {string | null} `YYYY-MM-DD`, or null when there is no usable date
 */
function dateKeyOf(value) {
  if (value instanceof Date) return toLocalDateKey(value);
  if (typeof value !== 'string' || value.trim() === '') return null;
  return isDateKey(value) ? value : toLocalDateKey(value);
}

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
function instantOf(value) {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? new Date(value)
        : null;
  return date !== null && Number.isFinite(date.getTime()) ? date : null;
}

/**
 * A date, as `dd/mm/yyyy`.
 *
 * @param {unknown} value An ISO instant, a `YYYY-MM-DD` key, or a `Date`.
 * @param {string} [fallback] Shown when there is no readable date.
 * @returns {string}
 */
export function formatDate(value, fallback = NO_VALUE) {
  const key = dateKeyOf(value);
  if (key === null) return fallback;
  const [year, month, day] = key.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * An instant, as `18 Jun 2026, 08:00` in the viewer's own zone.
 *
 * A `YYYY-MM-DD` key carries no time of day, so it renders as `18 Jun 2026`
 * rather than acquiring a midnight it never had.
 *
 * @param {unknown} value An ISO instant, a `YYYY-MM-DD` key, or a `Date`.
 * @param {string} [fallback] Shown when there is no readable instant.
 * @returns {string}
 */
export function formatTimestamp(value, fallback = NO_VALUE) {
  if (typeof value === 'string' && isDateKey(value)) {
    return formatDayMonthYear(value, fallback);
  }
  const instant = instantOf(value);
  if (instant === null) return fallback;
  const day = `${instant.getDate()} ${MONTH_NAMES[instant.getMonth()]} ${instant.getFullYear()}`;
  return `${day}, ${twoDigits(instant.getHours())}:${twoDigits(instant.getMinutes())}`;
}

/**
 * The named-month day on its own — `18 Jun 2026`. Used where a timestamp is
 * asked for and only a calendar date exists.
 *
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function formatDayMonthYear(value, fallback = NO_VALUE) {
  const key = dateKeyOf(value);
  if (key === null) return fallback;
  const [year, month, day] = key.split('-');
  return `${Number(day)} ${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

/**
 * Format a value whose *shape* is known but whose meaning is not — a Case
 * Type-configured Case Details field, which may hold a date, an instant, or a
 * reference number nobody should reformat.
 *
 * A `YYYY-MM-DD` key reads as a date and an ISO instant as a timestamp;
 * everything else is returned verbatim, because guessing is how `CMP-2026-0001`
 * would become a date.
 *
 * @param {unknown} value
 * @param {string} [fallback] Shown when the value is absent.
 * @returns {string}
 */
export function formatDateLike(value, fallback = NO_VALUE) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return String(value);
  if (isDateKey(value)) return formatDate(value, fallback);
  return isIsoInstant(value) ? formatTimestamp(value, fallback) : value;
}

/**
 * Whether a string is an ISO 8601 instant — a date key, a `T`, and a time.
 * Deliberately a pattern rather than "does `new Date()` accept it": `Date`
 * accepts `CMP-2026` shaped input on some engines, and a Case reference is
 * exactly what must survive unformatted.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isIsoInstant(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
}
