// @ts-check
import { reasonsForCapabilities } from '../../services/action-centre-model.js';

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

/** @param {import('../../services/permissions.js').Capabilities} capabilities */
export function visibleDashboardPanels(capabilities) {
  return dashboardPanels
    .filter((descriptor) => descriptor.visible(capabilities))
    .map((descriptor) => descriptor.key);
}
