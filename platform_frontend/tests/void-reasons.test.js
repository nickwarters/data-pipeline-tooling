// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VOID_REASONS,
  VOID_REASON_OTHER,
  isVoidReasonKey,
  voidReasonLabel,
  voidReasonNeedsNote,
  voidReasonText,
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
      'other',
    ]
  );
  for (const reason of VOID_REASONS) {
    assert.equal(typeof reason.label, 'string');
    assert.ok(reason.label.length > 0);
    // The members are frozen too: freezing only the list would leave every key
    // and label editable in place, which is the half nothing else could detect.
    assert.ok(Object.isFrozen(reason), reason.key);
    assert.throws(() => {
      /** @type {any} */ (reason).label = 'reworded';
    });
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

test('voidReasonNeedsNote: only the escape hatch is unanswered by its key', () => {
  assert.equal(voidReasonNeedsNote(VOID_REASON_OTHER), true);
  for (const reason of VOID_REASONS) {
    if (reason.key === VOID_REASON_OTHER) continue;
    assert.equal(voidReasonNeedsNote(reason.key), false, reason.key);
  }
  // Nothing chosen yet is not a reason that needs writing out — it is no
  // reason at all, which the control gates on separately.
  assert.equal(voidReasonNeedsNote(''), false);
  assert.equal(voidReasonNeedsNote(null), false);
  assert.equal(voidReasonNeedsNote(undefined), false);
});

test('voidReasonText: the note is what "Other" means, so it reads beside the label', () => {
  assert.equal(
    voidReasonText('other', 'The customer died before the review'),
    'Other: The customer died before the review'
  );
  // Whitespace a Reviewer left around the note is not part of what they wrote.
  assert.equal(voidReasonText('other', '  spaced  '), 'Other: spaced');
});

test('voidReasonText: a keyed reason with no note reads exactly as its label', () => {
  assert.equal(voidReasonText('duplicate', null), 'Duplicate of another Case');
  assert.equal(voidReasonText('duplicate', ''), 'Duplicate of another Case');
  assert.equal(voidReasonText('duplicate', '   '), 'Duplicate of another Case');
  assert.equal(
    voidReasonText('duplicate', undefined),
    'Duplicate of another Case'
  );
});

test('voidReasonText: a note with no reason still says what happened', () => {
  // Historic rows are the population here: a reason retired from the
  // vocabulary must not take the words written under it off the screen.
  assert.equal(voidReasonText(null, 'written anyway'), 'written anyway');
  assert.equal(voidReasonText('', 'written anyway'), 'written anyway');
  assert.equal(voidReasonText(null, null), '');
});
