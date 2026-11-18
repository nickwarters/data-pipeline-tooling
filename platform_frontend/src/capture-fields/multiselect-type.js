// @ts-check
/**
 * The `multiselect` Issue Capture Field type: any number of the declared
 * options, shown as a set of checkboxes.
 *
 * A module of its own rather than a flag on `select`, because the two differ in
 * both things a type decides. Its value is a list rather than a string, and its
 * control is several inputs, each already inside its own label, so a caption
 * names the set with a legend instead of wrapping one control. A flag would make
 * `select` answer both questions two ways depending on the field.
 *
 * Checkboxes rather than a `<select multiple>` box, because a list box needs a
 * held modifier key to pick a second option, and a click without one silently
 * clears everything picked before.
 *
 * @typedef {import('./contract.js').CaptureFieldType} CaptureFieldType
 * @typedef {import('../sharepoint-client.js').CaptureField} CaptureField
 */

import { h } from '../lib/html.js';

/**
 * The options currently stored, read off whatever is there. A value that is not
 * a list, such as one saved while this field was declared as a `select`, picks
 * the one option it names, so changing the type does not blank a Case.
 *
 * @param {unknown} value
 * @returns {Set<string>}
 */
function storedSelection(value) {
  if (Array.isArray(value)) {
    return new Set(value.filter((v) => typeof v === 'string'));
  }
  return typeof value === 'string' && value !== ''
    ? new Set([value])
    : new Set();
}

/** @type {CaptureFieldType} */
export const MULTISELECT_CAPTURE_FIELD_TYPE = {
  type: 'multiselect',
  caption: 'legend',

  validate(field, value) {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
      throw new Error(
        `Invalid value for multiselect Issue Capture Field "${field.key}" — expected a list of options.`
      );
    }
    const options = field.options ?? [];
    for (const chosen of value) {
      if (!options.includes(chosen)) {
        throw new Error(
          `Invalid value "${chosen}" for multiselect Issue Capture Field "${field.key}".`
        );
      }
    }
    if (new Set(value).size !== value.length) {
      throw new Error(
        `Invalid value for multiselect Issue Capture Field "${field.key}" — an option is chosen twice.`
      );
    }
  },

  /**
   * One checkbox per declared option. Each change writes the whole selection,
   * in the order the options are declared, so the stored list reads the same
   * whatever order the boxes were ticked in. Unticking the last box writes
   * nothing, which clears the field.
   */
  editControl({ field, value, namePrefix, onCapture }) {
    const options = field.options ?? [];
    const selected = storedSelection(value);
    return h(
      'div',
      { className: 'cora-capture-checkbox-group' },
      ...options.map((option) =>
        h(
          'label',
          { className: 'cora-capture-checkbox' },
          h('input', {
            type: 'checkbox',
            name: `${namePrefix}${field.key}`,
            value: option,
            checked: selected.has(option),
            onchange: (/** @type {Event} */ ev) => {
              const ticked = /** @type {HTMLInputElement} */ (ev.target)
                .checked;
              const next = new Set(selected);
              if (ticked) next.add(option);
              else next.delete(option);
              const list = options.filter((o) => next.has(o));
              onCapture(field.key, list.length ? list : null);
            },
          }),
          h('span', {}, option)
        )
      )
    );
  },
};
