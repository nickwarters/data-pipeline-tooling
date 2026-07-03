// @ts-check
import { signal } from '../lib/signal.js';
import { reactive } from '../lib/view.js';
import { h } from '../lib/html.js';
import { caseRouteFor, conversationRouteFor } from '../lib/case-route-links.js';
import '../components/cr-case-table.js';
import '../components/cr-allocation.js';
import '../components/cr-owner-summary.js';
import { ResponsiblePartyDashboard } from './cr-responsible-party-dashboard.js';
import { isOverdue } from '../evaluators/overdue-evaluator.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

/**
 * Reviewer/owner/adviser landing dashboard. Self-fetches the current
 * reviewer's outstanding cases when `capabilities.isReviewer` is set.
 *
 * @param {{
 *   client: SharePointClient | null,
 *   currentUserId: string,
 *   capabilities: Capabilities,
 *   eligibleCaseTypes: string[],
 * }} props
 * @returns {HTMLElement}
 */
export function DashboardPage({
  client,
  currentUserId,
  capabilities,
  eligibleCaseTypes,
}) {
  /** @type {import('../lib/signal.js').Signal<CaseRow[]>} */
  const cases = signal(/** @type {CaseRow[]} */ ([]));

  async function fetchData() {
    if (!client) return;
    if (capabilities.isReviewer) {
      const raw = await client.listCases({
        status: 'In-progress',
        assignedReviewer: currentUserId,
      });
      cases.set(raw.map((c) => ({ ...c, overdue: isOverdue(c) })));
    }
  }

  const host = reactive(() =>
    renderDashboard({
      client,
      currentUserId,
      capabilities,
      eligibleCaseTypes,
      cases: cases.get(),
      onAllocated: fetchData,
    })
  );
  fetchData();
  return host;
}

/**
 * @param {{
 *   client: SharePointClient | null,
 *   currentUserId: string,
 *   capabilities: Capabilities,
 *   eligibleCaseTypes: string[],
 *   cases: CaseRow[],
 *   onAllocated: () => void,
 * }} args
 * @returns {Node[]}
 */
function renderDashboard({
  client,
  currentUserId,
  capabilities,
  eligibleCaseTypes,
  cases,
  onAllocated,
}) {
  const children = [];

  if (capabilities.isReviewer) {
    children.push(h('h1', {}, 'Outstanding Cases'));

    children.push(
      h('cr-case-table', {
        cases,
        'oncr-case-open': (/** @type {any} */ e) => {
          location.hash = caseRouteFor(e.detail.caseRow);
        },
      })
    );

    children.push(
      h('cr-allocation', {
        client,
        currentUserId,
        eligibleCaseTypes,
        'oncr-allocated': () => onAllocated(),
      })
    );
  }

  if (capabilities.ownedCaseTypes.length > 0) {
    children.push(
      h('cr-owner-summary', {
        client,
        ownedCaseTypes: capabilities.ownedCaseTypes,
      })
    );
  }

  if (capabilities.isAdviser) {
    children.push(
      ResponsiblePartyDashboard({
        client,
        currentUserId,
        onOpenConversation: (caseRow) => {
          location.hash = conversationRouteFor(caseRow);
        },
      })
    );
  }

  return children;
}
