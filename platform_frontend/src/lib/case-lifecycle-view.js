// @ts-check
/**
 * Compose what the Case Review page reads about a loaded Case.
 *
 * What a viewer may do to it, resolved from the Section access map once so the
 * loader and its tests cannot derive it differently. The transitions that
 * actually move a Case are pure builders in `evaluators/case-transitions.js`
 * and are called where the write happens, not carried around on this.
 *
 * @typedef {import('../sharepoint-client.js').CaseRow} CaseRow
 * @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig
 * @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition
 * @typedef {import('../services/permissions.js').Capabilities} Capabilities
 */

import { evaluateSectionsAccess } from '../sections/registry.js';
import { resolveRoles } from '../services/section-access.js';
import {
  canCompleteCase,
  canEditIssues,
  canToggleConversation,
  canVoidCase,
  mayResolveRemediation,
} from '../evaluators/case-lifecycle.js';
/**
 * @param {{
 *   caseRow: CaseRow,
 *   currentUserId: string,
 *   capabilities: Capabilities,
 *   config: CaseTypeConfig,
 *   catalogue?: QuestionDefinition[],
 * }} input
 * @returns {{
 *   roles: import('../services/section-access.js').Role[],
 *   access: Record<string, import('../services/section-access.js').Mode>,
 *   machine: import('../evaluators/case-lifecycle.js').CaseLifecycleView,
 * }}
 */
export function createCaseLifecycleView({
  caseRow,
  currentUserId,
  capabilities,
  config,
  catalogue = [],
}) {
  const roles = resolveRoles(caseRow, currentUserId, capabilities);
  const access = evaluateSectionsAccess({
    caseRow,
    roles,
    capabilities,
    config,
    catalogue,
  });

  return {
    roles,
    access,
    machine: {
      roles,
      canComplete: canCompleteCase({ access, caseRow, currentUserId }),
      canEditIssues: canEditIssues({ access, caseRow }),
      mayResolveRemediation: mayResolveRemediation({
        access,
        caseRow,
        currentUserId,
      }),
      canVoid: canVoidCase({ caseRow, currentUserId }),
      canToggleConversation: canToggleConversation({ access }),
    },
  };
}
