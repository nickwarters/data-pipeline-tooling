// @ts-check
import { h } from '../../lib/html.js';

/**
 * The mandatory reason every support action asks for.
 *
 * @param {{ reason: string, saving: boolean }} form
 * @param {(reason: string) => void} onReason
 * @returns {HTMLElement}
 */
export function reasonFieldView(form, onReason) {
  return h(
    'label',
    { className: 'cora-case-support-field' },
    h('span', {}, 'Reason'),
    h('textarea', {
      className: 'cora-case-support-reason',
      value: form.reason,
      disabled: form.saving,
      oninput: (/** @type {any} */ ev) => onReason(ev.target?.value ?? ''),
    })
  );
}

/**
 * The form's save error, then its submit and cancel buttons.
 *
 * @param {{ saving: boolean, error: string | null }} form
 * @param {{ label: string, savingLabel: string, ready: boolean }} submit
 * @param {{ onSubmit: () => void, onCancel: () => void }} handlers
 * @returns {Array<HTMLElement | null>}
 */
export function formFooterView(form, submit, handlers) {
  return [
    form.error
      ? h(
          'p',
          { className: 'cora-case-support-error', role: 'alert' },
          form.error
        )
      : null,
    h(
      'div',
      { className: 'cora-case-support-form-actions' },
      h(
        'button',
        {
          type: 'button',
          className: 'cora-case-support-submit',
          disabled: !submit.ready || form.saving,
          onclick: () => handlers.onSubmit(),
        },
        form.saving ? submit.savingLabel : submit.label
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'cora-btn-secondary cora-case-support-cancel',
          disabled: form.saving,
          onclick: () => handlers.onCancel(),
        },
        'Cancel'
      )
    ),
  ];
}
