// @ts-check
import { describeSaveFailure, failureOf } from './save-failure.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').PatchResult} PatchResult */
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').SupportLogChange} SupportLogChange */

/**
 * @typedef {{ ok: true } | { ok: false, conflict: boolean, message: string }} SupportActionResult
 */

/**
 * Log a support action, change the Case, and log `not-applied` if that change failed.
 *
 * @param {SharePointClient} client
 * @param {{ row: CaseRow, action: string, reason: string, changes: SupportLogChange[] }} entry
 * @param {() => Promise<PatchResult>} write
 * @returns {Promise<SupportActionResult>}
 */
export async function runSupportAction(
  client,
  { row, action, reason, changes },
  write
) {
  const subject = {
    caseType: row.caseType,
    caseId: row.id,
    caseReference: row.title,
    action,
  };
  const recordedId = await client.addSupportLogEntry({
    ...subject,
    reason,
    changes,
    outcome: 'recorded',
    relatesTo: null,
  });

  /** @type {PatchResult} */
  let result;
  try {
    result = await write();
  } catch {
    result = { ok: false, status: 0 };
  }
  if (result.ok) return { ok: true };

  const conflict = result.status === 412;
  const failure = conflict
    ? 'The Case changed after it was opened, so nothing was changed.'
    : `${describeSaveFailure(failureOf(result))} Nothing was changed.`;
  try {
    await client.addSupportLogEntry({
      ...subject,
      reason: failure,
      changes: [],
      outcome: 'not-applied',
      relatesTo: recordedId,
    });
  } catch {
    return {
      ok: false,
      conflict,
      message: `${failure} The support log could not record that it was not applied.`,
    };
  }
  return { ok: false, conflict, message: failure };
}
