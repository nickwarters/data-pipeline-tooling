// src/sections/root-cause/root-cause-plugin.js
// @ts-check
import {
  isReportable,
  rootCauseTabIsLive,
} from '../../evaluators/case-lifecycle.js';
import { rootCauseCaptured } from '../../pages/cora-case-review/answer-actions.js';
import { RootCauseSection } from '../../pages/cora-case-review/root-cause-view.js';
import { rootCauseSummaryView } from '../../pages/cora-case-review/root-cause-summary-view.js';

/**
 * The reviewer-side Roles, who read the Root Cause but never write it. The
 * Responsible Party is deliberately absent: what their manager records about
 * the cause of an Issue is not theirs to read.
 *
 * @type {import('../../services/section-access.js').Role[]}
 */
const READING_ROLES = [
  'assignedReviewer',
  'otherReviewer',
  'reviewerManager',
  'caseTypeOwner',
  'journeyOwner',
  'controls',
];

/**
 * The frontline twin of the Issues Section: the Responsible Party Manager
 * records, per Issue, the Root Cause Fields the Case Type declares.
 *
 * The Section switches itself off for a Case Type that declares no
 * `rootCauseGroups`, rather than relying on the `sections` allow-list alone,
 * so the tab cannot appear with nothing in it.
 *
 * Collapse state is this Section's own slice of `route.sections`, so a group
 * key it shares with an Issue Capture Group never toggles the Issues tab.
 *
 * @satisfies {import('../contract.js').SectionPlugin}
 */
export const RootCausePlugin = /** @type {const} */ ({
  id: 'rootCause',
  tab: true,
  tabOrder: 5.5,
  summaryBlock: true,
  summaryOrder: 4.5,
  showInSummaryDefault: true,
  defaultLabels: { tab: 'Root Cause', heading: 'Root Cause' },

  evaluateAccess({ caseRow, roles, catalogue, config }) {
    if (!config?.rootCauseGroups?.length) return 'hidden';
    if (!rootCauseTabIsLive(caseRow, catalogue ?? [])) return 'hidden';

    if (roles.includes('responsiblePartyManager')) {
      return isReportable(caseRow.status) ? 'edit' : 'read-only';
    }
    if (roles.some((role) => READING_ROLES.includes(role))) {
      return 'read-only';
    }
    return 'hidden';
  },

  /**
   * @param {{ collapsed?: Record<string, Map<string, boolean>> } | undefined} sectionState
   * @param {any} action
   */
  reduce(sectionState, action) {
    if (action.type !== 'root-cause/group-toggled') return sectionState;
    const collapsed = sectionState?.collapsed ?? {};
    const forQuestion = new Map(collapsed[action.questionId]);
    forQuestion.set(action.groupKey, action.collapsed);
    return {
      ...sectionState,
      collapsed: { ...collapsed, [action.questionId]: forQuestion },
    };
  },

  summaryView: rootCauseSummaryView,

  view({ snapshot, config, dispatch, actions, sectionState }) {
    const canEdit = snapshot?.access?.rootCause === 'edit';
    const groups = config?.rootCauseGroups ?? [];
    return RootCauseSection({
      heading: snapshot?.sectionLabels?.rootCause?.heading ?? 'Root Cause',
      catalogue: snapshot?.catalogue ?? [],
      answers: snapshot?.answers ?? {},
      groups,
      collapsed: sectionState?.collapsed ?? {},
      canEdit,
      dispatchCapture: (questionId, fieldKey, value) =>
        actions?.editAnswers?.(
          rootCauseCaptured({
            answers: actions.currentAnswers(),
            rootCauseGroups: groups,
            questionId,
            fieldKey,
            value,
            canEditRootCause: canEdit,
          })
        ),
      dispatchToggle: (questionId, groupKey, collapsed) =>
        dispatch?.({
          type: 'root-cause/group-toggled',
          section: 'rootCause',
          questionId,
          groupKey,
          collapsed,
        }),
    });
  },
});
