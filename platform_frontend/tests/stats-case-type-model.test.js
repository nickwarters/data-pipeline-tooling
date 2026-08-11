// @ts-check

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  caseTypeLabelFor,
  sortCaseTypeColumns,
} from '../src/evaluators/stats-case-type-model.js';

test('Case Type labels use manifest names and safe copy for unknown slugs', () => {
  assert.equal(caseTypeLabelFor('complaints'), 'Complaints');
  assert.equal(caseTypeLabelFor('example-case-type'), 'Example Case Type');
  assert.notEqual(caseTypeLabelFor('example-case-type'), 'example-case-type');
});

test('Case Type columns sort by display name, then stable slug', () => {
  assert.deepEqual(
    sortCaseTypeColumns([
      { key: 'zeta', label: 'Same' },
      { key: 'alpha', label: 'Same' },
      { key: 'complaints', label: 'Complaints' },
    ]),
    [
      { key: 'complaints', label: 'Complaints' },
      { key: 'alpha', label: 'Same' },
      { key: 'zeta', label: 'Same' },
    ]
  );
});
