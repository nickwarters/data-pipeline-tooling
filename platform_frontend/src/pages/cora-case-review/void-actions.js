// @ts-check

import { voidReasonsFor } from '../../lib/void-reasons.js';
import { h } from '../../lib/html.js';

/** @typedef {import('../../lib/case-machine.js').CaseMachine} CaseMachine */
/** @typedef {import('../../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../../lib/void-reasons.js').VoidReason} VoidReason */

/**
 * Derive the Void control from store state: whether the Reviewer is offered it
 * at all, which reasons it offers, and whether the confirm is live yet.
 *
 * Unlike the completion control there is no disabled-with-a-reason state: a
 * viewer who cannot void sees nothing, and the only thing standing between a
 * Reviewer and the transition is choosing a reason, which the control itself
 * asks for.
 *
 * @param {{
 *   machine: CaseMachine | null,
 *   config: CaseTypeConfig,
 *   reasonKey?: string,
 * }} input
 * @returns {{ visible: boolean, disabled: boolean, reasons: readonly VoidReason[], reason: string }}
 */
export function voidControl(input) {
  const reasons = voidReasonsFor(input.config);
  const reason = input.reasonKey ?? '';
  return {
    visible: input.machine?.canVoid === true,
    disabled: !reasons.some((offered) => offered.key === reason),
    reasons,
    reason,
  };
}

/**
 * Render the Void disclosure and confirmation control for the Case Details
 * Section.
 *
 * @param {{
 *   control: ReturnType<typeof voidControl>,
 *   disclosureOpen: boolean,
 *   pending: boolean,
 *   onToggle: () => void,
 *   onReasonSelected: (reasonKey: string) => void,
 *   onConfirm: () => void | Promise<unknown>,
 * }} input
 * @returns {HTMLElement | null}
 */
export function voidControlView({
  control,
  disclosureOpen,
  pending,
  onToggle,
  onReasonSelected,
  onConfirm,
}) {
  if (!control.visible) return null;
  return h(
    'div',
    { className: 'cora-void', key: 'void' },
    h(
      'button',
      {
        className: 'cora-void-btn',
        'aria-expanded': String(disclosureOpen),
        onclick: onToggle,
      },
      'Void Case…'
    ),
    disclosureOpen
      ? h(
          'div',
          { className: 'cora-void-panel' },
          h(
            'p',
            { className: 'cora-void-consequence' },
            'Voiding closes this Case for good. It records no Outcome, it cannot be reopened, and the Conversation stops accepting messages.'
          ),
          h(
            'label',
            {},
            'Reason for voiding',
            h(
              'select',
              {
                className: 'cora-void-reason',
                value: control.reason,
                onchange: (/** @type {any} */ event) =>
                  onReasonSelected(event.target.value),
              },
              h('option', { value: '' }, '— Select a reason —'),
              ...control.reasons.map((reason) =>
                h('option', { value: reason.key }, reason.label)
              )
            )
          ),
          h(
            'button',
            {
              className: 'cora-void-confirm',
              disabled: pending || control.disabled,
              onclick: onConfirm,
            },
            'Void Case'
          )
        )
      : null
  );
}

/**
 * Ask CaseMachine for the void transition, or `null` when this Reviewer, this
 * Case or this reason cannot produce one. The reason is checked against what
 * the Case Type offers rather than against the whole vocabulary, so the patch
 * can only ever carry a reason the Reviewer was actually shown.
 *
 * @param {{
 *   machine: CaseMachine | null,
 *   config: CaseTypeConfig,
 *   reasonKey?: string,
 * }} input
 * @returns {Partial<import('../../sharepoint-client.js').CaseRow> | null}
 */
export function voidPatch(input) {
  const machine = input.machine;
  if (!machine?.canVoid) return null;
  const control = voidControl(input);
  if (control.disabled) return null;
  return machine.transitionToVoid(control.reason);
}
