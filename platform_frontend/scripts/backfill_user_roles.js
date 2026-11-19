// @ts-check
/**
 * Fill `CoraUserRoles` and the new Case list groups from the legacy groups.
 *
 *   node scripts/backfill_user_roles.js <config.json>          # print the plan, change nothing
 *   node scripts/backfill_user_roles.js <config.json> --apply  # make the changes it prints
 *
 * The config names the site and the environment variable that holds a JSON
 * headers file for an account in `CORA Owner Delegates`, the same convention
 * as the UAT ACL smoke: `{ "siteUrl": "https://…", "headersFileEnv": "…" }`.
 *
 * It only ever adds. Every legacy group's members are read, translated by
 * `translateLegacyGroups`, and compared with the row and the new groups as
 * they stand, so a second run after a clean `--apply` plans nothing, which is
 * the check that the backfill is complete. Nobody loses anything here; the
 * legacy groups are left exactly as they were.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CASE_TYPES } from '../case-types/manifest.js';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import {
  legacyGroups,
  translateLegacyGroups,
} from '../src/services/legacy-groups.js';
import { roleEntries } from '../src/services/user-roles.js';

/** @typedef {import('../src/sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {{ slug: string, displayName: string }} CaseTypeRef */

/**
 * What one person is missing: the role entries their row lacks and the new groups they are not in yet.
 *
 * @typedef {{ account: string, displayName: string, entries: string[], groups: string[] }} BackfillStep
 */

/**
 * @typedef {{ account: string, kind: 'row' | 'group', target: string, ok: boolean, status?: number }} BackfillWrite
 */

/**
 * Work out what the new model is missing for everybody in a legacy group.
 *
 * @param {Pick<SharePointClient, 'listGroupMembers' | 'getUserRoles'>} client
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {Promise<BackfillStep[]>}
 */
export async function planBackfill(client, caseTypes) {
  /** @type {Map<string, { displayName: string, groups: string[] }>} */
  const people = new Map();
  for (const { group } of legacyGroups(caseTypes)) {
    for (const member of await client.listGroupMembers(group)) {
      const key = member.loginName.toLowerCase();
      const person = people.get(key) ?? {
        displayName: member.displayName,
        groups: [],
      };
      person.groups.push(group);
      people.set(key, person);
    }
  }

  /** @type {Map<string, Set<string>>} */
  const membersOf = new Map();
  /** @param {string} group */
  const membersOfGroup = async (group) => {
    const known = membersOf.get(group);
    if (known) return known;
    const members = new Set(
      (await client.listGroupMembers(group)).map(({ loginName }) =>
        loginName.toLowerCase()
      )
    );
    membersOf.set(group, members);
    return members;
  };

  /** @type {BackfillStep[]} */
  const steps = [];
  for (const [account, person] of [...people].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const target = translateLegacyGroups(person.groups, caseTypes);
    const held = roleEntries(await client.getUserRoles(account));
    const entries = target.entries.filter((entry) => !held.includes(entry));
    /** @type {string[]} */
    const groups = [];
    for (const group of target.accessGroups) {
      if (!(await membersOfGroup(group)).has(account)) groups.push(group);
    }
    if (entries.length > 0 || groups.length > 0) {
      steps.push({ account, displayName: person.displayName, entries, groups });
    }
  }
  return steps;
}

/**
 * Make every planned change, the row before the groups for each person, and report each write.
 *
 * @param {Pick<SharePointClient, 'updateUserRoles' | 'addGroupMember'>} client
 * @param {readonly BackfillStep[]} steps
 * @returns {Promise<BackfillWrite[]>}
 */
export async function applyBackfill(client, steps) {
  /** @type {BackfillWrite[]} */
  const writes = [];
  for (const { account, entries, groups } of steps) {
    if (entries.length > 0) {
      const result = await client.updateUserRoles(account, { add: entries });
      writes.push({
        account,
        kind: 'row',
        target: entries.join(', '),
        ...result,
      });
    }
    for (const group of groups) {
      const result = await client.addGroupMember(group, account);
      writes.push({ account, kind: 'group', target: group, ...result });
    }
  }
  return writes;
}

/**
 * The plan as lines an operator reads before running it with `--apply`.
 *
 * @param {readonly BackfillStep[]} steps
 * @returns {string[]}
 */
export function describePlan(steps) {
  if (steps.length === 0) {
    return ['Nothing to do: every legacy role is already in the new model.'];
  }
  return [
    ...steps.flatMap(({ account, displayName, entries, groups }) => [
      `${displayName} (${account})`,
      ...entries.map((entry) => `  row   + ${entry}`),
      ...groups.map((group) => `  group + ${group}`),
    ]),
    '',
    `${steps.length} person(s) to change.`,
    'Members granted through a nested AD group are not listed by SharePoint, ' +
      'so add those AD groups to the new groups by hand.',
  ];
}

/** @param {unknown} raw */
function validateConfig(raw) {
  const config = /** @type {Record<string, unknown>} */ (raw ?? {});
  if (
    typeof config.siteUrl !== 'string' ||
    !/^https:\/\//.test(config.siteUrl)
  ) {
    throw new Error('Invalid backfill config: siteUrl must be an HTTPS URL.');
  }
  if (
    typeof config.headersFileEnv !== 'string' ||
    !/^[A-Z][A-Z0-9_]*$/.test(config.headersFileEnv)
  ) {
    throw new Error(
      'Invalid backfill config: headersFileEnv must name an uppercase environment variable.'
    );
  }
  return {
    siteUrl: config.siteUrl.replace(/\/+$/, ''),
    headersFileEnv: config.headersFileEnv,
  };
}

/**
 * A client that sends the operator's headers on every request.
 *
 * @param {unknown} rawConfig
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<HttpSharePointClient>}
 */
export async function backfillClient(rawConfig, options = {}) {
  const { siteUrl, headersFileEnv } = validateConfig(rawConfig);
  const env = options.env ?? process.env;
  const path = env[headersFileEnv];
  if (!path) {
    throw new Error(
      `Missing ${headersFileEnv}; set it to a JSON headers file for a CORA Owner Delegates account.`
    );
  }
  const headers = JSON.parse(await readFile(resolve(path), 'utf8'));
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return new HttpSharePointClient({
    webUrl: siteUrl,
    fetchImpl: (input, init = {}) =>
      fetchImpl(input, {
        ...init,
        headers: {
          .../** @type {Record<string, string>} */ (init.headers),
          ...headers,
        },
      }),
  });
}

async function main() {
  const [configPath, flag] = process.argv.slice(2);
  if (!configPath || (flag !== undefined && flag !== '--apply')) {
    throw new Error(
      'Usage: node scripts/backfill_user_roles.js <config.json> [--apply]'
    );
  }
  const client = await backfillClient(
    JSON.parse(await readFile(resolve(configPath), 'utf8'))
  );
  const steps = await planBackfill(client, CASE_TYPES);
  for (const line of describePlan(steps)) console.log(line);
  if (flag !== '--apply' || steps.length === 0) return;

  const writes = await applyBackfill(client, steps);
  for (const write of writes) {
    console.log(
      `${write.ok ? 'DONE' : `FAIL ${write.status}`} | ${write.account} | ${write.kind} | ${write.target}`
    );
  }
  if (writes.some(({ ok }) => !ok)) process.exitCode = 1;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
