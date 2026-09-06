// @ts-check
/**
 * The four Issue Capture Field types that hold text: `text` and `textarea`
 * free-form, `select` and `radio` chosen from declared options.
 *
 * One adapter rather than four modules, because they differ in exactly two
 * ways — whether the value must be one of the declared options, and how a
 * caption names the control — and both are arguments. A type that needs more
 * than that has earned a module of its own; `person` is the one that has.
 *
 * @typedef {import('../sharepoint-client.js').CaptureField} CaptureField
 * @typedef {import('./contract.js').CaptureFieldType} CaptureFieldType
 */

import { buildCaptureControl } from '../lib/capture-engine.js';
import { captureDisplayText } from '../evaluators/capture-values.js';

/**
 * @param {string} type
 * @param {{ caption?: import('./contract.js').CaptionStyle, fromOptions?: boolean }} [options]
 * @returns {CaptureFieldType}
 */
function textualType(type, { caption = 'wraps', fromOptions = false } = {}) {
  return {
    type,
    caption,
    validate(field, value) {
      if (typeof value !== 'string') {
        throw new Error(
          `Invalid value for ${field.type} Issue Capture Field "${field.key}" — expected text.`
        );
      }
      if (fromOptions && !(field.options ?? []).includes(value)) {
        throw new Error(
          `Invalid value "${value}" for ${field.type} Issue Capture Field "${field.key}".`
        );
      }
    },
    editControl({ field, value, namePrefix, onCapture }) {
      return buildCaptureControl(
        field,
        captureDisplayText(value),
        (next) => onCapture(field.key, next),
        'cora-capture-input',
        namePrefix
      );
    },
  };
}

/** @type {readonly CaptureFieldType[]} */
export const PRIMITIVE_CAPTURE_FIELD_TYPES = Object.freeze([
  textualType('text'),
  textualType('textarea'),
  textualType('select', { fromOptions: true }),
  textualType('radio', { caption: 'legend', fromOptions: true }),
]);
