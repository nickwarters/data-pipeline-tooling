// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { provisioningColumns } from '../scripts/form-type-columns.js';
import { FORM_OWNED_FIELDS, formColumns } from '../form-types/contract.js';
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
