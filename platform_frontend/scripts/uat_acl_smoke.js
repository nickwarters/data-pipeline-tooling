// @ts-check

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ACCEPT_JSON = 'application/json;odata=nometadata';
const DEFAULT_DENIED_STATUSES = [401, 403, 404];
const DEFAULT_TIMEOUT_MS = 10_000;

// SP.PermissionKind values are bit positions in the Low half of the
// BasePermissions mask: addListItems=2, editListItems=3, deleteListItems=4.
const WRITE_PERMISSION_MASKS = {
  add: 1n << 1n,
  edit: 1n << 2n,
  delete: 1n << 3n,
};

/** @typedef {'allow' | 'deny'} AccessExpectation */
/**
 * @typedef {{
 *   listName: string,
 *   read: AccessExpectation,
 *   write: AccessExpectation
 * }} ListExpectation
 */
/**
 * @typedef {{
 *   name: string,
 *   headersFileEnv: string,
 *   expectations: ListExpectation[]
 * }} Persona
 */
/**
 * @typedef {{
 *   siteUrl: string,
 *   requiredListPrefix?: string,
 *   deniedStatuses?: number[],
 *   timeoutMs?: number,
 *   personas: Persona[]
 * }} UatAclConfig
 */
/**
 * @typedef {{
 *   persona: string,
 *   listName: string,
 *   ok: boolean,
 *   message: string
 * }} AclResult
 */
/** @typedef {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} FetchImpl */

/** @param {unknown} value @param {string} message */
function requireCondition(value, message) {
  if (!value) throw new Error(`Invalid UAT ACL config: ${message}`);
}

/**
 * Validate the persona matrix before making any request. Every list must have a
 * positive read control, a denied reader, and a read-only persona. The positive
 * control prevents a misspelled/missing list from making denial checks green.
 *
 * @param {unknown} raw
 * @returns {UatAclConfig}
 */
export function validateConfig(raw) {
  requireCondition(raw && typeof raw === 'object', 'expected a JSON object.');
  const config = /** @type {UatAclConfig} */ (raw);
  requireCondition(
    typeof config.siteUrl === 'string' && /^https:\/\//.test(config.siteUrl),
    'siteUrl must be an HTTPS URL.'
  );
  requireCondition(
    Array.isArray(config.personas) && config.personas.length > 0,
    'personas must contain at least one persona.'
  );

  const requiredListPrefix = config.requiredListPrefix ?? 'uat_';
  requireCondition(
    typeof requiredListPrefix === 'string' && requiredListPrefix.length > 0,
    'requiredListPrefix must be a non-empty string.'
  );
  const deniedStatuses = config.deniedStatuses ?? DEFAULT_DENIED_STATUSES;
  requireCondition(
    Array.isArray(deniedStatuses) &&
      deniedStatuses.length > 0 &&
      deniedStatuses.every(
        (status) => Number.isInteger(status) && status >= 400 && status < 500
      ),
    'deniedStatuses must contain 4xx HTTP status codes.'
  );
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  requireCondition(
    Number.isInteger(timeoutMs) && timeoutMs > 0,
    'timeoutMs must be a positive integer.'
  );

  const personaNames = new Set();
  /** @type {Map<string, ListExpectation[]>} */
  const byList = new Map();
  for (const persona of config.personas) {
    requireCondition(
      persona && typeof persona.name === 'string' && persona.name.length > 0,
      'every persona requires a name.'
    );
    requireCondition(
      !personaNames.has(persona.name),
      `persona name "${persona.name}" is duplicated.`
    );
    personaNames.add(persona.name);
    requireCondition(
      typeof persona.headersFileEnv === 'string' &&
        /^[A-Z][A-Z0-9_]*$/.test(persona.headersFileEnv),
      `persona "${persona.name}" requires an uppercase headersFileEnv name.`
    );
    requireCondition(
      Array.isArray(persona.expectations) && persona.expectations.length > 0,
      `persona "${persona.name}" requires at least one expectation.`
    );

    const personaLists = new Set();
    for (const expectation of persona.expectations) {
      requireCondition(
        typeof expectation.listName === 'string' &&
          expectation.listName.startsWith(requiredListPrefix),
        `list "${expectation.listName}" must start with "${requiredListPrefix}".`
      );
      requireCondition(
        !personaLists.has(expectation.listName),
        `persona "${persona.name}" repeats list "${expectation.listName}".`
      );
      personaLists.add(expectation.listName);
      requireCondition(
        expectation.read === 'allow' || expectation.read === 'deny',
        `read expectation for "${expectation.listName}" must be allow or deny.`
      );
      requireCondition(
        expectation.write === 'allow' || expectation.write === 'deny',
        `write expectation for "${expectation.listName}" must be allow or deny.`
      );
      requireCondition(
        expectation.read === 'allow' || expectation.write === 'deny',
        `list "${expectation.listName}" cannot allow write while denying read.`
      );
      const listExpectations = byList.get(expectation.listName) ?? [];
      listExpectations.push(expectation);
      byList.set(expectation.listName, listExpectations);
    }
  }

  for (const [listName, expectations] of byList) {
    requireCondition(
      expectations.some(({ read }) => read === 'allow'),
      `list "${listName}" requires an allowed reader as a positive control.`
    );
    requireCondition(
      expectations.some(({ read }) => read === 'deny'),
      `list "${listName}" requires a denied reader.`
    );
    requireCondition(
      expectations.some(
        ({ read, write }) => read === 'allow' && write === 'deny'
      ),
      `list "${listName}" requires a read-allowed, write-denied persona.`
    );
  }

  return {
    ...config,
    siteUrl: config.siteUrl.replace(/\/+$/, ''),
    requiredListPrefix,
    deniedStatuses,
    timeoutMs,
  };
}

