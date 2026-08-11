// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';
import { listCasesPerSource } from '../../services/across-sources.js';

/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').CaseListOptions} CaseListOptions */
/** @typedef {import('../../setup/resolve-eligible-case-types.js').AllocationSource} AllocationSource */

/**
 * An unassigned Case picked up from one allocation source, tagged with the
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
 * Sorts allocation candidates ascending by `created` (matching the previous
 * string-comparator semantics: `created ?? ''`, so missing/null `created`
 * sorts first). Candidates whose `created` is EXACTLY equal are ordered by a
 * per-candidate draw from `random` — a fresh draw per candidate, taken once
 * up front, so the tie-break is stable within a single call and swappable in
 * tests by stubbing `random` (e.g. a queue of canned return values) to force
 * either tied candidate to win.
 *
 * @param {AllocationCandidate[]} candidates
 * @param {() => number} [random]
 * @returns {AllocationCandidate[]}
 */
export function orderCandidatesByAge(candidates, random = Math.random) {
  return candidates
    .map((c) => ({ c, tieBreak: random() }))
    .sort((a, b) => {
      const av = a.c.created ?? '';
      const bv = b.c.created ?? '';
      if (av < bv) return -1;
      if (av > bv) return 1;
      return a.tieBreak - b.tieBreak;
    })
    .map(({ c }) => c);
}

/**
 * @param {{
 * client: SharePointClient | null,
 * allocationSources: AllocationSource[],
 * random?: () => number
 * }} props
 * @returns {Promise<AllocationCandidate[]>}
 */
export async function getUnassignedCases({
  client,
  allocationSources,
  random,
}) {
  if (!client) return [];

  const perSource = await listCasesPerSource(client, allocationSources, {
    status: CASE_STATUS.IN_PROGRESS,
  });
  const candidates = perSource.flatMap(({ source, rows }) =>
    rows
      .filter((c) => c.assignedReviewer === '')
      .map(
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
 * Re-checks the current Reviewer's active workload per limited Case Type before
 * loading allocation candidates. Held Cases do not consume capacity. A source
 * without `maxInProgressCases` remains unlimited and needs no count query.
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

  const capacity = await Promise.all(
    allocationSources.map(async (source) => {
      if (source.maxInProgressCases === undefined) {
        return { source, isAtCapacity: false };
      }
      const activeCases = await client.countCases(
        {
          status: CASE_STATUS.IN_PROGRESS,
          assignedReviewer: currentUserId,
          onHold: false,
        },
        { listName: source.listName }
      );
      return {
        source,
        isAtCapacity: activeCases >= source.maxInProgressCases,
      };
    })
  );
  const availableSources = capacity
    .filter(({ isAtCapacity }) => !isAtCapacity)
    .map(({ source }) => source);
  const anySourceAtCapacity = capacity.some(({ isAtCapacity }) => isAtCapacity);
  if (availableSources.length === 0) {
    return { candidates: [], isAtCapacity: anySourceAtCapacity };
  }
  const candidates = await getUnassignedCases({
    client,
    allocationSources: availableSources,
    random,
  });

  return {
    candidates,
    isAtCapacity: candidates.length === 0 && anySourceAtCapacity,
  };
}
