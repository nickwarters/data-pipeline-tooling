// @ts-check
import { planGrant, planRevoke, roleTitle } from './access-roles.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').AccessLogOutcome} AccessLogOutcome */
/** @typedef {import('./access-roles.js').RoleRef} RoleRef */
/** @typedef {import('./access-roles.js').CaseTypeRef} CaseTypeRef */

/**
 * `refused` means nothing was written anywhere; the other two say how much of the change landed.
 *
 * @typedef {{ ok: true, applied: string[] } | { ok: false, outcome: 'refused' | 'not-applied' | 'partly-applied', message: string }} AccessChangeResult
 */

/**
 * @param {string} message
 * @returns {AccessChangeResult}
 */
const refused = (message) => ({ ok: false, outcome: 'refused', message });

/**
 * Log a role change, apply its groups one by one, and log how far it got if one failed.
 *
 * @param {SharePointClient} client
 * @param {{ action: 'grant' | 'revoke', role: RoleRef, account: string, targetName: string, reason: string }} request
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {Promise<AccessChangeResult>}
 */
export async function runAccessChange(client, request, caseTypes) {
  const { action, role, account, targetName, reason } = request;

  // The plan is worked out from the groups as they are now, not as the page last showed them.
  /** @type {string[]} */
  let current;
  try {
    current = await client.listUserGroups(account);
  } catch {
    return refused(
      `Nothing was changed: ${targetName}'s current access could not be read.`
    );
  }
  const plan =
    action === 'grant'
      ? planGrant(role, current, caseTypes)
      : planRevoke(role, current, caseTypes);
  if (plan.refusal) return refused(`Nothing was changed. ${plan.refusal}`);
  const { groups } = plan;

  // Every group is checked before anything is written, so a half-writable role is refused whole.
  /** @type {Record<string, string>} */
  let editability;
  try {
    editability = await client.getGroupEditability(groups);
  } catch {
    return refused(
      'Nothing was changed: whether you may change these groups could not be checked.'
    );
  }
  const blocked = groups.filter((group) => editability[group] !== 'editable');
  if (blocked.length > 0) {
    const detail = blocked
      .map((group) =>
        editability[group] === 'read-only'
          ? `you cannot change who is in ${group}`
          : `${group} does not exist`
      )
      .join('; ');
    return refused(
      `Nothing was changed: for ${roleTitle(role, caseTypes)}, ${detail}. Fix it in SharePoint, then try again.`
    );
  }

  const subject = {
    account,
    targetName,
    action,
    role: role.id,
    caseType: role.caseType ?? '',
  };
  /** @param {string} group */
  const change = (group) => ({
    field: group,
    before: action === 'revoke',
    after: action === 'grant',
  });
  let recordedId;
  try {
    recordedId = await client.addAccessLogEntry({
      ...subject,
      reason,
      changes: groups.map(change),
      outcome: 'recorded',
      relatesTo: null,
    });
  } catch {
    return refused('Nothing was changed: the access log could not be written.');
  }

  /** @type {string[]} */
  const applied = [];
  for (const group of groups) {
    const result = await writeMembership(client, action, group, account);
    if (!result.ok) {
      return followUp(client, {
        ...subject,
        recordedId,
        applied,
        failedGroup: group,
        status: result.status,
        change,
      });
    }
    applied.push(group);
  }
  return { ok: true, applied };
}

/**
 * One membership write, with a thrown failure treated as a status of zero.
 *
 * @param {SharePointClient} client
 * @param {'grant' | 'revoke'} action
 * @param {string} group
 * @param {string} account
 * @returns {Promise<import('../sharepoint-client.js').GroupMemberWrite>}
 */
async function writeMembership(client, action, group, account) {
  try {
    return action === 'grant'
      ? await client.addGroupMember(group, account)
      : await client.removeGroupMember(group, account);
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * Append the entry saying how far a failed change got, and report it.
 *
 * @param {SharePointClient} client
 * @param {{
 *   account: string, targetName: string, action: 'grant' | 'revoke', role: string, caseType: string,
 *   recordedId: string, applied: string[], failedGroup: string, status: number,
 *   change: (group: string) => { field: string, before: boolean, after: boolean },
 * }} failure
 * @returns {Promise<AccessChangeResult>}
 */
async function followUp(client, failure) {
  const { recordedId, applied, failedGroup, status, change, ...subject } =
    failure;
  /** @type {AccessLogOutcome} */
  const outcome = applied.length === 0 ? 'not-applied' : 'partly-applied';
  const message =
    outcome === 'not-applied'
      ? `Could not change ${failedGroup} (status ${status}), so nothing was changed.`
      : `Could not change ${failedGroup} (status ${status}); only part of the change was made.`;
  try {
    await client.addAccessLogEntry({
      ...subject,
      reason: message,
      changes: applied.map(change),
      outcome,
      relatesTo: recordedId,
    });
  } catch {
    return {
      ok: false,
      outcome,
      message: `${message} The access log could not record that.`,
    };
  }
  return { ok: false, outcome, message };
}
