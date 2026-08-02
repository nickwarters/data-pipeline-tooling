// @ts-check
// No component instance, controller object, or lifecycle — just field config in,
// element out — so function components can call it directly.

import { h } from './html.js';

/** @typedef {import('../sharepoint-client.js').CaptureField} CaptureField */

/**
 * Builds an input element for a capture field.
 * @param {CaptureField} fieldConfig
 * @param {string} currentValue
 * @param {(value: string) => void} onChange
 * @param {string} [className]
 * @param {string} [namePrefix] Prefix for the radio-group `name`. Callers that
 * render the same field for several rows (e.g. one per failed Answer) must pass
 * a per-row prefix, otherwise every row's radios share a `name` and collapse
 * into a single native radio group — selecting one clears the others.
 * @param {boolean} [disabled] Disables the control — every input of a `radio`
 * field, not just the wrapper, which has no disabled state of its own.
 * @returns {HTMLElement}
 */
export function buildCaptureControl(
  fieldConfig,
  currentValue,
  onChange,
  className = 'cora-capture-input',
  namePrefix = '',
  disabled = false
) {
  const onChangeHandler = (/** @type {Event} */ ev) => {
    const target =
      /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} */ (
        ev.target
      );
    onChange(target.value);
  };

  if (fieldConfig.type === 'radio') {
    return h(
      'div',
      { className: 'cora-capture-radio-group' },
      ...(fieldConfig.options ?? []).map((opt) =>
        h(
          'label',
          { className: 'cora-capture-radio' },
          h('input', {
            type: 'radio',
            name: `${namePrefix}${fieldConfig.key}`,
            value: opt,
            checked: currentValue === opt,
            disabled,
            onchange: () => onChange(opt),
          }),
          h('span', {}, opt)
        )
      )
    );
  }

  if (fieldConfig.type === 'select') {
    return h(
      'select',
      { className, value: currentValue, disabled, onchange: onChangeHandler },
      h('option', { value: '' }, '—'),
      ...(fieldConfig.options ?? []).map((opt) =>
        h('option', { value: opt }, opt)
      )
    );
  }

  if (fieldConfig.type === 'textarea') {
    return h('textarea', {
      className,
      value: currentValue,
      placeholder: fieldConfig.placeholder,
      disabled,
      onchange: onChangeHandler,
    });
  }

  return h('input', {
    className,
    type: 'text',
    value: currentValue,
    placeholder: fieldConfig.placeholder,
    disabled,
    onchange: onChangeHandler,
  });
}
