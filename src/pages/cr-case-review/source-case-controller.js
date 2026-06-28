// @ts-check

/**
 * Owns source case rendering for QA Check cases.
 */
// TODO(simplify-ui): Collapse this controller class into plain action and
// binding functions as the Case Review page moves to function components plus
// reactive() for local-signal UI. Avoid preserving controller classes as a
// second DOM orchestration layer.
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
}
