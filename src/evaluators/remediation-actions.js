// @ts-check
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').CaptureGroup} CaptureGroup */
/** @typedef {import('../sharepoint-client.js').RemediationAction} RemediationAction */

/**
 * A **read-only compatibility shim** over the `actions`-typed Issue Capture Field
 * store (ADR-0024): the value of an `actions` field on a failed Answer
 * (`Answer.capture[key]`), an array of `{ id, text, status, cancelReason? }`
 * records or — before that migration — plain strings.
 *
 * **That store is no longer the Remediation model.** ADR-0037 made remediation
 * resolution *question-level*, stored on the Answer as `remediationStatus`
 * beside the `remediationActions` it resolves; `evaluators/remediation-status.js`
 * owns the rows, the resolution vocabulary and the completion gate. The
 * per-action `status` write path, its cancel-reason validation and its gate
 * (`setActionStatus`, `validateRemediationAction`, `isActionResolved`,
 * `allSentActions`, `remediationTrackingComplete`) had no production caller left
 * once that landed and were deleted (#497) — a vacuously-true second gate beside
 * the real one is worse than no gate at all.
 *
 * What survives is *reading* persisted data: no Case Type declares an `actions`
 * field and nothing in `src/` writes one, but Cases stored in SharePoint may
 * still carry values from before ADR-0037, and `summary-model.js` renders them
 * in the Summary's remediation block.
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
