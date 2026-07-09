// @ts-check

/**
 * Owns Remediation *tracking* tab event forwarding: a reviewer
 * resolving an action bubbles a `cora-action-status` that the view-model persists.
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function bindRemediationTracking(context) {
  const { viewModel: vm, nodes } = context;
  const tracking = nodes.remediation;
  if (!tracking) return;

  tracking.addEventListener('cora-action-status', (ev) => {
    const detail = /** @type {any} */ (ev).detail;
    vm.handleActionStatus(
      detail.questionId,
      detail.fieldKey,
      detail.actionId,
      detail.status,
      detail.cancelReason
    );
  });
}

/**
 * Owns Remediation *tracking* tab property assignment.
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function updateRemediationTracking(context) {
  const { viewModel: vm, nodes } = context;
  const tracking = nodes.remediation;
  const { caseRow, catalogue, config, answersSignal, machine, access } = vm;
  if (!tracking || !caseRow || !config || !machine) return;

  const answers = answersSignal.get();
  Object.assign(tracking, {
    captureGroups: config.captureGroups ?? [],
    canResolve: access.remediation === 'edit',
  });
  if (/** @type {any} */ (tracking).update) {
    /** @type {any} */ (tracking).update(catalogue, answers);
  }
}
