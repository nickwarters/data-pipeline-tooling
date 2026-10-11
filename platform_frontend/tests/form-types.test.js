// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FORM_FIELD_STORAGE,
  FORM_OWNED_FIELDS,
  formColumns,
  formFields,
} from '../form-types/contract.js';
import { APP_CONFIG } from '../src/app-config.js';
import { captureFieldTypeNames } from '../src/capture-fields/registry.js';
import { checkFormTypes } from '../scripts/verify-config.js';

// Capability: a Form Type is declared once, as data, and the columns a Form is
// read and written through — and which of them are encoded — follow from that
// one declaration rather than being listed a second time.

/**
 * @param {any[]} sections
 * @returns {any}
 */
function definition(sections) {
  return {
    slug: 'demo',
    formName: 'Demo',
    description: 'A demo form.',
    listName: 'Demo',
    voidReasons: ['Created in error'],
    sections,
  };
}

/** The application's own columns that hold free text, and so are encoded. */
const OWNED_ENCODED = Object.entries(FORM_OWNED_FIELDS)
  .filter(([, owned]) => FORM_FIELD_STORAGE[owned.type] === 'encoded')
  .map(([column]) => column);

const STRIP = {
  sectionType: 'panel',
  panelName: 'Details',
  layout: 'strip',
  fields: [
    { type: 'person', label: 'Employee', itemField: 'Employee' },
    { type: 'date', label: 'Due date', itemField: 'DueDate' },
    { type: 'select', label: 'Stage', itemField: 'Stage', choices: ['One'] },
    { type: 'text', label: 'Tags', itemField: 'Tags' },
  ],
};

test('every field type the renderer draws as a control has a capture field type behind it', () => {
  // Status is the one exception: it is the page's badge, changed only by the
  // lifecycle buttons, so there is no control to draw.
  const controls = Object.keys(FORM_FIELD_STORAGE).filter(
    (type) => type !== 'status'
  );
  for (const type of controls) {
    assert.ok(captureFieldTypeNames().includes(type), type);
  }
});

test('the fields come back in page order, whichever section or panel holds them', () => {
  const def = definition([
    STRIP,
    { sectionType: 'actions', itemField: 'Actions' },
    {
      sectionType: 'split-panel',
      panels: [
        {
          panelName: 'Left',
          fields: [{ type: 'textarea', label: 'Mine', itemField: 'Mine' }],
        },
        {
          panelName: 'Right',
          fields: [{ type: 'textarea', label: 'Theirs', itemField: 'Theirs' }],
        },
      ],
    },
  ]);

  assert.deepEqual(
    formFields(def).map((field) => field.itemField),
    ['Employee', 'DueDate', 'Stage', 'Tags', 'Mine', 'Theirs']
  );
});

test('free text and the Form Actions are encoded; people, dates and choices are not', () => {
  const columns = formColumns(
    definition([
      STRIP,
      {
        sectionType: 'panel',
        panelName: 'Discussion',
        fields: [{ type: 'textarea', label: 'Notes', itemField: 'Notes' }],
      },
      { sectionType: 'actions', itemField: 'Actions' },
    ])
  );

  assert.deepEqual(
    columns.encoded.sort(),
    ['Actions', 'Notes', 'Tags', ...OWNED_ENCODED].sort()
  );
  assert.ok(columns.plain.includes('Stage'));
  assert.equal(
    columns.plain.some((column) => columns.encoded.includes(column)),
    false
  );
});

test("the application's own columns are always read and written, placed on the page or not, stored by their type", () => {
  // Access and the lock read them on every Form, so a definition that leaves
  // the current managers to the page still selects them.
  const { plain, encoded } = formColumns(definition([STRIP]));

  for (const [column, owned] of Object.entries(FORM_OWNED_FIELDS)) {
    const stored = FORM_FIELD_STORAGE[owned.type] === 'plain' ? plain : encoded;
    const other = stored === plain ? encoded : plain;
    assert.ok(stored.includes(column), column);
    assert.equal(other.includes(column), false, column);
  }
});

test('a field type the storage table does not know is encoded rather than left readable', () => {
  const { encoded } = formColumns(
    definition([
      {
        sectionType: 'panel',
        panelName: 'Odd',
        fields: [{ type: 'rich-text', label: 'Odd', itemField: 'Odd' }],
      },
    ])
  );

  assert.deepEqual(encoded.sort(), ['Odd', ...OWNED_ENCODED].sort());
});

// --- Over every Form Type the application composes ---

test('every composed Form Type passes the verify gate', () => {
  assert.deepEqual(checkFormTypes({ formTypes: APP_CONFIG.formTypes }), []);
});

test('every composed Form Type encodes exactly its free text, its Form Actions and the application’s own free text', () => {
  for (const def of APP_CONFIG.formTypes) {
    const { encoded } = formColumns(def);
    const freeText = formFields(def)
      .filter((field) => FORM_FIELD_STORAGE[field.type] === 'encoded')
      .map((field) => field.itemField);
    const actions = def.sections.flatMap((section) =>
      section.sectionType === 'actions' ? [section.itemField] : []
    );

    assert.deepEqual(
      encoded.sort(),
      [...freeText, ...actions, ...OWNED_ENCODED].sort(),
      def.slug
    );
  }
});
