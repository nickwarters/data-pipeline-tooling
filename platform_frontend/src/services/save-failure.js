// @ts-check

/**
 * Why a Case write did not land. `network` (no response) and `unavailable`
 * (502/503/504) can clear by waiting; `invalid-value` and `person-not-found`
 * fail again if resent.
 *
 * @typedef {'network'
 *   | 'unavailable'
 *   | 'invalid-value'
 *   | 'person-not-found'
 *   | 'forbidden'
 *   | 'not-found'
 *   | 'unknown'} SaveFailureReason
 */

/**
 * @typedef {{
 *   reason: SaveFailureReason,
 *   message?: string,
 *   account?: string,
 * }} SaveFailure
 *
 * `message` is SharePoint's own words, shown only for `unknown`; `account` is
 * the person a `person-not-found` could not resolve.
 */

/** A 400 is always a refused value; a 500 only when its message says so. */
const REFUSED_VALUE_MESSAGE =
  /invalid character|hexadecimal value|exceeds the maximum length|too long|maximum length/i;

/**
 * @param {{ status: number, message?: string }} failed `status` 0 means no response.
 * @returns {SaveFailure}
 */
export function classifySaveFailure({ status, message }) {
  const withMessage = message ? { message } : {};
  if (status === 0) return { reason: 'network' };
  if (status === 502 || status === 503 || status === 504) {
    return { reason: 'unavailable' };
  }
  if (status === 400 || status === 413) {
    return { reason: 'invalid-value', ...withMessage };
  }
  if (status === 401 || status === 403) return { reason: 'forbidden' };
  if (status === 404) return { reason: 'not-found' };
  if (message && REFUSED_VALUE_MESSAGE.test(message)) {
    return { reason: 'invalid-value', message };
  }
  return { reason: 'unknown', ...withMessage };
}

/**
 * @param {{ status: number, failure?: SaveFailure }} result
 * @returns {SaveFailure}
 */
export function failureOf(result) {
  return result.failure ?? classifySaveFailure({ status: result.status });
}

/**
 * `unknown` is deliberately not a connection failure: the queue bounds its
 * attempts instead of retrying for as long as the tab is open.
 *
 * @param {SaveFailure} failure
 * @returns {boolean}
 */
export function isConnectionFailure(failure) {
  return failure.reason === 'network' || failure.reason === 'unavailable';
}

const FIELD_LABELS = /** @type {Record<string, string>} */ ({
  notes: 'Notes',
  caseJustification: 'Case Justification',
  answers: 'answers',
  conversation: 'message',
  responsibleParty: 'Responsible Party',
  appeals: 'Appeal',
  amendedOutcome: 'amended Outcome',
});

/**
 * @param {SaveFailure} failure
 * @param {{ fields?: string[], personName?: string }} [context]
 * @returns {string}
 */
export function describeSaveFailure(failure, { fields = [], personName } = {}) {
  const label = fields.map((f) => FIELD_LABELS[f]).find(Boolean);
  const what = label ? `Your ${label}` : 'Your change';
  switch (failure.reason) {
    case 'invalid-value':
      return `${what} couldn't be saved because it contains a character SharePoint can't store, or is too long. Text pasted from Word, Outlook or an AI tool is the usual cause: retype that part and it will save.`;
    case 'person-not-found': {
      const who = personName || failure.account || 'That person';
      return `${who} couldn't be added: SharePoint couldn't find their account. They may have left, or their account may not be set up for this site.`;
    }
    case 'forbidden':
      return `${what} couldn't be saved because you don't have permission to change this Case.`;
    case 'not-found':
      return `${what} couldn't be saved because this Case can no longer be found. It may have been moved or deleted. Reload to check.`;
    case 'network':
    case 'unavailable':
      return `${what} couldn't be saved because SharePoint can't be reached. Check your connection or VPN and try again.`;
    default:
      return failure.message
        ? `${what} couldn't be saved. SharePoint said: "${failure.message}". Try again, and if it keeps happening, copy anything you typed somewhere safe and reload.`
        : `${what} couldn't be saved. Try again, and if it keeps happening, copy anything you typed somewhere safe and reload.`;
  }
}
