// src/sections/appeals/appeal-request-plugin.js
// @ts-check
import { h } from '../../lib/html.js';
import { AppealSection } from '../../pages/cora-case-review/appeal-view.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';

/** @type {import('../registry.js').SectionPlugin} */
export const AppealRequestPlugin = {
  id: 'appealRequest',
  tab: true,
  tabOrder: 7,
  summaryBlock: false,
  summaryOrder: 0,
  showInSummaryDefault: false,
  defaultLabels: { tab: 'Appeal', heading: 'Request Appeal' },

  evaluateAccess({ roles, caseRow, config }) {
    if (!caseRow || caseRow.status !== CASE_STATUS.COMPLETED) return 'hidden';
    const raiser = config?.appeal?.raisedBy ?? 'responsiblePartyManager';
    if (roles.includes(raiser)) return 'edit';
    return 'hidden';
  },

  view({ snapshot, caseRow, actions }) {
    const children = AppealSection({
      caseRow,
      access: snapshot?.access?.appealRequest ?? 'edit',
      catalogue: snapshot?.catalogue ?? [],
      answers: snapshot?.answers ?? {},
      heading:
        snapshot?.sectionLabels?.appealRequest?.heading ??
        AppealRequestPlugin.defaultLabels.heading,
      onRaise: (input) => {
        if (actions?.appeals?.raise) {
          actions.appeals.raise({
            caseRow,
            snapshot,
            rationale: input.rationale,
            citedAnswerKeys: input.citedAnswerKeys,
          });
        }
      },
    });

    return h(
      'div',
      { className: 'cora-appeal' },
      ...(Array.isArray(children) ? children : [children])
    );
  },
};
