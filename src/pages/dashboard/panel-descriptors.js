// @ts-check
import { reasonsForCapabilities } from '../../services/action-centre-model.js';
import { loadCaseTypeConfig } from '../../../case-types/manifest.js';

/**
 * The dashboard has a fixed, intentionally small panel vocabulary. Role
 * variation is data here; panel views do not repeat permission branches.
 *
 * @type {Array<{
 *   key: 'kpis'|'actionCentre'|'ownerSummary'|'reviewerCases'|'allocation'|'responsibleParty'|'appeals',
 *   visible: (capabilities: import('../../services/permissions.js').Capabilities) => boolean,
 * }>}
 */
export const dashboardPanels = [
  {
    key: 'kpis',
    visible: (c) => c.isReviewer || c.isControls || c.ownedCaseTypes.length > 0,
  },
  {
    key: 'actionCentre',
    visible: (c) => reasonsForCapabilities(c).length > 0,
  },
  { key: 'ownerSummary', visible: (c) => c.ownedCaseTypes.length > 0 },
  { key: 'reviewerCases', visible: (c) => c.isReviewer },
  { key: 'allocation', visible: (c) => c.isReviewer },
  { key: 'responsibleParty', visible: (c) => c.isAdviser },
  { key: 'appeals', visible: (c) => c.isControls },
];

/**
 * Resolve the canonical union of panels declared by the Case Types available
 * in this dashboard. A Case Type without the additive field retains the legacy
 * all-panels behaviour.
 *
 * @param {Array<{ slug: string }>} caseSources
 * @param {(slug: string) => Promise<import('../../sharepoint-client.js').CaseTypeConfig>} [load]
 * @returns {Promise<import('../../sharepoint-client.js').DashboardPanelKey[]>}
 */
export async function resolveDashboardPanels(
  caseSources,
  load = loadCaseTypeConfig
) {
  const configs = await Promise.all(
    caseSources.map((source) => load(source.slug))
  );
  const legacyAllPanels = configs.some(
    (config) => config.dashboardPanels === undefined
  );
  const present = new Set(
    legacyAllPanels
      ? dashboardPanels.map((descriptor) => descriptor.key)
      : configs.flatMap((config) => config.dashboardPanels ?? [])
  );
  return dashboardPanels
    .map((descriptor) => descriptor.key)
    .filter((key) => present.has(key));
}

/**
 * @param {import('../../services/permissions.js').Capabilities} capabilities
 * @param {import('../../sharepoint-client.js').DashboardPanelKey[]} [presentPanels]
 */
export function visibleDashboardPanels(
  capabilities,
  presentPanels = dashboardPanels.map((descriptor) => descriptor.key)
) {
  return dashboardPanels
    .filter(
      (descriptor) =>
        presentPanels.includes(descriptor.key) &&
        descriptor.visible(capabilities)
    )
    .map((descriptor) => descriptor.key);
}
