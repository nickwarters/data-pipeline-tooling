// @ts-check

/**
 * Why a Case write did not land, in the terms a person can act on.
 *
 * - `network` — the request never reached SharePoint (offline, VPN dropped).
 * - `unavailable` — SharePoint answered that it cannot serve the request right
 *   now (502/503/504). Like `network`, waiting can fix it.
 * - `invalid-value` — SharePoint refused what was sent: a character it cannot
 *   store, or a value too long for its column. Sending it again fails again.
 * - `person-not-found` — a person could not be resolved to a SharePoint user,
 *   so a Person column could not be written. Sending it again fails again.
 * - `forbidden` — the user may not change this item.
 * - `not-found` — the Case or its list is no longer there.
 * - `unknown` — anything else. Worth one or two more attempts, then stop.
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
 * `message` is SharePoint's own explanation when it gave one, shown only for
 * `unknown`, where there is nothing better to say. `account` is the person who
 * could not be resolved, for `person-not-found`.
 */

/**
 * The words SharePoint uses when it refuses a value rather than the request.
 * A 400 is always a refused value; a 500 is one only when its message says so,
 * because SharePoint also answers 500 for its own faults.
 */
const REFUSED_VALUE_MESSAGE =
  /invalid character|hexadecimal value|exceeds the maximum length|too long|maximum length/i;

/**
 * Classify a failed write from what the HTTP exchange left behind.
 *
 * @param {{ status: number, message?: string }} failed
 *   `status` 0 means no response was received at all.
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
 * Why a failed `PatchResult` failed: what the client said, or, from a client
 * or a caught throw that said nothing more, what its status says.
 *
 * @param {{ status: number, failure?: SaveFailure }} result
 * @returns {SaveFailure}
 */
export function failureOf(result) {
  return result.failure ?? classifySaveFailure({ status: result.status });
}

/**
 * Whether waiting and sending the same write again can succeed. `unknown` is
 * deliberately not here: the queue gives it a bounded number of attempts
 * rather than retrying it for as long as the tab is open.
 *
 * @param {SaveFailure} failure
 * @returns {boolean}
 */
export function isConnectionFailure(failure) {
  return failure.reason === 'network' || failure.reason === 'unavailable';
}

/** Display names for the Case fields a Reviewer edits directly. */
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
 * What to tell the person about a write that will not be retried. One sentence
 * or two, naming what was not saved and what they can do about it.
 *
 * @param {SaveFailure} failure
 * @param {{ fields?: string[], personName?: string }} [context]
 *   `fields` are the Case fields the failed write carried; `personName` is the
 *   display name of the person in a `person-not-found` failure, when known.
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