/** @param {string} listName */
function encodedListName(listName) {
  return encodeURIComponent(listName.replaceAll("'", "''")).replace(
    /'/g,
    '%27'
  );
}

/** @param {string} siteUrl @param {string} listName */
export function listReadUrl(siteUrl, listName) {
  return `${siteUrl}/_api/web/lists/getbytitle('${encodedListName(listName)}')/items?$select=Id&$top=1`;
}

/** @param {string} siteUrl @param {string} listName */
export function listPermissionsUrl(siteUrl, listName) {
  return `${siteUrl}/_api/web/lists/getbytitle('${encodedListName(listName)}')?$select=EffectiveBasePermissions`;
}

/** @param {unknown} raw */
function parseHeaders(raw) {
  requireCondition(
    raw && typeof raw === 'object' && !Array.isArray(raw),
    'a persona headers file must contain a JSON object.'
  );
  const entries = Object.entries(/** @type {Record<string, unknown>} */ (raw));
  requireCondition(
    entries.length > 0,
    'a persona headers file cannot be empty.'
  );
  requireCondition(
    entries.every(
      ([name, value]) => name.length > 0 && typeof value === 'string'
    ),
    'persona header names and values must be strings.'
  );
  return Object.fromEntries(
    entries.map(([name, value]) => [name, /** @type {string} */ (value)])
  );
}

/** @param {string} envName @param {NodeJS.ProcessEnv} env */
async function loadPersonaHeaders(envName, env) {
  const path = env[envName];
  if (!path) {
    throw new Error(
      `Missing ${envName}; set it to a JSON headers file for this persona.`
    );
  }
  const source = await readFile(resolve(path), 'utf8');
  return parseHeaders(JSON.parse(source));
}

/** @param {unknown} payload */
export function effectivePermissions(payload) {
  const record = /** @type {Record<string, any>} */ (payload ?? {});
  const permissions =
    record.EffectiveBasePermissions ?? record.d?.EffectiveBasePermissions;
  if (!permissions || permissions.Low === undefined) {
    throw new Error('SharePoint did not return EffectiveBasePermissions.Low.');
  }
  try {
    return BigInt.asUintN(32, BigInt(String(permissions.Low)));
  } catch {
    throw new Error('SharePoint returned an invalid permission mask.');
  }
}

