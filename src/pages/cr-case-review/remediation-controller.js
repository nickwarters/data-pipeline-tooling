// @ts-check

/**
 * Owns Issues-tab property assignment and event forwarding.
 */
export class RemediationPanelController {
  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
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
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  update(context) {
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
}
