// @ts-check
/**
 * How a Form's free text is stored: UTF-8-safe base64, so it is not readable
 * at a glance in the list.
 *
 * This is **not** encryption and **not** a permission boundary. Anyone who can
 * read the list can decode a value with one line in a browser console; there is
 * no key. What it buys is that a person opening the list, an export or a list
 * view over someone's shoulder does not read a 1-to-1 by accident.
 *
 * Plain `btoa` throws on any character outside Latin-1 (`£` typed as two
 * bytes, an emoji, a smart quote pasted from Word), so text is turned into its
 * UTF-8 bytes first and those bytes are what is encoded. `btoa` and `atob` are
 * only ever handed one character per byte, which they handle the same way in
 * every browser and in Node.
 *
 * Which columns are encoded is decided by the field type, through
 * `formColumns()`, never by a flag on the field. Only the data layer calls this
 * module; a view only ever sees plain values.
 *
 * The encoded form is a stored contract once real Forms exist: changing it
 * means migrating every stored value.
 */

import { formColumns } from '../../form-types/contract.js';

/** @typedef {import('../../form-types/contract.js').FormTypeDefinition} FormTypeDefinition */
/** @typedef {import('../sharepoint-client.js').FormAction} FormAction */

/** Most Form Actions a Form may hold, the same for every Form Type. */
export const MAX_FORM_ACTIONS = 3;

/** The keys every Form Action carries, each a string. */
const FORM_ACTION_KEYS = ['title', 'dueDate', 'status', 'details'];

/**
 * Bytes per call to `String.fromCharCode`, kept well under the engine's
 * argument limit so a long answer cannot overflow the call stack.
 */
const CHUNK = 0x8000;

const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Encode text for storage. Empty text is stored as nothing, so clearing a
 * field clears the column rather than storing the encoding of an empty string.
 *
 * @param {string | null | undefined} text
 * @returns {string | null}
 */
export function encodeText(text) {
  if (text === null || text === undefined || text === '') return null;
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Decode a stored value.
 *
 * A value that is not this module's encoding (a row edited by hand in the
 * list, say) is handed back as it is, flagged, rather than thrown: throwing
 * would blank the whole Form over one field, and the raw text is still what
 * the list holds.
 *
 * @param {unknown} stored
 * @returns {{ ok: true, value: string } | { ok: false, value: string }}
 */
export function decodeText(stored) {
  if (stored === null || stored === undefined || stored === '') {
    return { ok: true, value: '' };
  }
  const raw = String(stored);
  if (!BASE64.test(raw)) return { ok: false, value: raw };
  try {
    const binary = atob(raw);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return {
      ok: true,
      value: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    };
  } catch {
    // Valid base64 that is not UTF-8, which is what plain text that happens
    // to look like base64 ("Done", "test") decodes to.
    return { ok: false, value: raw };
  }
}

/**
 * Why a value cannot be a Form's Actions, or `null` when it can.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function formActionsProblem(value) {
  if (!Array.isArray(value)) return 'is not a list of Form Actions';
  if (value.length > MAX_FORM_ACTIONS) {
    return `holds ${value.length} Form Actions, more than ${MAX_FORM_ACTIONS}`;
  }
  for (const [index, action] of value.entries()) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      return `Form Action ${index + 1} is not an object`;
    }
    for (const key of FORM_ACTION_KEYS) {
      const field = /** @type {Record<string, unknown>} */ (action)[key];
      if (typeof field !== 'string') {
        return `Form Action ${index + 1} has no text \`${key}\``;
      }
    }
  }
  return null;
}

/**
 * The columns of a definition that hold its Form Actions.
 *
 * @param {FormTypeDefinition} definition
 * @returns {Set<string>}
 */
function actionColumns(definition) {
  return new Set(
    definition.sections.flatMap((section) =>
      section.sectionType === 'actions' ? [section.itemField] : []
    )
  );
}

/**
 * The values to store for a write, with every encoded column encoded and every
 * plain one passed through untouched. Only the columns present in `fields` are
 * returned, because a write is field-level.
 *
 * Form Actions are checked before they are stored: a fourth Action, or one
 * missing a key, is a bug in the caller, and storing it would hand every later
 * reader a blob it has to refuse.
 *
 * @param {FormTypeDefinition} definition
 * @param {Record<string, unknown>} fields
 * @returns {Record<string, unknown>}
 */
export function encodeFields(definition, fields) {
  const encoded = new Set(formColumns(definition).encoded);
  const actions = actionColumns(definition);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [column, value] of Object.entries(fields)) {
    if (!encoded.has(column)) {
      out[column] = value;
    } else if (actions.has(column)) {
      const list = value ?? [];
      const problem = formActionsProblem(list);
      if (problem) throw new Error(`The ${column} column ${problem}`);
      out[column] = /** @type {unknown[]} */ (list).length
        ? encodeText(JSON.stringify(list))
        : null;
    } else {
      out[column] = encodeText(
        value === null || value === undefined ? '' : String(value)
      );
    }
  }
  return out;
}

/**
 * @typedef {{ column: string, problem: string, raw: string }} FormDecodeProblem
 */

/**
 * The plain values of a stored item, every encoded column decoded and every
 * other column passed through untouched.
 *
 * A column that does not decode is reported in `problems` and never thrown, so
 * one bad value never blanks the rest of the Form. Undecodable text comes back
 * as the raw stored value; undecodable Actions come back as none, because a
 * half-read list of Actions is not something an editor can safely show.
 *
 * @param {FormTypeDefinition} definition
 * @param {Record<string, unknown>} item
 * @returns {{ fields: Record<string, unknown>, problems: FormDecodeProblem[] }}
 */
export function decodeFields(definition, item) {
  const encoded = new Set(formColumns(definition).encoded);
  const actions = actionColumns(definition);
  /** @type {Record<string, unknown>} */
  const fields = {};
  /** @type {FormDecodeProblem[]} */
  const problems = [];
  for (const [column, stored] of Object.entries(item)) {
    if (!encoded.has(column)) {
      fields[column] = stored;
      continue;
    }
    const text = decodeText(stored);
    if (!actions.has(column)) {
      fields[column] = text.value;
      if (!text.ok) {
        problems.push({ column, problem: 'is not encoded', raw: text.value });
      }
      continue;
    }
    fields[column] = [];
    if (!text.ok) {
      problems.push({ column, problem: 'is not encoded', raw: text.value });
      continue;
    }
    if (text.value === '') continue;
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(text.value);
    } catch {
      problems.push({ column, problem: 'is not JSON', raw: text.value });
      continue;
    }
    const problem = formActionsProblem(parsed);
    if (problem) {
      problems.push({ column, problem, raw: text.value });
      continue;
    }
    fields[column] = /** @type {FormAction[]} */ (parsed).map((action) => ({
      title: action.title,
      dueDate: action.dueDate,
      status: action.status,
      details: action.details,
    }));
  }
  return { fields, problems };
}
