// @ts-check
import {
  planGrant,
  planRevoke,
  roleHolders,
  roleTitle,
} from './access-roles.js';
import {
  USER_ROLES_LIST_NAME,
  isRoleEntry,
  roleEntries,
} from './user-roles.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').AccessLogOutcome} AccessLogOutcome */
/** @typedef {import('./access-roles.js').RoleRef} RoleRef */
/** @typedef {import('./access-roles.js').CaseTypeRef} CaseTypeRef */
/** @typedef {import('../sharepoint-client.js').PersonResult} PersonResult */

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
 * Everything a person holds that a role can be made of: their groups and the
 * role entries of their `CoraUserRoles` row, as one list.
 *
 * @param {Pick<SharePointClient, 'listUserGroups' | 'getUserRoles'>} client
 * @param {string} account
 * @returns {Promise<string[]>}
 */
export async function readHeldParts(client, account) {
  const [groups, roles] = await Promise.all([
    client.listUserGroups(account),
    client.getUserRoles(account),
  ]);
  return [...groups, ...roleEntries(roles)];
}

/**
 * The people who hold a role, through its old group or their roles row alike,
 * each once however many of the two name them.
 *
 * @param {Pick<SharePointClient, 'listGroupMembers' | 'listRoleHolders'>} client
 * @param {RoleRef} role
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {Promise<PersonResult[]>}
 */
export async function readRoleHolders(client, role, caseTypes) {
  const reads = await Promise.all(
    roleHolders(role, caseTypes).map((part) =>
      isRoleEntry(part)
        ? client.listRoleHolders(part)
        : client.listGroupMembers(part)
    )
  );
  /** @type {Map<string, PersonResult>} */
  const byAccount = new Map();
  for (const person of reads.flat()) {
    const key = person.loginName.toLowerCase();
    if (!byAccount.has(key)) byAccount.set(key, person);
  }
  return [...byAccount.values()];
}

/**
 * Log a role change, apply it, and log how far it got if a part failed. The
 * row's entries are one write, made first; the groups follow one by one.
 *
 * @param {SharePointClient} client
 * @param {{ action: 'grant' | 'revoke', role: RoleRef, account: string, targetName: string, reason: string }} request
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {Promise<AccessChangeResult>}
 */
export async function runAccessChange(client, request, caseTypes) {
  const { action, role, account, targetName, reason } = request;

  // The plan is worked out from what they hold now, not from what the page last showed.
  /** @type {string[]} */
  let current;
  try {
    current = await readHeldParts(client, account);
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
  const entries = plan.groups.filter(isRoleEntry);
  const groups = plan.groups.filter((part) => !isRoleEntry(part));

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
      changes: [...entries, ...groups].map(change),
      outcome: 'recorded',
      relatesTo: null,
    });
  } catch {
    return refused('Nothing was changed: the access log could not be written.');
  }

  /** @type {string[]} */
  const applied = [];
  if (entries.length > 0) {
    const result = await writeRoles(client, action, entries, account);
    if (!result.ok) {
      return followUp(client, {
        ...subject,
        recordedId,
        applied,
        failedGroup: `their ${USER_ROLES_LIST_NAME} row`,
        status: result.status,
        change,
      });
    }
    applied.push(...entries);
  }
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
 * The row write, with a thrown failure treated as a status of zero.
 *
 * @param {SharePointClient} client
 * @param {'grant' | 'revoke'} action
 * @param {string[]} entries
 * @param {string} account
 * @returns {Promise<import('../sharepoint-client.js').GroupMemberWrite>}
 */
async function writeRoles(client, action, entries, account) {
  try {
    return await client.updateUserRoles(
      account,
      action === 'grant' ? { add: entries } : { remove: entries }
    );
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
