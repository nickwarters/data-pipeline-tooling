#!/usr/bin/env node
// @ts-check
/**
 * Print the columns a Form Type's list needs, read from its definition, for
 * whoever provisions that list by hand.
 *
 *   node scripts/form-type-columns.js             # every composed Form Type
 *   node scripts/form-type-columns.js one-to-one  # one
 *
 * Every Form list is created by hand in each environment, so its columns are
 * typed in by a person. Deriving them from the definition rather than copying
 * them into the runbook keeps the list and the definition from drifting: the
 * definition is the only place a column is named.
 */

import { APP_CONFIG } from '../src/app-config.js';
import {
  FORM_OWNED_FIELDS,
  FORM_STATUSES,
  formFields,
} from '../form-types/contract.js';
import { formColumnKinds } from '../src/services/form-items.js';

/** @typedef {import('../form-types/contract.js').FormTypeDefinition} FormTypeDefinition */
/** @typedef {import('../src/services/form-items.js').FormColumnKind} FormColumnKind */

/**
 * The SharePoint column type each kind of column is created as. An encoded
 * column is always multi-line plain text, whatever it holds: the encoded form
 * is about a third longer than the text, which outgrows a single-line column,
 * and rich text would rewrite it.
 *
 * @type {Readonly<Record<FormColumnKind, string>>}
 */
const SHAREPOINT_COLUMN_TYPES = Object.freeze({
  person: 'Person or Group',
  date: 'Date and Time (date only)',
  choice: 'Choice',
  encoded: 'Multiple lines of text (plain text)',
});

/**
 * One row per column: its name, the type to create it as, the values a Choice
 * column offers, whether it holds encoded text, and whether it is indexed. The
 * application's own columns are the indexed ones, because every query and the
 * access rule filter on them, and an index must be added while the list is
 * still empty.
 *
 * @param {FormTypeDefinition} definition
 * @returns {{ column: string, columnType: string, choices: readonly string[], encoded: boolean, indexed: boolean }[]}
 */
export function provisioningColumns(definition) {
  /** @type {Map<string, readonly string[]>} */
  const choices = new Map([['Status', FORM_STATUSES]]);
  for (const field of formFields(definition)) {
    if (field.choices) choices.set(field.itemField, field.choices);
  }
  return [...formColumnKinds(definition)].map(([column, kind]) => ({
    column,
    columnType: SHAREPOINT_COLUMN_TYPES[kind],
    choices: kind === 'choice' ? (choices.get(column) ?? []) : [],
    encoded: kind === 'encoded',
    indexed: Object.hasOwn(FORM_OWNED_FIELDS, column),
  }));
}

/**
 * @param {string[]} argv
 * @returns {number} the exit code
 */
function main(argv) {
  const [slug] = argv;
  const chosen = APP_CONFIG.formTypes.filter(
    (definition) => slug === undefined || definition.slug === slug
  );
  if (chosen.length === 0) {
    console.error(`No Form Type has the slug "${slug}".`);
    return 1;
  }
  for (const definition of chosen) {
    console.log(`${definition.formName} — list "${definition.listName}"`);
    for (const row of provisioningColumns(definition)) {
      const notes = [
        row.encoded ? 'encoded' : '',
        row.indexed ? 'indexed' : '',
      ].filter(Boolean);
      console.log(
        `  ${row.column}: ${row.columnType}${notes.length ? ` (${notes.join(', ')})` : ''}`
      );
      if (row.choices.length > 0) {
        console.log(`    choices: ${row.choices.join('; ')}`);
      }
    }
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
