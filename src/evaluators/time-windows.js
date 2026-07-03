// @ts-check
/**
 * @typedef {{ sevenDaysAgo: Date, thirtyDaysAgo: Date }} TimeWindows
 */

/**
 * Returns time window boundaries aligned to local midnight.
 * "Last 7 days" = midnight 6 calendar days ago → now.
 * "Last 30 days" = midnight 29 calendar days ago → now.
 *
 * @param {Date} now
 * @returns {TimeWindows}
 */
export function computeTimeWindows(now) {
  const sevenDaysAgo = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 6,
    0,
    0,
    0
  );
  const thirtyDaysAgo = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 29,
    0,
    0,
    0
  );
  return { sevenDaysAgo, thirtyDaysAgo };
}
