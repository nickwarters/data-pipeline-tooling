// @ts-check
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').CaptureField} CaptureField */
/** @typedef {import('../sharepoint-client.js').CaptureGroup} CaptureGroup */

/**
 * Load-time check that every `CaptureField.key` is unique across all groups of a
 * Case Type — keys double as storage keys and `showWhen` references,
 * so duplicates would be ambiguous. Throws on the first collision.
 *
 * @param {CaptureGroup[] | undefined} groups
 */
export function validateCaptureGroups(groups) {
  /** @type {Set<string>} */
  const seen = new Set();
  for (const group of groups ?? []) {
    for (const field of group.fields) {
      if (seen.has(field.key)) {
        throw new Error(
          `Duplicate Issue Capture Field key "${field.key}" across capture groups.`
        );
      }
      seen.add(field.key);
    }
  }
}

/**
 * Finds a `CaptureField` by key across all of a Case Type's capture groups.
 * Field keys are unique (see `validateCaptureGroups`), so the first match is
 * authoritative.
 *
 * @param {CaptureGroup[]} groups
 * @param {string} key
 * @returns {CaptureField | undefined}
 */
export function findCaptureField(groups, key) {
  for (const group of groups) {
    for (const field of group.fields) {
      if (field.key === key) return field;
    }
  }
  return undefined;
}

/**
 * Records a single Issue Capture value against an Answer, returning a
 * fresh Answer with the value stored inline under `capture[field.key]`. Mirrors
 * the the architecture decision remediation-detail capture, generalised to the unified engine.
 *
 * @param {Answer} answer
 * @param {CaptureField} field
 * @param {string} value
 * @returns {Answer}
 */
export function captureValue(answer, field, value) {
  if (
    (field.type === 'select' || field.type === 'radio') &&
    value !== '' &&
    !(field.options ?? []).includes(value)
  ) {
    throw new Error(
      `Invalid value "${value}" for ${field.type} Issue Capture Field "${field.key}".`
    );
  }
  const capture = { ...answer.capture };
  if (value === '') {
    delete capture[field.key];
  } else {
    capture[field.key] = value;
  }
  if (Object.keys(capture).length === 0) {
    const { capture: _drop, ...rest } = answer;
    return rest;
  }
  return { ...answer, capture };
}
