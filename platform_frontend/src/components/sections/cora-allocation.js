// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';
import {
  countCasesAcrossSources,
  listCasesPerSource,
} from '../../services/across-sources.js';

export const MAX_IN_PROGRESS_CASES = 3;

/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').CaseListOptions} CaseListOptions */
/** @typedef {import('../../setup/resolve-eligible-case-types.js').AllocationSource} AllocationSource */

/**
 * An unallocated Case picked up from one allocation source, tagged with the
 * `CaseListOptions` (namely `listName`) of the list it came from — so the
 * later `patchCase` write lands on the same list the row was read from.
 *
 * @typedef {CaseRow & { _listOptions: CaseListOptions }} AllocationCandidate
 */

/**
 * @param {{ isEmpty: boolean, isAtCapacity?: boolean, onRequestNextCase: () => void }} props
 * @returns {HTMLElement}
 */
export function Allocation({ isEmpty, isAtCapacity, onRequestNextCase }) {
  if (isAtCapacity) {
    return EmptyState('Maximum active Cases reached', {
      className: 'cora-allocation-empty',
    });
  }
  if (isEmpty) {
    return EmptyState('No Cases available', {
      className: 'cora-allocation-empty',
    });
  }
  return h(
    'button',
    {
      className: 'cora-allocation-btn',
      onclick: onRequestNextCase,
    },
    'Request next Case'
  );
}

/**
 * The age a candidate is allocated by: its Case Type–specific `relatedDate`,
 * falling back to `created` when the Case carries no related date. `RelatedDate`
 * is optional on every Case list, so a Case Type that never populates it — or a
 * single row that is missing one — keeps a real age and is neither handed out
 * ahead of every dated Case nor starved behind them. Empty string counts as
 * absent alongside `null`/`undefined`, because SharePoint reads a blank date
 * back either way.
 *
 * @param {AllocationCandidate} candidate
 * @returns {string}
 */
function allocationAge(candidate) {
  return candidate.relatedDate || candidate.created || '';
}

/**
 * Sorts allocation candidates ascending by `allocationAge` — oldest related
 * date first — so an undated candidate sorts by when it was created and a
 * candidate with neither sorts first. Candidates whose age is EXACTLY equal are
 * ordered by a per-candidate draw from `random` — a fresh draw per candidate,
 * taken once up front, so the tie-break is stable within a single call and
 * swappable in tests by stubbing `random` (e.g. a queue of canned return
 * values) to force either tied candidate to win.
 *
 * @param {AllocationCandidate[]} candidates
 * @param {() => number} [random]
 * @returns {AllocationCandidate[]}
 */
export function orderCandidatesByAge(candidates, random = Math.random) {
  return candidates
    .map((c) => ({ c, tieBreak: random() }))
    .sort((a, b) => {
      const av = allocationAge(a.c);
      const bv = allocationAge(b.c);
      if (av < bv) return -1;
      if (av > bv) return 1;
      return a.tieBreak - b.tieBreak;
    })
    .map(({ c }) => c);
}

/**
 * The Cases waiting to be claimed, oldest first.
 *
 * The status is the whole predicate: a Case waiting for a Reviewer sits in
 * `To-allocate` and leaves it at the claim, so this asks the list for exactly
 * the rows it wants. The alternative — reading every `In-progress` row and
 * discarding the ones that already have a Reviewer — pulls a Case Type's whole
 * live workload into the browser to find the handful nobody has taken, and the
 * high-volume Case Types are precisely the ones where that read is largest and
 * the List View Threshold least forgiving. `Status` is an indexed column.
 *
 * @param {{
 * client: SharePointClient | null,
 * allocationSources: AllocationSource[],
 * random?: () => number
 * }} props
 * @returns {Promise<AllocationCandidate[]>}
 */
export async function getUnallocatedCases({
  client,
  allocationSources,
  random,
}) {
  if (!client) return [];

  const perSource = await listCasesPerSource(client, allocationSources, {
    status: CASE_STATUS.TO_ALLOCATE,
  });
  const candidates = perSource.flatMap(({ source, rows }) =>
    rows.map(
      (c) =>
        /** @type {AllocationCandidate} */ ({
          ...c,
          _listOptions: { listName: source.listName },
        })
    )
  );

  return orderCandidatesByAge(candidates, random);
}

/**
 * Re-checks the current Reviewer's active workload across every allocation
 * source before loading candidates. Held Cases do not consume capacity. Only
 * the exact `In-progress` lifecycle status consumes the app-wide capacity;
 * `Actions In Progress` and every other status are deliberately excluded.
 *
 * @param {{
 * client: SharePointClient | null,
 * allocationSources: AllocationSource[],
 * currentUserId: string,
 * random?: () => number
 * }} props
 * @returns {Promise<{ candidates: AllocationCandidate[], isAtCapacity: boolean }>}
 */
export async function getAllocationAvailability({
  client,
  allocationSources,
  currentUserId,
  random,
}) {
  if (!client) return { candidates: [], isAtCapacity: false };

  const activeCases = await countCasesAcrossSources(client, allocationSources, {
    status: CASE_STATUS.IN_PROGRESS,
    assignedReviewer: currentUserId,
    onHold: false,
  });
  if (activeCases >= MAX_IN_PROGRESS_CASES) {
    return { candidates: [], isAtCapacity: true };
  }
  const candidates = await getUnallocatedCases({
    client,
    allocationSources,
    random,
  });

  return {
    candidates,
    isAtCapacity: false,
  };
}
