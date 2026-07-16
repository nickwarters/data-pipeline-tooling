// @ts-check
import { signal } from '../lib/signal.js';
import { reactive } from '../lib/view.js';
import { h } from '../lib/html.js';
import { trackAsyncTasks } from '../lib/async-tasks.js';
import { caseRouteFor, conversationRouteFor } from '../lib/case-route-links.js';
import '../components/collections/cora-case-table.js';
import '../components/sections/cora-allocation.js';
import '../components/sections/cora-owner-summary.js';
import '../components/sections/cora-kpi-strip.js';
// Accepted cross-page static import (#384 phase 4/5 allowlist entry):
// cora-responsible-party-dashboard.js remains a routed page (my-cases).
import { ResponsiblePartyDashboard } from './cora-responsible-party-dashboard.js';
import { ControlsDashboard } from '../components/collections/cora-controls-dashboard.js';
import { ActionCentre } from '../components/collections/cora-action-centre.js';
import { reasonsForCapabilities } from '../services/action-centre-model.js';
import { isOverdue } from '../evaluators/overdue-evaluator.js';
import { CASE_STATUS } from '../lib/case-statuses.js';
import { listCasesAcrossSources } from '../services/across-sources.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../setup/resolve-eligible-case-types.js').AllocationSource} AllocationSource */
/** @typedef {import('../setup/resolve-eligible-case-types.js').CaseSource} CaseSource */

/**
 * Reviewer/owner/adviser landing dashboard. Self-fetches the current
 * reviewer's outstanding cases when `capabilities.isReviewer` is set.
 *
 * `caseSources` is the permission-derived list of Case sources (each carrying
 * an explicit `listName`); every list read fans out over it and merges, so no
 * fetch relies on a hidden default list. `allCaseSources` (every list this
 * user's roles authorize them to span) is
 * threaded to the cross-type child sections (Controls, RP, Action Centre).
 *
 * @param {{
 * client: SharePointClient | null,
 * currentUserId: string,
 * capabilities: Capabilities,
 * caseSources?: CaseSource[],
 * allCaseSources?: CaseSource[],
 * allocationSources?: AllocationSource[],
 * }} props
 * @returns {HTMLElement}
 */
export function DashboardPage({
  client,
  currentUserId,
  capabilities,
  caseSources = [],
  allCaseSources = [],
  allocationSources = [],
}) {
  /** @type {<T>(task: Promise<T>) => Promise<T>} */
  let track = (task) => task;
  /** @type {import('../lib/signal.js').Signal<CaseRow[]>} */
  const cases = signal(/** @type {CaseRow[]} */ ([]));

  async function fetchData() {
    if (!client) return;
    if (capabilities.isReviewer) {
      // Fan out the outstanding-cases read across every accessible list and
      // merge: a reviewer's assigned Cases can live in any list they hold.
      const raw = await listCasesAcrossSources(client, caseSources, {
        status: CASE_STATUS.IN_PROGRESS,
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
      caseSources,
      allCaseSources,
      allocationSources,
      cases: cases.get(),
      onAllocated: () => {
        track(fetchData());
      },
    })
  );
  track = trackAsyncTasks(host);
  track(fetchData());
  return host;
}

/**
 * @param {{
 * client: SharePointClient | null,
 * currentUserId: string,
 * capabilities: Capabilities,
 * caseSources: CaseSource[],
 * allCaseSources: CaseSource[],
 * allocationSources: AllocationSource[],
 * cases: CaseRow[],
 * onAllocated: () => void,
 * }} args
 * @returns {Node[]}
 */
function renderDashboard({
  client,
  currentUserId,
  capabilities,
  caseSources,
  allCaseSources,
  allocationSources,
  cases,
  onAllocated,
}) {
  const children = [];

  // Role-scoped KPI strip: a one-glance summary of what needs the
  // user, in each role they hold. Sits above the per-role sections below.
  if (
    capabilities.isReviewer ||
    capabilities.isControls ||
    capabilities.ownedCaseTypes.length > 0
  ) {
    children.push(
      h('cora-kpi-strip', {
        client,
        currentUserId,
        capabilities,
        caseSources,
        allCaseSources,
      })
    );
  }

  // The unified worklist: the per-role reason tables merged into
  // one reason-grouped, count-driven list. Rendered above the legacy sections
  // for anyone who holds a worklist reason (Reviewer / Controls / Owner).
  if (reasonsForCapabilities(capabilities).length > 0) {
    children.push(
      ActionCentre({
        client,
        capabilities,
        currentUserId,
        allCaseSources,
        onOpenCase: (caseRow) => {
          location.hash = caseRouteFor(caseRow);
        },
      })
    );
  }

  if (capabilities.ownedCaseTypes.length > 0) {
    children.push(
      h('cora-owner-summary', {
        client,
        ownedCaseTypes: capabilities.ownedCaseTypes,
        allCaseSources,
      })
    );
  }

  if (capabilities.isReviewer) {
    children.push(h('h1', {}, 'Outstanding Cases'));

    children.push(
      h('cora-case-table', {
        cases,
        'oncora-case-open': (/** @type {any} */ e) => {
          location.hash = caseRouteFor(e.detail.caseRow);
        },
      })
    );

    children.push(
      h('cora-allocation', {
        client,
        currentUserId,
        allocationSources,
        'oncora-allocated': () => onAllocated(),
      })
    );
  }

  if (capabilities.isAdviser) {
    children.push(
      ResponsiblePartyDashboard({
        client,
        currentUserId,
        allCaseSources,
        onOpenConversation: (caseRow) => {
          location.hash = conversationRouteFor(caseRow);
        },
      })
    );
  }

  if (capabilities.isControls) {
    children.push(
      ControlsDashboard({
        client,
        allCaseSources,
        onOpenCase: (caseRow) => {
          location.hash = caseRouteFor(caseRow);
        },
      })
    );
  }

  return children;
}
