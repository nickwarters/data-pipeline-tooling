// @ts-check

/**
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function updateSourceCase(context) {
  const { viewModel: vm, nodes } = context;
  const sourceCase = vm.sourceCase;
  if (!sourceCase || !nodes.sourceCase) return;

  Object.assign(nodes.sourceCase, {
    originalRow: sourceCase.originalRow,
    catalogue: sourceCase.catalogue,
    computeOutcome: sourceCase.computeOutcome,
    attributeFailures: sourceCase.attributeFailures,
    remediationFields: sourceCase.remediationFields,
    saveQueue: vm.saveQueue,
    currentUser: vm.currentUser,
    client: vm.client,
    overrideAccess: sourceCase.overrideAccess,
    sourceCaseId: sourceCase.sourceCaseId,
  });
}

/**
 * @deprecated Use updateSourceCase().
 */
export class SourceCaseController {
  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
    void context;
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  update(context) {
    updateSourceCase(context);
  }
}
