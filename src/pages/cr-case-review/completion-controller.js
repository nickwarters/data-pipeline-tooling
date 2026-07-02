// @ts-check

/**
 * Whether the Case carries ≥1 Remediation Action across its (failed) Answers.
 * This drives the two-way Summary bottom button (ADR-0023): with actions it
 * reads **Send Actions** and routes down the actions path (→ `Actions In
 * Progress`); with none it reads **Complete Case** and closes outright. Mirrors
 * the machine's `hadRemediation` snapshot so the label and the freeze agree.
 *
 * @param {import('./types.js').CaseReviewShellContext['viewModel']} vm
 * @returns {boolean}
 */
export function hasRemediationActions(vm) {
  const answers = vm.answersSignal?.get?.() ?? {};
  return Object.values(answers).some(
    (a) => (a.remediationActions?.length ?? 0) > 0
  );
}

/**
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function bindCompletion(context) {
  const { viewModel: vm, nodes } = context;
  const button = nodes.completeButton;
  if (!button || !vm.caseRow || !vm.config || !vm.machine) return;
  const { caseRow, config, machine } = vm;

  button.addEventListener('click', (event) => {
    const target = /** @type {HTMLButtonElement} */ (event?.target || button);
    if (target.disabled) return;
    target.disabled = true;
    // ≥1 Remediation Action ⇒ Send Actions (hand off, stay open); otherwise the
    // no-actions Complete Case path closes the Case outright. Both stamp the
    // reportable snapshot; only the actions path leaves `completedAt` unset.
    const transition = hasRemediationActions(vm)
      ? machine.transitionToActionsInProgress
      : machine.transitionToCompleted;
    const patchFields = transition
      ? transition.call(
          machine,
          config.computeOutcome,
          vm.answersSignal.get(),
          vm.exportHash ?? null
        )
      : {
          status: /** @type {'Completed'} */ ('Completed'),
          completedAt: new Date().toISOString(),
        };
    context
      .completeCase(caseRow.id, vm.client, vm.saveQueue, patchFields)
      .finally(() => {
        target.disabled = false;
      });
  });
}

/**
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function updateCompletion(context) {
  const { viewModel: vm, nodes } = context;
  const button = nodes.completeButton;
  if (!button || !vm.machine) return;

  button.hidden = !(vm.allAnswered.get() && vm.machine.canComplete);
  button.textContent = hasRemediationActions(vm)
    ? 'Send Actions'
    : 'Complete Case';
}

/**
 * @deprecated Use bindCompletion() and updateCompletion().
 */
export class CompletionController {
  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
    bindCompletion(context);
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  update(context) {
    updateCompletion(context);
  }
}

/**
 * @param {import('./types.js').CompletionRequest} request
 * @returns {Promise<void>}
 */
export async function completeCase(request) {
  const { caseId, client, saveQueue, patchFields, opts } = request;
  if (!client || !saveQueue) return;

  const finalFields = patchFields || {
    status: /** @type {'Completed'} */ ('Completed'),
    completedAt: new Date().toISOString(),
  };

  const flushed = await saveQueue.flushCase(caseId);
  if (!flushed) return;

  const etag = saveQueue.getEtag(caseId);
  const result = await client.patchCase(caseId, finalFields, etag, opts ?? {});
  if (result.ok && typeof location !== 'undefined') {
    location.hash = '#/dashboard';
  }
}
