// @ts-check
/**
 * The framework-owned vocabulary of Void Reasons: why a Case was abandoned
 * before it could be reviewed to a conclusion.
 *
 * The keys are framework-owned rather than per-Case-Type because the manager
 * report groups voided Cases by reason **across** Case Types, and it can only do
 * that while a key means the same thing everywhere. A Case Type may narrow the
 * list it offers (`voidReasons` on its config), but that narrowing is
 * display-only: storage validates against the whole vocabulary, so a Case voided
 * under a reason a Case Type later stops offering still reads back correctly.
 *
 * The keys are what is persisted; the labels are display copy and may be
 * reworded freely.
 *
 * `other` is the escape hatch and the only key that means nothing on its own:
 * it is stored alongside a written note, and a Reviewer who picks it has not
 * finished choosing until that note is filled in.
 */

/** @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */

/** @typedef {{ key: string, label: string }} VoidReason */

// Frozen through to the members, not just the list: the report groups on these
// keys across Case Types, so a caller that could reword or re-key one in place
// would silently change what every other reader is grouping by.
/** @type {readonly VoidReason[]} */
export const VOID_REASONS = Object.freeze([
  Object.freeze({ key: 'duplicate', label: 'Duplicate of another Case' }),
  Object.freeze({ key: 'raised-in-error', label: 'Raised in error' }),
  Object.freeze({ key: 'out-of-scope', label: 'Out of scope for review' }),
  Object.freeze({ key: 'no-evidence', label: 'Evidence unavailable' }),
  Object.freeze({ key: 'superseded', label: 'Superseded by another Case' }),
  Object.freeze({ key: 'withdrawn', label: 'Withdrawn by the business' }),
  Object.freeze({ key: 'other', label: 'Other' }),
]);

/**
 * The one reason that names nothing on its own. It is last in display order and
 * carries a written note instead of a meaning of its own, so a Case voided
 * under it still says why — see `voidReasonNeedsNote`.
 */
export const VOID_REASON_OTHER = 'other';

/**
 * Whether a reason is answered by its key alone, or needs the Reviewer to write
 * what it was. Only `other` needs one: every other key already names its own
 * meaning, and the report groups on the key.
 *
 * @param {string | null | undefined} key
 * @returns {boolean}
 */
export function voidReasonNeedsNote(key) {
  return key === VOID_REASON_OTHER;
}

/**
 * The reasons a Case Type offers, in framework display order. A Case Type that
 * declares none offers all of them; a declared key the framework does not know
 * is dropped rather than offered.
 *
 * @param {Partial<CaseTypeConfig>} config
 * @returns {readonly VoidReason[]}
 */
export function voidReasonsFor(config) {
  const declared = config.voidReasons;
  if (!declared) return VOID_REASONS;
  return VOID_REASONS.filter((reason) => declared.includes(reason.key));
}

/**
 * Whether a key names a reason in the framework vocabulary.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isVoidReasonKey(key) {
  return VOID_REASONS.some((reason) => reason.key === key);
}

/**
 * The display label for a stored reason key. An unrecognised key renders as
 * itself: a reason retired from the vocabulary is still on rows already voided
 * under it, and a raw key reads better than a blank cell.
 *
 * @param {string | null | undefined} key
 * @returns {string}
 */
export function voidReasonLabel(key) {
  if (!key) return '';
  return VOID_REASONS.find((reason) => reason.key === key)?.label ?? key;
}

/**
 * How a stored reason reads on a voided Case: the label, and the written note
 * behind it when there is one. The note is what carries the meaning under
 * `other`, so a banner that showed the label alone would say only that the
 * Reviewer had a reason.
 *
 * @param {string | null | undefined} key
 * @param {string | null | undefined} note
 * @returns {string}
 */
export function voidReasonText(key, note) {
  const label = voidReasonLabel(key);
  const written = (note ?? '').trim();
  if (!written) return label;
  return label ? `${label}: ${written}` : written;
}
