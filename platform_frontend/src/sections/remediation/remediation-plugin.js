// src/sections/remediation/remediation-plugin.js
// @ts-check
import { CASE_STATUS } from '../../lib/case-statuses.js';
import { RemediationTracking } from '../../pages/cora-case-review/remediation-tracking-view.js';
import {
  remediationAudience,
  remediationTabIsLive,
} from '../../services/section-access.js';
import { remediationResolved } from '../../pages/cora-case-review/answer-actions.js';

/** @type {import('../registry.js').SectionPlugin} */
export const RemediationPlugin = {
  id: 'remediation',
  tab: true,
  tabOrder: 5,
  summaryBlock: true,
  summaryOrder: 4,
  showInSummaryDefault: true,
  defaultLabels: {
    tab: 'Remediation',
    heading: 'Remediation Actions',
  },

  evaluateAccess({ caseRow, roles, catalogue }) {
    const cat = catalogue ?? [];
    if (!remediationTabIsLive(caseRow, cat)) return 'hidden';

    if (roles.includes('assignedReviewer')) {
      return caseRow?.status === CASE_STATUS.ACTIONS_IN_PROGRESS
        ? 'edit'
        : 'read-only';
    }
    const observingRoles = [
      'otherReviewer',
      'reviewerManager',
      'responsibleParty',
      'responsiblePartyManager',
      'caseTypeOwner',
      'journeyOwner',
      'controls',
    ];
    if (roles.some((r) => observingRoles.includes(r))) {
      return 'read-only';
    }
    return 'hidden';
  },

  view({ snapshot, caseRow, config, route, dispatch, actions }) {
    return RemediationTracking({
      catalogue: snapshot?.catalogue ?? [],
      answers: snapshot?.answers ?? {},
      audience: remediationAudience(snapshot?.machine?.roles ?? []),
      canResolve: snapshot?.access?.remediation === 'edit',
      conversationAvailable: snapshot?.access?.conversation !== 'hidden',
      caseRow,
      heading:
        snapshot?.sectionLabels?.remediation?.heading ?? 'Remediation Actions',
      statuses: config?.remediationStatuses,
      dispatchStatus: (questionId, status, details) =>
        actions?.editAnswers?.(
          remediationResolved({
            answers: actions.currentAnswers(),
            questionId,
            status,
            details,
            canResolve: snapshot?.access?.remediation === 'edit',
          })
        ),
      dispatchOpenConversation: () => {
        if (route?.conversationHidden) {
          dispatch?.({ type: 'case/conversation-toggled' });
        }
      },
    });
  },
};
