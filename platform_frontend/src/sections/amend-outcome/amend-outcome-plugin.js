// src/sections/amend-outcome/amend-outcome-plugin.js
// @ts-check
import { h } from '../../lib/html.js';
import { AmendOutcomeSection } from '../../pages/cora-case-review/amend-outcome-view.js';
import { amendmentReasonsFor } from '../../lib/amendment-reasons.js';
import { isReportable } from '../../evaluators/case-lifecycle.js';

/** A Section names its own default copy; hoisted so the plugin object does
 * not reference itself while its own type is being inferred. */
const AMEND_OUTCOME_LABELS = { tab: 'Amend Outcome', heading: 'Amend Outcome' };

/** @satisfies {import('../contract.js').SectionPlugin} */
export const AmendOutcomePlugin = /** @type {const} */ ({
  id: 'amendOutcome',
  tab: true,
  tabOrder: 9,
  summaryBlock: false,
  summaryOrder: 0,
  showInSummaryDefault: false,
  defaultLabels: AMEND_OUTCOME_LABELS,

  evaluateAccess({ caseRow, roles }) {
    if (!roles.includes('controls')) return 'hidden';
    if (caseRow && !isReportable(caseRow.status)) return 'hidden';
    return 'edit';
  },

  view({ snapshot, caseRow, config, route, dispatch, actions }) {
    const children = AmendOutcomeSection({
      caseRow,
      access: snapshot?.access?.amendOutcome ?? 'edit',
      outcomeOptions: config?.outcomeOptions ?? [],
      heading:
        snapshot?.sectionLabels?.amendOutcome?.heading ??
        AMEND_OUTCOME_LABELS.heading,
      reasons: amendmentReasonsFor(config ?? {}),
      onAmend: (input) => {
        if (actions?.appeals?.amend) {
          actions.appeals.amend({
            caseRow,
            snapshot,
            outcome: input.outcome,
            reason: input.reason,
            justification: input.justification,
          });
        }
      },
    });

    return h(
      'div',
      { className: 'cora-amend-outcome' },
      ...(Array.isArray(children) ? children : [children])
    );
  },
});
