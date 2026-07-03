// @ts-check
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('./time-windows.js').TimeWindows} TimeWindows */

/**
 * @typedef {{
 *   completedLast7d: number,
 *   completedLast30d: number,
 *   outstanding: number,
 *   overdue: number
 * }} TeamCounts
 */

/**
 * @typedef {{ completedLast7d: number, completedLast30d: number, outstanding: number, overdue: number, byType: Record<string, TeamCounts> }} AggregateResult
 */

/**
 * Pure aggregation of CaseRows into KPI counts.
 * completedLast30d is the total for the 30-day window (includes 7-day cases).
 *
 * @param {CaseRow[]} cases
 * @param {TimeWindows} windows
 * @returns {AggregateResult}
 */
export function aggregateReviewerTeamData(cases, windows) {
  /** @type {AggregateResult} */
  const result = {
    completedLast7d: 0,
    completedLast30d: 0,
    outstanding: 0,
    overdue: 0,
    byType: {},
  };

  // Derive "now" from the sevenDaysAgo window boundary (midnight 6 calendar days ago)
  // so that overdue comparisons are consistent with the same time reference used to
  // build the windows, rather than the actual wall-clock time of execution.
  const sevenDaysAgoDate = windows.sevenDaysAgo;
  const now = new Date(
    sevenDaysAgoDate.getFullYear(),
    sevenDaysAgoDate.getMonth(),
    sevenDaysAgoDate.getDate() + 6,
    23,
    59,
    59,
    999
  );

  for (const c of cases) {
    const type = c.caseType;
    if (!result.byType[type]) {
      result.byType[type] = {
        completedLast7d: 0,
        completedLast30d: 0,
        outstanding: 0,
        overdue: 0,
      };
    }
    const bucket = result.byType[type];

    if (c.status === 'Completed' && c.completedAt) {
      const completedAt = new Date(c.completedAt);
      if (completedAt >= windows.sevenDaysAgo) {
        result.completedLast7d++;
        bucket.completedLast7d++;
      }
      if (completedAt >= windows.thirtyDaysAgo) {
        result.completedLast30d++;
        bucket.completedLast30d++;
      }
    } else if (c.status === 'In-progress') {
      const isOverdue = !!c.dueDate && new Date(c.dueDate) < now;
      if (isOverdue) {
        result.overdue++;
        bucket.overdue++;
      } else {
        result.outstanding++;
        bucket.outstanding++;
      }
    }
  }

  return result;
}
