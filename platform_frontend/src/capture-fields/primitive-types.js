// @ts-check
/**
 * The five Issue Capture Field types that hold a string: `text` and `textarea`
 * free-form, `select` and `radio` chosen from declared options, and `date` a
 * calendar date written `YYYY-MM-DD`.
 *
 * One adapter rather than five modules, because they differ in exactly three
 * ways — whether the value must be one of the declared options, whether it must
 * be a calendar date, and how a caption names the control — and all three are
 * arguments. A type that needs more than that has earned a module of its own;
 * `person` is the one that has.
 *
 * @typedef {import('../sharepoint-client.js').CaptureField} CaptureField
 * @typedef {import('./contract.js').CaptureFieldType} CaptureFieldType
 */

import { buildCaptureControl } from '../lib/capture-engine.js';
import { captureDisplayText } from '../evaluators/capture-values.js';
import { isDateKey } from '../lib/local-calendar.js';

/**
 * @param {string} type
 * @param {{ caption?: import('./contract.js').CaptionStyle, fromOptions?: boolean, calendarDate?: boolean }} [options]
 * @returns {CaptureFieldType}
 */
function textualType(
  type,
  { caption = 'wraps', fromOptions = false, calendarDate = false } = {}
) {
  return {
    type,
    caption,
    validate(field, value) {
      if (typeof value !== 'string') {
        throw new Error(
          `Invalid value for ${field.type} Issue Capture Field "${field.key}" — expected text.`
        );
      }
      if (calendarDate && !isDateKey(value)) {
        throw new Error(
          `Invalid value "${value}" for date Issue Capture Field "${field.key}" — expected a YYYY-MM-DD date.`
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
  textualType('date', { calendarDate: true }),
]);