/** @param {bigint} low */
export function writePermissions(low) {
  return {
    add: (low & WRITE_PERMISSION_MASKS.add) !== 0n,
    edit: (low & WRITE_PERMISSION_MASKS.edit) !== 0n,
    delete: (low & WRITE_PERMISSION_MASKS.delete) !== 0n,
  };
}

/**
 * @param {UatAclConfig} config
 * @param {Persona} persona
 * @param {ListExpectation} expectation
 * @param {Record<string, string>} headers
 * @param {FetchImpl} fetchImpl
 * @returns {Promise<AclResult>}
 */
async function checkExpectation(
  config,
  persona,
  expectation,
  headers,
  fetchImpl
) {
  const requestHeaders = { Accept: ACCEPT_JSON, ...headers };
  const requestInit = {
    headers: requestHeaders,
    redirect: /** @type {'manual'} */ ('manual'),
    signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  };
  const readResponse = await fetchImpl(
    listReadUrl(config.siteUrl, expectation.listName),
    requestInit
  );

  if (expectation.read === 'deny') {
    const deniedStatuses = config.deniedStatuses ?? DEFAULT_DENIED_STATUSES;
    const ok = deniedStatuses.includes(readResponse.status);
    return {
      persona: persona.name,
      listName: expectation.listName,
      ok,
      message: ok
        ? `read denied with HTTP ${readResponse.status}; list-level denial also blocks write`
        : `expected read denial, received HTTP ${readResponse.status}`,
    };
  }

  if (!readResponse.ok) {
    return {
      persona: persona.name,
      listName: expectation.listName,
      ok: false,
      message: `expected read access, received HTTP ${readResponse.status}`,
    };
  }

  const permissionResponse = await fetchImpl(
    listPermissionsUrl(config.siteUrl, expectation.listName),
    requestInit
  );
  if (!permissionResponse.ok) {
    return {
      persona: persona.name,
      listName: expectation.listName,
      ok: false,
      message: `could not read effective permissions (HTTP ${permissionResponse.status})`,
    };
  }

  const permissions = writePermissions(
    effectivePermissions(await permissionResponse.json())
  );
  const anyWrite = permissions.add || permissions.edit || permissions.delete;
  const expectedWrite = expectation.write === 'allow';
  const ok = expectedWrite ? permissions.add && permissions.edit : !anyWrite;
  const granted = Object.entries(permissions)
    .filter(([, allowed]) => allowed)
    .map(([name]) => name)
    .join(', ');

  return {
    persona: persona.name,
    listName: expectation.listName,
    ok,
    message: ok
      ? `read allowed; write ${expectation.write} confirmed`
      : expectedWrite
        ? `expected add and edit permissions; granted: ${granted || 'none'}`
        : `expected no write permissions; granted: ${granted}`,
  };
}

/**
 * Run every configured persona/list check and return all results so an operator
 * sees the complete ACL drift in one release-gate run.
 *
 * @param {unknown} rawConfig
 * @param {{ fetchImpl?: FetchImpl, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<AclResult[]>}
 */
export async function runAclSmoke(rawConfig, options = {}) {
  const config = validateConfig(rawConfig);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const env = options.env ?? process.env;
  /** @type {AclResult[]} */
  const results = [];

  for (const persona of config.personas) {
    const headers = await loadPersonaHeaders(persona.headersFileEnv, env);
    for (const expectation of persona.expectations) {
      try {
        results.push(
          await checkExpectation(
            config,
            persona,
            expectation,
            headers,
            fetchImpl
          )
        );
      } catch (error) {
        results.push({
          persona: persona.name,
          listName: expectation.listName,
          ok: false,
          message:
            error instanceof Error ? error.message : 'unexpected check failure',
        });
      }
    }
  }
  return results;
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    throw new Error(
      'Usage: npm run test:security:uat -- <path-to-uat-acl-config.json>'
    );
  }
  const raw = JSON.parse(await readFile(resolve(configPath), 'utf8'));
  const results = await runAclSmoke(raw);
  for (const result of results) {
    const marker = result.ok ? 'PASS' : 'FAIL';
    console.log(
      `${marker} | ${result.persona} | ${result.listName} | ${result.message}`
    );
  }
  if (results.some(({ ok }) => !ok)) process.exitCode = 1;
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
