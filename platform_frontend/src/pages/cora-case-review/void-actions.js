// @ts-check

import { voidReasonsFor, voidReasonNeedsNote } from '../../lib/void-reasons.js';
import { h } from '../../lib/html.js';

/** @typedef {import('../../lib/case-machine.js').CaseMachine} CaseMachine */
/** @typedef {import('../../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../../lib/void-reasons.js').VoidReason} VoidReason */

/**
 * Derive the Void control from store state: whether the Reviewer is offered it
 * at all, which reasons it offers, whether that reason still needs writing out,
 * and whether the confirm is live yet.
 *
 * Unlike the completion control there is no disabled-with-a-reason state: a
 * viewer who cannot void sees nothing, and the only thing standing between a
 * Reviewer and the transition is saying why, which the control itself asks for.
 *
 * The note is reported as empty for every reason that does not need one, so a
 * note typed under `other` cannot ride along on a reason the Reviewer switched
 * to afterwards — the store clears it too, and neither half is load-bearing
 * alone.
 *
 * @param {{
 *   machine: CaseMachine | null,
 *   config: CaseTypeConfig,
 *   reasonKey?: string,
 *   note?: string,
 * }} input
 * @returns {{ visible: boolean, disabled: boolean, reasons: readonly VoidReason[], reason: string, noteRequired: boolean, note: string }}
 */
export function voidControl(input) {
  const reasons = voidReasonsFor(input.config);
  const reason = input.reasonKey ?? '';
  const offered = reasons.some((candidate) => candidate.key === reason);
  const noteRequired = offered && voidReasonNeedsNote(reason);
  const note = noteRequired ? (input.note ?? '') : '';
  return {
    visible: input.machine?.canVoid === true,
    disabled: !offered || (noteRequired && note.trim() === ''),
    reasons,
    reason,
    noteRequired,
    note,
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
 *   onNoteChanged: (note: string) => void,
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
  onNoteChanged,
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
          // Only rendered under a reason that needs it, so there is no disabled
          // or hidden box to reason about: the box being on screen is itself
          // the statement that the Reviewer still owes an answer.
          control.noteRequired
            ? h(
                'label',
                { className: 'cora-void-note-label' },
                'Say why',
                h('textarea', {
                  className: 'cora-void-note',
                  value: control.note,
                  'aria-label': 'Say why',
                  required: true,
                  oninput: (/** @type {any} */ event) =>
                    onNoteChanged(event.target.value ?? ''),
                })
              )
            : null,
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
 * can only ever carry a reason the Reviewer was actually shown — and a reason
 * that needs a note produces no patch at all until one is written.
 *
 * @param {{
 *   machine: CaseMachine | null,
 *   config: CaseTypeConfig,
 *   reasonKey?: string,
 *   note?: string,
 * }} input
 * @returns {Partial<import('../../sharepoint-client.js').CaseRow> | null}
 */
export function voidPatch(input) {
  const machine = input.machine;
  if (!machine?.canVoid) return null;
  const control = voidControl(input);
  if (control.disabled) return null;
  return machine.transitionToVoid(control.reason, control.note);
}
