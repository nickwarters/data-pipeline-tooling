// @ts-check
import { h } from '../../lib/html.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';
import { isOverdue } from '../../evaluators/overdue-evaluator.js';

/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */

/**
 * @typedef {{
 * caseType: string,
 * outstanding: number,
 * assigned: number,
 * overdue: number,
 * completedToday: number,
 * completedLast7Days: number
 * }} OwnerSummary
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{
 * client: SharePointClient,
 * ownedCaseTypes: string[],
 * allCaseSources?: import('../../setup/resolve-eligible-case-types.js').CaseSource[],
 * now?: Date
 * }} props
 * @returns {Promise<OwnerSummary[]>}
 */
export async function loadOwnerSummaries({
  client,
  ownedCaseTypes,
  allCaseSources = [],
  now,
}) {
  const currentTime = now ?? new Date();
  const todayStart = new Date(
    currentTime.getFullYear(),
    currentTime.getMonth(),
    currentTime.getDate()
  );
  const nowIso = currentTime.toISOString();

  // Per-day slices covering [todayStart − 7 days, now]: slice 0 is today so far,
  // slices 1..7 are the seven prior calendar days. Each slice is one day on the
  // busy Case Type (< List View Threshold), so summing their `$count`s yields the
  // last-7-days total without a single >5000-row window fetch.
  const slices = Array.from({ length: 8 }, (_, k) => ({
    after: new Date(todayStart.getTime() - k * DAY_MS).toISOString(),
    before:
      k === 0
        ? nowIso
        : new Date(todayStart.getTime() - (k - 1) * DAY_MS).toISOString(),
  }));

  // Each owned slug resolves to its own list via `allCaseSources`; an owned
  // slug with no matching source (stale config) is skipped entirely rather
  // than fetched unscoped — there is no default Case list.
  const ownedWithSource = ownedCaseTypes
    .map((caseType) => ({
      caseType,
      source: allCaseSources.find((s) => s.slug === caseType),
    }))
    .filter((entry) => entry.source != null);

  return Promise.all(
    ownedWithSource.map(async ({ caseType, source }) => {
      const listName = /** @type {{ listName: string }} */ (source).listName;
      // In-progress: bounded by open work and led by the indexed Status column,
      // so the outstanding/assigned/overdue derivation never fetches the
      // cumulative backlog.
      const inProgress = await client.listCases(
        { caseType, status: CASE_STATUS.IN_PROGRESS },
        { listName }
      );

      const sliceCounts = await Promise.all(
        slices.map((s) =>
          client.countCases(
            {
              caseType,
              status: CASE_STATUS.COMPLETED,
              completedAfter: s.after,
              completedBefore: s.before,
            },
            { listName }
          )
        )
      );

      return {
        caseType,
        outstanding: inProgress.filter((c) => !c.assignedReviewer).length,
        assigned: inProgress.filter((c) => !!c.assignedReviewer).length,
        overdue: inProgress.filter((c) => isOverdue(c, currentTime)).length,
        completedToday: sliceCounts[0],
        completedLast7Days: sliceCounts.reduce((sum, n) => sum + n, 0),
      };
    })
  );
}

/**
 * @param {{ summaries: OwnerSummary[] }} props
 * @returns {Node[]}
 */
export function OwnerSummary({ summaries }) {
  const h2 = h(
    'h2',
    { className: 'cora-owner-summary-heading' },
    'Case Type Ownership Summary'
  );

  const cards = summaries.map((s) => {
    /** @type {Array<{ label: string, value: number, className: string }>} */
    const stats = [
      {
        label: 'Outstanding',
        value: s.outstanding,
        className: 'cora-owner-outstanding',
      },
      {
        label: 'Assigned',
        value: s.assigned,
        className: 'cora-owner-assigned',
      },
      { label: 'Overdue', value: s.overdue, className: 'cora-owner-overdue' },
      {
        label: 'Completed today',
        value: s.completedToday,
        className: 'cora-owner-completed-today',
      },
      {
        label: 'Completed (last 7 days)',
        value: s.completedLast7Days,
        className: 'cora-owner-completed-7d',
      },
    ];

    return h(
      'div',
      { className: 'cora-owner-card' },
      h('h3', { className: 'cora-owner-card-title' }, s.caseType),
      h(
        'dl',
        { className: 'cora-owner-stats' },
        ...stats.flatMap(({ label, value, className }) => [
          h('dt', {}, label),
          h('dd', { className }, String(value)),
        ])
      )
    );
  });

  return [h2, ...cards];
}
