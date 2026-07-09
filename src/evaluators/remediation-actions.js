// @ts-check
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').CaptureGroup} CaptureGroup */
/** @typedef {import('../sharepoint-client.js').RemediationAction} RemediationAction */

/**
 * The **Remediation tracking** model. A Remediation Action grew from a
 * plain string to a stateful `{ id, text, status, cancelReason? }` record. Actions
 * are stored where the architecture decision puts them — the value of an `actions`-typed Issue
 * Capture Field on a failed Answer (`Answer.capture[key]`), now an array of these
 * records. This module is the single place that reads/normalises that store,
 * validates the cancel-reason rule, and derives the completion gate.
 */

/**
 * Coerce a stored Remediation Action into the the architecture decision object shape. Pre-existing
 * data stored a plain `string` (the action text alone); it is read as a *pending*
 * action carrying `fallbackId`. An already-object action passes through, its
 * `status` defaulting to `'pending'` when absent or unrecognised and its
 * `cancelReason` kept only while `cancelled`.
 *
 * @param {string | RemediationAction | { id?: string, text: string, status?: string, cancelReason?: string }} raw
 * @param {string} [fallbackId]
 * @returns {RemediationAction}
 */
export function coerceRemediationAction(raw, fallbackId = '') {
  if (typeof raw === 'string') {
    return { id: fallbackId, text: raw, status: 'pending' };
  }
  const status =
    raw.status === 'complete' || raw.status === 'cancelled'
      ? raw.status
      : 'pending';
  /** @type {RemediationAction} */
  const action = { id: raw.id ?? fallbackId, text: raw.text, status };
  if (status === 'cancelled' && raw.cancelReason) {
    action.cancelReason = raw.cancelReason;
  }
  return action;
}

/**
 * Coerce a stored `actions` capture value (an array of strings and/or objects,
 * pre- or post-migration) into `RemediationAction[]`. Legacy string entries get a
 * stable `${keyPrefix}-${index}` id.
 *
 * @param {Array<string | RemediationAction> | undefined} list
 * @param {string} [keyPrefix]
 * @returns {RemediationAction[]}
 */
export function coerceRemediationActions(list, keyPrefix = 'ra') {
  return (list ?? []).map((raw, index) =>
    coerceRemediationAction(raw, `${keyPrefix}-${index}`)
  );
}

/**
 * Hard field validation: a `cancelled` action must carry a non-empty
 * cancellation reason. Throws otherwise; a no-op for other statuses.
 *
 * @param {RemediationAction} action
 */
export function validateRemediationAction(action) {
  if (action.status === 'cancelled' && !(action.cancelReason ?? '').trim()) {
    throw new Error(
      `Remediation Action "${action.id}" cannot be cancelled without a reason.`
    );
  }
}

/**
 * Whether an action has reached a terminal resolution: `complete`, or `cancelled`
 * with a reason. A `pending` action — or a `cancelled` one missing its reason — is
 * unresolved.
 *
 * @param {RemediationAction} action
 * @returns {boolean}
 */
export function isActionResolved(action) {
  if (action.status === 'complete') return true;
  if (action.status === 'cancelled')
    return !!(action.cancelReason ?? '').trim();
  return false;
}

/**
 * Apply a resolution to an action, returning a fresh record. Enforces the
 * cancel-reason rule and drops a stale `cancelReason` whenever the new
 * status is not `cancelled`.
 *
 * @param {RemediationAction} action
 * @param {'pending' | 'complete' | 'cancelled'} status
 * @param {string} [cancelReason]
 * @returns {RemediationAction}
 */
export function setActionStatus(action, status, cancelReason = '') {
  /** @type {RemediationAction} */
  const next = { id: action.id, text: action.text, status };
  if (status === 'cancelled') next.cancelReason = cancelReason;
  validateRemediationAction(next);
  return next;
}

/**
 * The keys of every `actions`-typed Issue Capture Field a Case Type
 * declares, across all capture groups — the fields whose Answer values hold
 * Remediation Actions.
 *
 * @param {CaptureGroup[] | undefined} captureGroups
 * @returns {string[]}
 */
export function actionFieldKeys(captureGroups) {
  /** @type {string[]} */
  const keys = [];
  for (const group of captureGroups ?? []) {
    for (const field of group.fields) {
      if (field.type === 'actions') keys.push(field.key);
    }
  }
  return keys;
}

/**
 * The sent Remediation Actions recorded against a single Answer, read from its
 * `actions`-typed capture fields (`keys`) and coerced to object records.
 *
 * @param {Answer | undefined} answer
 * @param {string[]} keys
 * @returns {RemediationAction[]}
 */
export function sentActionsForAnswer(answer, keys) {
  const capture = answer?.capture;
  if (!capture) return [];
  /** @type {RemediationAction[]} */
  const out = [];
  for (const key of keys) {
    const raw = capture[key];
    if (Array.isArray(raw)) out.push(...coerceRemediationActions(raw, key));
  }
  return out;
}

/**
 * Every sent Remediation Action across all of a Case's Answers — the
 * flat list the Remediation tracking tab renders and gates on.
 *
 * @param {Record<string, Answer>} answers
 * @param {CaptureGroup[] | undefined} captureGroups
 * @returns {RemediationAction[]}
 */
export function allSentActions(answers, captureGroups) {
  const keys = actionFieldKeys(captureGroups);
  if (keys.length === 0) return [];
  /** @type {RemediationAction[]} */
  const out = [];
  for (const answer of Object.values(answers ?? {})) {
    out.push(...sentActionsForAnswer(answer, keys));
  }
  return out;
}

/**
 * The Remediation tracking completion gate: the tab is complete once
 * **every** sent action is resolved (`complete`, or `cancelled` with a reason).
 * Vacuously true when no actions were sent — on the no-actions path there is no
 * tracking content, so the gate is inert and never blocks completion.
 *
 * @param {Record<string, Answer>} answers
 * @param {CaptureGroup[] | undefined} captureGroups
 * @returns {boolean}
 */
export function remediationTrackingComplete(answers, captureGroups) {
  return allSentActions(answers, captureGroups).every(isActionResolved);
}
