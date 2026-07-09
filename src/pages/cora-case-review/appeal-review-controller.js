// @ts-check

/**
 * Owns property assignment for the Appeal Review tab. Controls
 * resolves open Appeals here (agree → linked Amended Outcome, reject → rationale
 * only). Access is resolved upstream (section-access); the component only consumes
 * the resolved mode.
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function updateAppealReview(context) {
  const { viewModel: vm, nodes } = context;
  const { appealReview } = nodes;
  const { caseRow, config, currentUser, access } = vm;
  if (!appealReview || !caseRow || !config || !currentUser) return;

  Object.assign(appealReview, {
    caseRow,
    saveQueue: vm.saveQueue,
    caseId: caseRow.id,
    access: context.displayMode(access.appealReview),
    currentUser,
    outcomeOptions: config.outcomeOptions ?? [],
  });
}
