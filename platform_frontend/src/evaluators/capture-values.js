// @ts-check
/**
 * What a stored Issue Capture value *is*, read off the value itself.
 *
 * A leaf on purpose, and read by both the evaluator that stores capture and the
 * types that render it — which is what stops the type modules importing back
 * into `issue-capture.js` and closing a loop through the registry.
 *
 * Neither of these takes a field, and that is deliberate rather than an
 * oversight: a Case saved before `person` fields existed holds a plain string
 * under a person key, because the control fell through to a text box then. Only
 * the write path judges what a field may hold; a reader shows what is there.
 */

/**
 * Whether a capture value counts as "nothing recorded" — the one definition the
 * write path (which deletes the key rather than storing emptiness) and the
 * completion gate (which asks whether a required field is filled) both read.
 *
 * Only an absent value or empty text is nothing. Anything else is something,
 * which is what keeps a malformed write a rejection rather than a silent
 * delete: emptiness clears a field, it does not excuse a value the field cannot
 * hold.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isEmptyCaptureValue(value) {
  return value === null || value === undefined || value === '';
}

/**
 * Whether a value is a person: an object carrying both an account and a name.
 * Both must be present and non-empty — a half-filled person would render as a
 * blank chip.
 *
 * @param {unknown} value
 * @returns {value is { loginName: string, displayName: string }}
 */
export function isPerson(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const { loginName, displayName } = /** @type {Record<string, unknown>} */ (
    value
  );
  return (
    typeof loginName === 'string' &&
    loginName !== '' &&
    typeof displayName === 'string' &&
    displayName !== ''
  );
}

/**
 * How one stored capture value reads as text, whatever it holds. Total on
 * purpose — see the note at the top of this file.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function captureDisplayText(value) {
  if (typeof value === 'string') return value;
  return isPerson(value) ? value.displayName : '';
}
