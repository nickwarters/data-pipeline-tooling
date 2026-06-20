// @ts-check
import { h } from './html.js';

/** @typedef {import('../sharepoint-client.js').CaptureField} CaptureField */
/** @typedef {import('../sharepoint-client.js').RemediationField} RemediationField */

/**
 * Builds an input element for a CaptureField or RemediationField.
 * @param {CaptureField | RemediationField} fieldConfig
 * @param {string} currentValue
 * @param {(value: string) => void} onChange
 * @returns {HTMLElement}
 */
export function buildCaptureControl(fieldConfig, currentValue, onChange, className = 'cr-capture-input') {
  const onChangeHandler = (/** @type {Event} */ ev) => {
    const target = /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} */ (ev.target);
    onChange(target.value);
  };



  if (fieldConfig.type === 'radio') {
    return h('div', { className: 'cr-capture-radio-group' },
      ...(fieldConfig.options ?? []).map(opt => 
        h('label', { className: 'cr-capture-radio' },
          h('input', {
            type: 'radio',
            name: fieldConfig.key,
            value: opt,
            checked: currentValue === opt,
            onchange: () => onChange(opt)
          }),
          h('span', {}, opt)
        )
      )
    );
  }

  if (fieldConfig.type === 'select') {
    return h('select', { className, value: currentValue, onchange: onChangeHandler },
      h('option', { value: '' }, '—'),
      ...(fieldConfig.options ?? []).map(opt => h('option', { value: opt }, opt))
    );
  }

  if (fieldConfig.type === 'textarea') {
    return h('textarea', { className, value: currentValue, onchange: onChangeHandler });
  }

  return h('input', { className, type: 'text', value: currentValue, onchange: onChangeHandler });
}
