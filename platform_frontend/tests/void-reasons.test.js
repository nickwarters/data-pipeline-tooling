// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VOID_REASONS,
  isVoidReasonKey,
  voidReasonLabel,
  voidReasonsFor,
} from '../src/lib/void-reasons.js';

// Capability: the framework-owned Void Reason vocabulary and its per-Case-Type
// narrowing.

test('VOID_REASONS is the frozen framework vocabulary, in display order', () => {
  assert.deepEqual(
    VOID_REASONS.map((r) => r.key),
    [
      'duplicate',
      'raised-in-error',
      'out-of-scope',
      'no-evidence',
      'superseded',
      'withdrawn',
    ]
  );
  for (const reason of VOID_REASONS) {
    assert.equal(typeof reason.label, 'string');
    assert.ok(reason.label.length > 0);
  }
  assert.ok(Object.isFrozen(VOID_REASONS));
});

test('voidReasonsFor: a Case Type declaring none is offered the whole vocabulary', () => {
  assert.deepEqual(voidReasonsFor({}), VOID_REASONS);
});

test('voidReasonsFor: a declared list narrows, in framework display order', () => {
  assert.deepEqual(
    voidReasonsFor({ voidReasons: ['withdrawn', 'duplicate'] }).map(
      (r) => r.key
    ),
    ['duplicate', 'withdrawn']
  );
});

test('voidReasonsFor: a declared key outside the vocabulary is ignored', () => {
  assert.deepEqual(
    voidReasonsFor({ voidReasons: ['duplicate', 'not-a-reason'] }).map(
      (r) => r.key
    ),
    ['duplicate']
  );
});

test('isVoidReasonKey: recognises every framework key and nothing else', () => {
  for (const reason of VOID_REASONS) {
    assert.equal(isVoidReasonKey(reason.key), true, reason.key);
  }
  assert.equal(isVoidReasonKey('not-a-reason'), false);
  assert.equal(isVoidReasonKey(''), false);
});

test('voidReasonLabel: an unknown key renders as itself, so historic data is never blank', () => {
  assert.equal(voidReasonLabel('duplicate'), 'Duplicate of another Case');
  assert.equal(voidReasonLabel('retired-reason'), 'retired-reason');
  // A Case that was never voided carries no reason at all.
  assert.equal(voidReasonLabel(null), '');
  assert.equal(voidReasonLabel(undefined), '');
});
