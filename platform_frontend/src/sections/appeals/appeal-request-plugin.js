// src/sections/appeals/appeal-request-plugin.js
// @ts-check
import { h } from '../../lib/html.js';
import { AppealSection } from '../../pages/cora-case-review/appeal-view.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';

/** A Section names its own default copy; hoisted so the plugin object does
 * not reference itself while its own type is being inferred. */
const APPEAL_REQUEST_LABELS = { tab: 'Appeal', heading: 'Appeal' };

/** @satisfies {import('../contract.js').SectionPlugin} */
export const AppealRequestPlugin = /** @type {const} */ ({
  id: 'appealRequest',
  tab: true,
  tabOrder: 7,
  summaryBlock: false,
  summaryOrder: 0,
  showInSummaryDefault: false,
  defaultLabels: APPEAL_REQUEST_LABELS,

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
        APPEAL_REQUEST_LABELS.heading,
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
});
