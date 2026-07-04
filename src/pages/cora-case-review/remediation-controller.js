// @ts-check

/**
 * Owns Issues-tab event forwarding.
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function bindRemediationPanel(context) {
  const { viewModel: vm, nodes } = context;
  const remediation = nodes.issues;
  if (!remediation) return;

  remediation.addEventListener('cora-capture', (ev) => {
    const event = /** @type {CustomEvent} */ (ev);
    vm.handleCapture(
      /** @type {any} */ (event).detail.questionId,
      /** @type {any} */ (event).detail.fieldKey,
      /** @type {any} */ (event).detail.value
    );
  });
  remediation.addEventListener('cora-attribute', (ev) => {
    const event = /** @type {CustomEvent} */ (ev);
    vm.handleAttribute(
      /** @type {any} */ (event).detail.questionId,
      /** @type {any} */ (event).detail.attributedParty
    );
  });
  remediation.addEventListener('cora-remediation-action', (ev) => {
    const event = /** @type {CustomEvent} */ (ev);
    vm.handleRemediationAction(
      /** @type {any} */ (event).detail.questionId,
      /** @type {any} */ (event).detail.action,
      /** @type {any} */ (event).detail.selected
    );
  });
  remediation.addEventListener('cora-remediation-freeform', (ev) => {
    const event = /** @type {CustomEvent} */ (ev);
    vm.handleRemediationFreeForm(
      /** @type {any} */ (event).detail.questionId,
      /** @type {any} */ (event).detail.value
    );
  });
}

/**
 * Owns Issues-tab property assignment.
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function updateRemediationPanel(context) {
  const { viewModel: vm, nodes } = context;
  const remediation = nodes.issues;
  const { caseRow, catalogue, config, answersSignal, machine } = vm;
  if (!remediation || !caseRow || !config || !machine) return;

  const answers = answersSignal.get();
  const attributeFailures = config.attributeFailures === true;
  Object.assign(remediation, {
    client: vm.client,
    canAttribute: machine.canAttribute,
    responsibleParty: caseRow.responsibleParty
      ? {
          loginName: caseRow.responsibleParty,
          displayName: caseRow.responsibleParty,
        }
      : null,
    captureGroups: config.captureGroups ?? [],
    canCapture: machine.canCapture,
    canSelectRemediation: machine.canSelectRemediation,
    catalogue,
    answers,
    attributeFailures,
  });
  if (/** @type {any} */ (remediation).update) {
    /** @type {any} */ (remediation).update(
      catalogue,
      answers,
      attributeFailures
    );
  }
}
