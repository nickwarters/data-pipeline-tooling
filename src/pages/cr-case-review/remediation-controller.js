// @ts-check

/**
 * Owns Issues-tab event forwarding.
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function bindRemediationPanel(context) {
  const { viewModel: vm, nodes } = context;
  const remediation = nodes.remediation;
  if (!remediation) return;

  remediation.addEventListener('cr-capture', (ev) => {
    const event = /** @type {CustomEvent} */ (ev);
    vm.handleCapture(
      /** @type {any} */ (event).detail.questionId,
      /** @type {any} */ (event).detail.fieldKey,
      /** @type {any} */ (event).detail.value
    );
  });
  remediation.addEventListener('cr-attribute', (ev) => {
    const event = /** @type {CustomEvent} */ (ev);
    vm.handleAttribute(
      /** @type {any} */ (event).detail.questionId,
      /** @type {any} */ (event).detail.attributedParty
    );
  });
}

/**
 * Owns Issues-tab property assignment.
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function updateRemediationPanel(context) {
  const { viewModel: vm, nodes } = context;
  const remediation = nodes.remediation;
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

// TODO(simplify-ui): Remove this compatibility wrapper after Case Review tests
// and page code consume the function bindings directly.
export class RemediationPanelController {
  /** @param {import('./types.js').CaseReviewShellContext} context */
  bind(context) {
    bindRemediationPanel(context);
  }

  /** @param {import('./types.js').CaseReviewShellContext} context */
  update(context) {
    updateRemediationPanel(context);
  }
}
