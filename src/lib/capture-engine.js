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
 * @returns {HTMLElement}
 */
export function buildCaptureControl(
  fieldConfig,
  currentValue,
  onChange,
  className = 'cora-capture-input',
  namePrefix = ''
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
      { className, value: currentValue, onchange: onChangeHandler },
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
      onchange: onChangeHandler,
    });
  }

  return h('input', {
    className,
    type: 'text',
    value: currentValue,
    placeholder: fieldConfig.placeholder,
    onchange: onChangeHandler,
  });
}

/**
 * Tags a control built above with a stable `data-focus-key`, and sets its
 * disabled state.
 *
 * Nothing in the app reads the attribute — the renderer preserves focus and
 * caret by patching the element in place. It is a stable, readable handle for
 * tests and for anyone inspecting the DOM.
 *
 * Which field types produce a wrapper around several inputs is knowledge that
 * belongs to the builder, so it lives here rather than in each consumer: add a
 * multi-input type to `buildCaptureControl` and every caller stays correct.
 * A `radio` group's inputs each take `<key>:<value>`.
 *
 * @param {HTMLElement} control
 * @param {CaptureField} fieldConfig
 * @param {string} key
 * @param {boolean} [disabled]
 */
export function applyCaptureFocusKey(control, fieldConfig, key, disabled) {
  if (fieldConfig.type === 'radio') {
    for (const input of control.querySelectorAll('input')) {
      input.setAttribute('data-focus-key', `${key}:${input.value}`);
      if (disabled !== undefined) input.disabled = disabled;
    }
    return;
  }
  control.setAttribute('data-focus-key', key);
  if (disabled !== undefined) /** @type {any} */ (control).disabled = disabled;
}
