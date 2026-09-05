// src/sections/issues/issues-plugin.js
// @ts-check
import { RemediationSection } from '../../pages/cora-case-review/remediation-view.js';
import { isFrozen } from '../../services/section-access.js';
import {
  remediationActionToggled,
  remediationFreeFormEdited,
  remediationRequiredSet,
} from '../../pages/cora-case-review/answer-actions.js';

/** @type {import('../registry.js').SectionPlugin} */
export const IssuesPlugin = {
  id: 'issues',
  tab: true,
  tabOrder: 3,
  summaryBlock: true,
  summaryOrder: 3,
  showInSummaryDefault: true,
  defaultLabels: { tab: 'Issues', heading: 'Issues & Remediation Required' },

  evaluateAccess({ caseRow, roles }) {
    if (roles.includes('assignedReviewer')) {
      return caseRow?.status && isFrozen(caseRow.status) ? 'read-only' : 'edit';
    }
    const readOnlyRoles = [
      'otherReviewer',
      'reviewerManager',
      'caseTypeOwner',
      'journeyOwner',
      'controls',
    ];
    if (roles.some((role) => readOnlyRoles.includes(role))) {
      return 'read-only';
    }
    return 'hidden';
  },

  view({ snapshot, caseRow, config, route, dispatch, actions }) {
    const canEditIssues = snapshot?.machine?.canEditIssues ?? false;
    return RemediationSection({
      heading:
        snapshot?.sectionLabels?.issues?.heading ??
        'Issues & Remediation Required',
      catalogue: snapshot?.catalogue ?? [],
      answers: snapshot?.answers ?? {},
      responsibleParty: caseRow?.responsibleParty
        ? {
            loginName: caseRow.responsibleParty,
            displayName:
              caseRow.responsiblePartyDisplayName || caseRow.responsibleParty,
          }
        : null,
      captureGroups: config?.captureGroups ?? [],
      captureCollapsed: route?.captureCollapsed ?? {},
      captureSearch: route?.captureSearch ?? {},
      responsiblePartySearch: route?.responsiblePartySearch ?? {
        query: '',
        people: [],
        status: 'idle',
      },
      canEditIssues,
      dispatchResponsibleParty: actions?.selectResponsibleParty,
      dispatchResponsiblePartySearch: actions?.requestResponsiblePartySearch,
      dispatchCapture: actions?.captureEdited,
      dispatchCaptureSearch: actions?.requestCaptureSearch,
      dispatchCaptureToggle: (questionId, groupKey, collapsed) =>
        dispatch?.({
          type: 'case/capture-group-toggled',
          questionId,
          groupKey,
          collapsed,
        }),
      dispatchRemediationAction: (questionId, action, selected) =>
        actions?.editAnswers?.(
          remediationActionToggled({
            answers: actions.currentAnswers(),
            questionId,
            action,
            selected,
            canEditIssues,
          })
        ),
      dispatchRemediationFreeForm: (questionId, value) =>
        actions?.editAnswers?.(
          remediationFreeFormEdited({
            answers: actions.currentAnswers(),
            questionId,
            value,
            canEditIssues,
          })
        ),
      dispatchRemediationRequired: (questionId, required) =>
        actions?.editAnswers?.(
          remediationRequiredSet({
            answers: actions.currentAnswers(),
            questionId,
            required,
            canEditIssues,
          })
        ),
    });
  },
};
