// src/sections/appeals/appeal-review-plugin.js
// @ts-check
import { h } from '../../lib/html.js';
import { AppealReviewSection } from '../../pages/cora-case-review/appeal-review-view.js';
import { openAppealOf } from '../../evaluators/appeal-state.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';

/** @type {import('../registry.js').SectionPlugin} */
export const AppealReviewPlugin = {
  id: 'appealReview',
  tab: true,
  tabOrder: 8,
  summaryBlock: false,
  summaryOrder: 0,
  showInSummaryDefault: false,
  defaultLabels: {
    tab: 'Appeal Review',
    heading: 'Appeal Review',
  },

  evaluateAccess({ caseRow, roles }) {
    if (!roles.includes('controls')) return 'hidden';
    if (!caseRow?.appeals?.length) return 'hidden';
    if (caseRow.status !== CASE_STATUS.COMPLETED || !openAppealOf(caseRow)) {
      return 'read-only';
    }
    return 'edit';
  },

  view({ snapshot, caseRow, config, actions }) {
    const children = AppealReviewSection({
      caseRow,
      access: snapshot?.access?.appealReview ?? 'edit',
      outcomeOptions: config?.outcomeOptions ?? [],
      heading:
        snapshot?.sectionLabels?.appealReview?.heading ??
        AppealReviewPlugin.defaultLabels.heading,
      onResolve: (resolution) => {
        if (actions?.appeals?.resolve) {
          actions.appeals.resolve({ caseRow, snapshot, resolution });
        }
      },
    });

    return h(
      'div',
      { className: 'cora-appeal-review' },
      ...(Array.isArray(children) ? children : [children])
    );
  },
};
