#!/usr/bin/env node
// @ts-check
/**
 * Check, against a real non-production Form list, that each persona is
 * offered exactly what the Forms access rule promises: which Forms the
 * dashboard lists for them, which they can open, and which they can edit.
 *
 *   npm run test:security:uat:forms -- <path-to-config.json>
 *
 * The ACL smoke check (`uat_acl_smoke.js`) proves what SharePoint will serve a
 * persona. This one proves what the application then shows them, because on a
 * Form list the two differ: every member of the list's access group can read
 * every Form on it, and the JavaScript gate is what narrows that to the Forms a
 * person is on. It reads only, through the same client and the same rule the
 * page uses, so a pass means the deployed code and the provisioned list agree.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { APP_CONFIG } from '../src/app-config.js';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import { formAccess } from '../src/services/form-access.js';
import { resolveCapabilities } from '../src/services/permissions.js';
import { formRows } from '../src/pages/forms/forms-model.js';
import { toLocalDateKey } from '../src/lib/local-calendar.js';
import { loadPersonaHeaders } from './uat_acl_smoke.js';

/** @typedef {import('../form-types/contract.js').FormTypeDefinition} FormTypeDefinition */
/** @typedef {import('../src/sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} FetchImpl */

/** What the check compares for each persona, in the order it reports them. */
const ASPECTS = /** @type {const} */ (['lists', 'opens', 'edits']);

/**
 * @typedef {{
 *   name: string,
 *   headersFileEnv: string,
 *   lists: string[],
 *   opens: string[],
 *   edits: string[]
 * }} FormsPersona
 */
/**
 * @typedef {{
 *   siteUrl: string,
 *   listPrefix: string,
 *   formType: string,
 *   forms: string[],
 *   personas: FormsPersona[]
 * }} FormsAccessConfig
 */
/**
 * @typedef {{
 *   persona: string,
 *   aspect: string,
 *   ok: boolean,
 *   message: string
 * }} FormsAccessResult
 */

/** @param {unknown} value @param {string} message */
function requireCondition(value, message) {
  if (!value) throw new Error(`Invalid UAT Forms access config: ${message}`);
}

/** @param {unknown} ids */
const isIdList = (ids) =>
  Array.isArray(ids) &&
  ids.every((id) => typeof id === 'string' && id.length > 0);

/**
 * Validate the matrix before any request is made. Each Form in it must be
 * opened by one persona and refused to another, and the matrix must hold an
 * editor and a persona who may read a Form but not change it, so a misspelt id
 * or a list nobody can reach cannot make every check pass by matching nothing.
 *
 * @param {unknown} raw
 * @param {readonly FormTypeDefinition[]} formTypes
 * @returns {FormsAccessConfig}
 */
export function validateFormsConfig(raw, formTypes) {
  requireCondition(raw && typeof raw === 'object', 'expected a JSON object.');
  const config = /** @type {FormsAccessConfig} */ (raw);
  requireCondition(
    typeof config.siteUrl === 'string' && /^https:\/\//.test(config.siteUrl),
    'siteUrl must be an HTTPS URL.'
  );
  // Required and non-empty: this reads real Forms as each persona, and is never
  // pointed at production.
  requireCondition(
    typeof config.listPrefix === 'string' && config.listPrefix.length > 0,
    'listPrefix must name a non-production environment, such as "uat_".'
  );
  requireCondition(
    formTypes.some((formType) => formType.slug === config.formType),
    `formType "${config.formType}" is not a composed Form Type.`
  );
  requireCondition(
    isIdList(config.forms) && config.forms.length > 0,
    'forms must list at least one Form id.'
  );
  const forms = new Set(config.forms);
  requireCondition(forms.size === config.forms.length, 'forms repeats an id.');
  requireCondition(
    Array.isArray(config.personas) && config.personas.length > 0,
    'personas must contain at least one persona.'
  );

  const names = new Set();
  for (const persona of config.personas) {
    requireCondition(
      persona && typeof persona.name === 'string' && persona.name.length > 0,
      'every persona requires a name.'
    );
    requireCondition(
      !names.has(persona.name),
      `persona name "${persona.name}" is duplicated.`
    );
    names.add(persona.name);
    requireCondition(
      typeof persona.headersFileEnv === 'string' &&
        /^[A-Z][A-Z0-9_]*$/.test(persona.headersFileEnv),
      `persona "${persona.name}" requires an uppercase headersFileEnv name.`
    );
    for (const aspect of ASPECTS) {
      requireCondition(
        isIdList(persona[aspect]) &&
          persona[aspect].every((id) => forms.has(id)),
        `persona "${persona.name}" ${aspect} must list ids from forms.`
      );
    }
    for (const aspect of /** @type {const} */ (['lists', 'edits'])) {
      requireCondition(
        persona[aspect].every((id) => persona.opens.includes(id)),
        `persona "${persona.name}" ${aspect} a Form it cannot open.`
      );
    }
  }

  for (const id of forms) {
    requireCondition(
      config.personas.some((persona) => persona.opens.includes(id)),
      `Form ${id} requires a persona who opens it, as a positive control.`
    );
    requireCondition(
      config.personas.some((persona) => !persona.opens.includes(id)),
      `Form ${id} requires a persona it is refused to.`
    );
  }
  requireCondition(
    config.personas.some((persona) => persona.edits.length > 0),
    'the matrix requires a persona who edits a Form.'
  );
  requireCondition(
    config.personas.some((persona) =>
      persona.opens.some((id) => !persona.edits.includes(id))
    ),
    'the matrix requires a persona who reads a Form without editing it.'
  );

  return { ...config, siteUrl: config.siteUrl.replace(/\/+$/, '') };
}

