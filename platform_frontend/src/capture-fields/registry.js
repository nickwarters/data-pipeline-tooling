// @ts-check
/**
 * The Issue Capture Field types this framework can render, by `type`.
 *
 * A **framework vocabulary**, not an application composition — which is why it
 * lives here and names its own built-ins rather than being handed a list by
 * `src/app-config.js`. A Case Type *selects* a field type the way it selects a
 * Void Reason or an Amendment Reason: the set is the framework's, and every
 * application has the same primitives. What the composition root names is what
 * an application *has* — its Sections, its pages, its Case Types — and no
 * application has a different `text` field.
 *
 * `registerCaptureFieldType` is there for the case that is not true yet: an
 * application-specific field type, registered at boot. Nothing does today.
 *
 * @typedef {import('./contract.js').CaptureFieldType} CaptureFieldType
 */

import { PRIMITIVE_CAPTURE_FIELD_TYPES } from './primitive-types.js';
import { PERSON_CAPTURE_FIELD_TYPE } from './person-type.js';

/** @type {Map<string, CaptureFieldType>} */
const registry = new Map();

for (const type of [
  ...PRIMITIVE_CAPTURE_FIELD_TYPES,
  PERSON_CAPTURE_FIELD_TYPE,
]) {
  registry.set(type.type, type);
}

/**
 * Register a capture field type, replacing one of the same name.
 *
 * @param {CaptureFieldType} type
 */
export function registerCaptureFieldType(type) {
  if (!type?.type) {
    throw new Error('registerCaptureFieldType requires a type name');
  }
  registry.set(type.type, type);
}

/**
 * The type that answers for a `CaptureField.type`, or `undefined`.
 *
 * `undefined` rather than a throw: a Case Type declaring an unknown type is
 * caught by `verify-config.js` before a browser sees it, and a reader that
 * meets one at runtime should show what is stored rather than take the page
 * down.
 *
 * @param {string} type
 * @returns {CaptureFieldType | undefined}
 */
export function getCaptureFieldType(type) {
  return registry.get(type);
}

/**
 * Every registered type name, for the gate that checks a Case Type's fields
 * against what can actually be rendered.
 *
 * @returns {string[]}
 */
export function captureFieldTypeNames() {
  return [...registry.keys()];
}
