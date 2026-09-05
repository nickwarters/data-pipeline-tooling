// src/sections/summary/summary-plugin.js
// @ts-check
import { h } from '../../lib/html.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';
import { reachedReportable } from '../../services/section-access.js';
import { summaryView } from '../../pages/cora-case-review/summary-view.js';
import { resolveGeneralQuestionsPlacement } from '../../evaluators/general-questions.js';
import { remediationAudience } from '../../services/section-access.js';
import {
  completionControl,
  completionControlView,
} from '../../pages/cora-case-review/completion-actions.js';

/** @type {import('../registry.js').SectionPlugin} */
export const SummaryPlugin = {
  id: 'summary',
  tab: true,
  tabOrder: 4,
  summaryBlock: false,
  summaryOrder: 0,
  showInSummaryDefault: true,
  defaultLabels: {
    tab: 'Summary',
    heading: 'Case Summary',
  },

  evaluateAccess({ caseRow, roles }) {
    const reviewerSide = [
      'assignedReviewer',
      'otherReviewer',
      'reviewerManager',
      'caseTypeOwner',
      'controls',
      'journeyOwner',
    ];
    if (roles.some((role) => reviewerSide.includes(role))) {
      return 'read-only';
    }
    if (roles.includes('responsibleParty') && reachedReportable(caseRow)) {
      return 'read-only';
    }
    if (
      roles.includes('responsiblePartyManager') &&
      caseRow?.status === CASE_STATUS.COMPLETED
    ) {
      return 'read-only';
    }
    return 'hidden';
  },

  view({ snapshot, caseRow, config, route, actions }) {
    const control = completionControl({
      machine: snapshot?.machine,
      caseRow,
      catalogue: snapshot?.catalogue ?? [],
      answers: snapshot?.answers ?? {},
      allAnswered: snapshot?.allAnswered ?? false,
      captureGroups: config?.captureGroups ?? [],
      generalQuestions: config?.generalQuestions ?? [],
    });
    const summary = h(
      'div',
      { className: 'cora-summary' },
      summaryView({
        computeOutcome: config?.computeOutcome,
        answers: snapshot?.answers ?? {},
        allAnswered: snapshot?.allAnswered ?? false,
        caseRow,
        catalogue: snapshot?.catalogue ?? [],
        summarySections: snapshot?.summarySections ?? [],
        captureGroups: config?.captureGroups ?? [],
        detailFields: config?.detailFields ?? [],
        outcomeOptions: config?.outcomeOptions ?? [],
        sectionLabels: snapshot?.sectionLabels,
        generalQuestions: config?.generalQuestions ?? [],
        generalQuestionsPlacement: resolveGeneralQuestionsPlacement(config),
        audience: remediationAudience(snapshot?.machine?.roles ?? []),
      })
    );
    const completion = completionControlView({
      control,
      pending: route?.completionPending ?? false,
      onComplete: actions?.onComplete,
    });
    return completion ? [summary, completion] : [summary];
  },
};
