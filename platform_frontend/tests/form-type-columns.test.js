// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import {
  columnsTable,
  provisioningColumns,
} from '../scripts/form-type-columns.js';
import {
  CHOICE_FIELD_TYPES,
  CLOSED_FORM_STATUSES,
  FORM_OWNED_FIELDS,
  FORM_STATUSES,
  formColumns,
  formFields,
} from '../form-types/contract.js';
import { APP_CONFIG } from '../src/app-config.js';

// Capability: the columns a person creates on a Form list come from the Form
// Type's definition, so the list and the definition cannot drift apart.

test('every column a Form is read and written through is provisioned once', () => {
  for (const def of APP_CONFIG.formTypes) {
    const { plain, encoded } = formColumns(def);
    const rows = provisioningColumns(def);

    assert.deepEqual(
      rows.map((row) => row.column).sort(),
      [...plain, ...encoded].sort(),
      def.slug
    );
    for (const row of rows)
      assert.ok(row.columnType, `${def.slug} ${row.column}`);
  }
});

test('an encoded column is multi-line plain text, so neither its length nor rich-text editing breaks it', () => {
  for (const def of APP_CONFIG.formTypes) {
    for (const row of provisioningColumns(def).filter((row) => row.encoded)) {
      assert.equal(
        row.columnType,
        'Multiple lines of text (plain text)',
        `${def.slug} ${row.column}`
      );
    }
  }
});

test("the application's own columns are indexed with the types access and the lock read", () => {
  for (const def of APP_CONFIG.formTypes) {
    const rows = new Map(
      provisioningColumns(def).map((row) => [row.column, row])
    );
    for (const column of Object.keys(FORM_OWNED_FIELDS)) {
      assert.equal(rows.get(column)?.indexed, true, `${def.slug} ${column}`);
      assert.equal(rows.get(column)?.encoded, false, `${def.slug} ${column}`);
    }
    assert.equal(rows.get('Employee')?.columnType, 'Person or Group');
    assert.equal(rows.get('DueDate')?.columnType, 'Date and Time (date only)');
    assert.equal(rows.get('Status')?.columnType, 'Choice');
  }
});

test('every Choice column is provisioned with the values its field offers', () => {
  for (const def of APP_CONFIG.formTypes) {
    const rows = new Map(
      provisioningColumns(def).map((row) => [row.column, row])
    );
    const choiceFields = formFields(def).filter((field) =>
      CHOICE_FIELD_TYPES.includes(field.type)
    );
    assert.ok(choiceFields.length > 0, def.slug);
    for (const field of choiceFields) {
      assert.deepEqual(
        rows.get(field.itemField)?.choices,
        field.choices,
        `${def.slug} ${field.itemField}`
      );
    }
    assert.deepEqual(rows.get('Status')?.choices, FORM_STATUSES);
  }
});

test('only a Choice column is provisioned with values', () => {
  for (const def of APP_CONFIG.formTypes) {
    for (const row of provisioningColumns(def)) {
      if (row.columnType !== 'Choice') {
        assert.deepEqual(row.choices, [], `${def.slug} ${row.column}`);
      }
    }
  }
});

test('every Status that locks a Form is one a Form can hold', () => {
  for (const status of CLOSED_FORM_STATUSES) {
    assert.ok(FORM_STATUSES.includes(status), status);
  }
  assert.ok(
    FORM_STATUSES.some((status) => !CLOSED_FORM_STATUSES.includes(status)),
    'a new Form needs an open Status to start in'
  );
});

test('the provisioning runbook carries each Form Type’s column table as the definition gives it', () => {
  const runbook = readFileSync(
    new URL('../docs/guide/provisioning-runbook.md', import.meta.url),
    'utf8'
  );
  /** @param {string} table */
  const cells = (table) =>
    table
      .trim()
      .split('\n')
      .map((line) => line.split('|').map((cell) => cell.trim()));
  const blocks = [
    ...runbook.matchAll(
      /<!-- form-type-columns: ([\w-]+) -->([\s\S]*?)<!-- \/form-type-columns -->/g
    ),
  ];
  assert.ok(blocks.length > 0, 'the runbook carries a column table');
  for (const [, slug, table] of blocks) {
    const def = APP_CONFIG.formTypes.find((each) => each.slug === slug);
    assert.ok(
      def,
      `the runbook names a Form Type "${slug}" that is not composed`
    );
    assert.deepEqual(cells(table), cells(columnsTable(def)), slug);
  }
});
