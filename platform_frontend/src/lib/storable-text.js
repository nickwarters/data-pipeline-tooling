// @ts-check

/**
 * Characters SharePoint refuses to store in a text column: C0 control codes
 * other than tab, line feed and carriage return, the two non-characters at the
 * end of the Basic Multilingual Plane, and half of a surrogate pair. The last
 * is what `\p{Surrogate}` means in unicode mode: a valid pair is read as one
 * astral code point, so an emoji is never matched, only a stray half.
 *
 * Vertical tab and form feed are absent on purpose; they are line breaks and
 * are turned into one before this runs.
 */
// The control characters are the point of this pattern.
// eslint-disable-next-line no-control-regex
const UNSTORABLE = /[\u0000-\u0008\u000E-\u001F\uFFFE\uFFFF]|\p{Surrogate}/gu;

/** Word and Outlook write a soft line break as a vertical tab or a form feed. */
// eslint-disable-next-line no-control-regex
const SOFT_LINE_BREAK = /[\u000B\u000C]/g;

/**
 * The text as SharePoint will accept it. Text pasted from Word, Outlook or an
 * AI tool carries invisible control characters that SharePoint answers with an
 * error rather than ignoring, and a Reviewer cannot see them to remove them.
 * A soft line break keeps its meaning as a newline; the rest are dropped.
 * Emoji, smart quotes, dashes and non-breaking spaces are valid text and pass
 * through untouched.
 *
 * @param {string} value
 * @returns {string}
 */
export function toStorableText(value) {
  return value.replace(SOFT_LINE_BREAK, '\n').replace(UNSTORABLE, '');
}