/**
 * What the application offers one signed-in person: the Forms its dashboard
 * lists for them, and of the matrix's Forms, those it opens and lets them edit.
 *
 * @param {SharePointClient} client signed in as the persona
 * @param {FormTypeDefinition} formType
 * @param {readonly string[]} forms
 * @param {Date} now
 * @returns {Promise<Record<(typeof ASPECTS)[number], string[]>>}
 */
export async function offeredTo(client, formType, forms, now) {
  // The user first: it is the read that tells the client who "me" is, so the
  // dashboard's filter resolves without looking the person up.
  const me = await client.getCurrentUser();
  const caps = resolveCapabilities(await client.getCurrentUserGroups());
  if (!caps.canAccessForms) return { lists: [], opens: [], edits: [] };

  const today = /** @type {string} */ (toLocalDateKey(now));
  const mine = await client.listFormItems(formType, {
    filter: { involving: me.id, closed: false },
  });
  const listed = new Set(
    formRows([{ formType, items: mine.items }], me.id, caps, today).map(
      (row) => row.item.id
    )
  );

  /** @type {string[]} */
  const opens = [];
  /** @type {string[]} */
  const edits = [];
  for (const id of forms) {
    const item = await client.getFormItem(formType, id);
    if (!item) continue;
    const access = formAccess(item, me.id, caps);
    if (access.canRead) opens.push(id);
    if (access.canEdit) edits.push(id);
  }
  return {
    lists: forms.filter((id) => listed.has(id)),
    opens,
    edits,
  };
}

/** @param {readonly string[]} ids */
const shown = (ids) => (ids.length ? ids.join(', ') : 'none');

/**
 * A client that reads as the persona whose headers it is given.
 *
 * @param {FormsAccessConfig} config
 * @param {Record<string, string>} headers
 * @param {FetchImpl} fetchImpl
 * @returns {SharePointClient}
 */
function personaClient(config, headers, fetchImpl) {
  return /** @type {SharePointClient} */ (
    /** @type {unknown} */ (
      new HttpSharePointClient({
        webUrl: config.siteUrl,
        listPrefix: config.listPrefix,
        fetchImpl: (input, init = {}) =>
          fetchImpl(input, {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init.headers)),
              ...headers,
            },
          }),
      })
    )
  );
}

/**
 * Run every persona's check and return every result, so one run shows all of
 * the drift rather than the first of it.
 *
 * @param {unknown} rawConfig
 * @param {{
 *   formTypes?: readonly FormTypeDefinition[],
 *   clientFor?: (persona: FormsPersona) => Promise<SharePointClient>,
 *   fetchImpl?: FetchImpl,
 *   env?: NodeJS.ProcessEnv,
 *   now?: () => Date
 * }} [options]
 * @returns {Promise<FormsAccessResult[]>}
 */
export async function runFormsAccessCheck(rawConfig, options = {}) {
  const formTypes = options.formTypes ?? APP_CONFIG.formTypes;
  const config = validateFormsConfig(rawConfig, formTypes);
  const formType = /** @type {FormTypeDefinition} */ (
    formTypes.find((each) => each.slug === config.formType)
  );
  const now = options.now ?? (() => new Date());
  const fetchImpl =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const env = options.env ?? process.env;
  const clientFor =
    options.clientFor ??
    (async (/** @type {FormsPersona} */ persona) =>
      personaClient(
        config,
        await loadPersonaHeaders(persona.headersFileEnv, env),
        fetchImpl
      ));

  /** @type {FormsAccessResult[]} */
  const results = [];
  for (const persona of config.personas) {
    try {
      const offered = await offeredTo(
        await clientFor(persona),
        formType,
        config.forms,
        now()
      );
      for (const aspect of ASPECTS) {
        const expected = config.forms.filter((id) =>
          persona[aspect].includes(id)
        );
        const ok = shown(expected) === shown(offered[aspect]);
        results.push({
          persona: persona.name,
          aspect,
          ok,
          message: ok
            ? shown(expected)
            : `expected ${shown(expected)}, offered ${shown(offered[aspect])}`,
        });
      }
    } catch (error) {
      results.push({
        persona: persona.name,
        aspect: 'read',
        ok: false,
        message:
          error instanceof Error ? error.message : 'unexpected check failure',
      });
    }
  }
  return results;
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    throw new Error(
      'Usage: npm run test:security:uat:forms -- <path-to-config.json>'
    );
  }
  const raw = JSON.parse(await readFile(resolve(configPath), 'utf8'));
  const results = await runFormsAccessCheck(raw);
  for (const result of results) {
    const marker = result.ok ? 'PASS' : 'FAIL';
    console.log(
      `${marker} | ${result.persona} | ${result.aspect} | ${result.message}`
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
