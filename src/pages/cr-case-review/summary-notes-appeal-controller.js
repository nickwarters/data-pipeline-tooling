// @ts-check

/**
 * Owns property assignment for Summary, Notes, and Appeal tabs.
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function updateSummaryNotesAppeal(context) {
  const { viewModel: vm, nodes } = context;
  const { summary, notes, appeal } = nodes;
  const {
    caseRow,
    catalogue,
    config,
    answersSignal,
    allAnswered,
    currentUser,
    access,
    roles,
    summarySections,
  } = vm;
  if (!summary || !notes || !appeal || !caseRow || !config || !currentUser)
    return;

  const answers = answersSignal.get();
  Object.assign(summary, {
    caseRow,
    catalogue,
    summarySections,
    captureGroups: config.captureGroups ?? [],
  });
  if (/** @type {any} */ (summary)?.update) {
    /** @type {any} */ (summary).update(
      config.computeOutcome,
      answers,
      allAnswered.get()
    );
  }

  Object.assign(notes, {
    notes: caseRow.notes,
    caseJustification: caseRow.caseJustification ?? '',
    saveQueue: vm.saveQueue,
    caseId: caseRow.id,
    access: context.displayMode(access.notes),
  });

  Object.assign(appeal, {
    caseRow,
    saveQueue: vm.saveQueue,
    caseId: caseRow.id,
    access: context.displayMode(access.appeal),
    canResolve: roles.includes('qaReviewer'),
    attributeFailures: config.attributeFailures === true,
    remediationFields: config.remediationFields ?? [],
    computeOutcome: config.computeOutcome,
    client: vm.client,
    currentUser,
    catalogue,
    answers: caseRow.answers,
  });
}

// TODO(simplify-ui): Remove this compatibility wrapper after Case Review tests
// and page code consume updateSummaryNotesAppeal() directly.
export class SummaryNotesAppealController {
  /** @param {import('./types.js').CaseReviewShellContext} context */
  bind(context) {
    void context;
  }

  /** @param {import('./types.js').CaseReviewShellContext} context */
  update(context) {
    updateSummaryNotesAppeal(context);
  }
}
