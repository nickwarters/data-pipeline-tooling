// @ts-check

/**
 * Owns property assignment for the Amend Outcome tab. Controls authors
 * the case-level Amended Outcome here; the Section renders read-only for the other
 * observing roles. Access is resolved upstream (section-access); the component
 * only consumes the resolved mode.
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function updateAmendOutcome(context) {
  const { viewModel: vm, nodes } = context;
  const { amendOutcome } = nodes;
  const { caseRow, config, currentUser, access } = vm;
  if (!amendOutcome || !caseRow || !config || !currentUser) return;

  Object.assign(amendOutcome, {
    caseRow,
    saveQueue: vm.saveQueue,
    caseId: caseRow.id,
    access: context.displayMode(access.amendOutcome),
    currentUser,
    outcomeOptions: config.outcomeOptions ?? [],
  });
}
