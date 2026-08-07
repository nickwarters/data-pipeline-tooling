// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AMENDMENT_REASONS,
  amendmentReasonsFor,
} from '../src/lib/amendment-reasons.js';

// Capability: the shared Amendment Reason vocabulary and its per-Case-Type
// extension.

test('AMENDMENT_REASONS is the shared vocabulary, in display order', () => {
  assert.deepEqual(
    AMENDMENT_REASONS.map((r) => r.key),
    ['qa-check', 'tm-check', 'appeal']
  );
  for (const reason of AMENDMENT_REASONS) {
    assert.equal(typeof reason.label, 'string');
    assert.ok(reason.label.length > 0);
  }
});

test('amendmentReasonsFor: a Case Type declaring none is offered exactly the shared three', () => {
  assert.deepEqual(
    amendmentReasonsFor({}).map((r) => r.key),
    ['qa-check', 'tm-check', 'appeal']
  );
});

test('amendmentReasonsFor: declared extras append after the defaults, in declaration order', () => {
  const reasons = amendmentReasonsFor({
    extraAmendmentReasons: [
      { key: 'data-correction', label: 'Data correction' },
      { key: 'complaint-uphold', label: 'Complaint upheld' },
    ],
  });
  assert.deepEqual(
    reasons.map((r) => r.key),
    ['qa-check', 'tm-check', 'appeal', 'data-correction', 'complaint-uphold']
  );
  assert.equal(reasons[3].label, 'Data correction');
});

test('amendmentReasonsFor: an extra colliding with a default neither duplicates nor re-labels it', () => {
  const reasons = amendmentReasonsFor({
    extraAmendmentReasons: [
      { key: 'appeal', label: 'Appeal (ours)' },
      { key: 'data-correction', label: 'Data correction' },
    ],
  });
  assert.deepEqual(
    reasons.map((r) => r.key),
    ['qa-check', 'tm-check', 'appeal', 'data-correction']
  );
  assert.equal(
    reasons.find((r) => r.key === 'appeal')?.label,
    'Appeal',
    'the shared spine keeps its own label'
  );
});

test('amendmentReasonsFor: a missing config is the same as one declaring nothing', () => {
  assert.deepEqual(
    amendmentReasonsFor(null).map((r) => r.key),
    AMENDMENT_REASONS.map((r) => r.key)
  );
  assert.deepEqual(
    amendmentReasonsFor(undefined).map((r) => r.key),
    AMENDMENT_REASONS.map((r) => r.key)
  );
});
