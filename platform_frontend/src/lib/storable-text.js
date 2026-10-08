// @ts-check

/**
 * Characters SharePoint refuses to store in a text column. In unicode mode
 * `\p{Surrogate}` matches only a stray half, never a valid pair, so emoji
 * survive. Vertical tab and form feed are absent: they become newlines first.
 */
// eslint-disable-next-line no-control-regex
const UNSTORABLE = /[\u0000-\u0008\u000E-\u001F\uFFFE\uFFFF]|\p{Surrogate}/gu;

/** Word and Outlook write a soft line break as a vertical tab or a form feed. */
// eslint-disable-next-line no-control-regex
const SOFT_LINE_BREAK = /[\u000B\u000C]/g;

/**
 * Text pasted from Word, Outlook or an AI tool carries invisible control
 * characters SharePoint errors on and a Reviewer cannot see to remove.
 *
 * @param {string} value
 * @returns {string}
 */
export function toStorableText(value) {
  return value.replace(SOFT_LINE_BREAK, '\n').replace(UNSTORABLE, '');
}
