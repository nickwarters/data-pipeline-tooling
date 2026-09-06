// @ts-check
/**
 * Compose what the Case Review page reads about a loaded Case.
 *
 * Two halves that used to be one object. The permissions come from the resolved
 * Section access map — a question about how the page renders — and the
 * transitions come from the lifecycle model, which is a domain fact about the
 * Case and now knows nothing about Sections. This is the one place they meet,
 * so nothing downstream has to know which half a member came from and the
 * loader and its tests cannot compose them differently.
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
import { CaseMachine } from './case-machine.js';

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

  // The resolved catalogue — live bank while In-progress, the stamped versioned
  // export once reportable, `failureValues` derived either way — is what decides
  // whether this Case carries remediation, so the lifecycle model gets the same
  // one the tabs render from.
  // No clock seam here on purpose: nothing composing a whole view has ever
  // needed one, and a caller that wants to pin a transition's timestamps builds
  // the lifecycle model directly, which is where the seam is.
  const lifecycle = new CaseMachine(caseRow, { id: currentUserId }, config, {
    catalogue,
  });

  return {
    roles,
    access,
    machine: {
      roles,
      catalogue,
      canComplete: canCompleteCase({ access, caseRow, currentUserId }),
      canEditIssues: canEditIssues({ access, caseRow }),
      mayResolveRemediation: mayResolveRemediation({
        access,
        caseRow,
        currentUserId,
      }),
      canVoid: canVoidCase({ caseRow, currentUserId }),
      canToggleConversation: canToggleConversation({ access }),
      transitionToActionsInProgress:
        lifecycle.transitionToActionsInProgress.bind(lifecycle),
      transitionToCompleted: lifecycle.transitionToCompleted.bind(lifecycle),
      transitionToFinalComplete:
        lifecycle.transitionToFinalComplete.bind(lifecycle),
      transitionToVoid: lifecycle.transitionToVoid.bind(lifecycle),
    },
  };
}
