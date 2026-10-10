// @ts-check
/**
 * What both SharePoint clients agree on about a Form's columns, so the Http
 * client and the mock cannot drift: which column holds which kind of value,
 * and which columns a read and a write may name.
 *
 * Wire details stay in each client. This module says only what a column is.
 */

import {
  FORM_OWNED_FIELDS,
  formColumns,
  formFields,
} from '../../form-types/contract.js';

/** @typedef {import('../../form-types/contract.js').FormTypeDefinition} FormTypeDefinition */

/**
 * Columns every SharePoint item carries, which a read may filter or order on
 * without a definition declaring them.
 */
export const FORM_STAMP_COLUMNS = Object.freeze(['Created', 'Modified']);

/**
 * What one column holds, as far as the clients are concerned.
 *
 * @typedef {'person' | 'date' | 'choice' | 'encoded'} FormColumnKind
 */

/**
 * Every column a Form of this type is read and written through, with the kind
 * of value it holds, in a stable order: the application's own columns first.
 *
 * @param {FormTypeDefinition} definition
 * @returns {Map<string, FormColumnKind>}
 */
export function formColumnKinds(definition) {
  /** @type {Map<string, string>} */
  const types = new Map(
    Object.entries(FORM_OWNED_FIELDS).map(([column, owned]) => [
      column,
      owned.type,
    ])
  );
  for (const field of formFields(definition)) {
    if (!types.has(field.itemField)) types.set(field.itemField, field.type);
  }
  const { plain, encoded } = formColumns(definition);
  /** @type {Map<string, FormColumnKind>} */
  const kinds = new Map();
  for (const column of plain) {
    const type = types.get(column);
    kinds.set(
      column,
      type === 'person' ? 'person' : type === 'date' ? 'date' : 'choice'
    );
  }
  for (const column of encoded) kinds.set(column, 'encoded');
  return kinds;
}

/**
 * Refuse a write naming a column the definition does not read.
 *
 * A Case write drops a key it does not know; a Form write throws instead,
 * because a silently dropped field is an answer someone typed and nobody
 * saved.
 *
 * @param {FormTypeDefinition} definition
 * @param {Record<string, unknown>} fields
 */
export function assertFormColumns(definition, fields) {
  const kinds = formColumnKinds(definition);
  for (const column of Object.keys(fields)) {
    if (!kinds.has(column)) {
      throw new Error(
        `Form Type "${definition.slug}" has no column "${column}" to write`
      );
    }
  }
}

/**
 * Refuse a filter or ordering naming a column it cannot be applied to: one the
 * definition does not read, or an encoded one, whose stored value means
 * nothing to the server.
 *
 * @param {FormTypeDefinition} definition
 * @param {string} column
 * @param {readonly FormColumnKind[]} allowed
 */
export function assertQueryColumn(definition, column, allowed) {
  if (FORM_STAMP_COLUMNS.includes(column)) return;
  const kind = formColumnKinds(definition).get(column);
  if (kind === undefined || !allowed.includes(kind)) {
    throw new Error(
      `Form Type "${definition.slug}" cannot be queried on the column "${column}"`
    );
  }
}
