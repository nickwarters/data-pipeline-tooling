// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NA_VALUE,
  YES_NO,
  baseResponseOptions,
  reviewerResponseOptions,
} from '../src/lib/response-options.js';

test('NA_VALUE is the single canonical stored literal', () => {
  // 'NA' is what existing Answers already store; changing it would need a
  // migration story.
  assert.equal(NA_VALUE, 'NA');
});

test('YES_NO carries the fixed yes-no-na options without N/A', () => {
  assert.deepEqual(YES_NO, ['Yes', 'No']);
});

test('baseResponseOptions: yes-no-na is fixed Yes/No', () => {
  assert.deepEqual(baseResponseOptions({ responseType: 'yes-no-na' }), [
    'Yes',
    'No',
  ]);
});

test('baseResponseOptions: other types use their own options', () => {
  assert.deepEqual(
    baseResponseOptions({ responseType: 'single-choice', options: ['A', 'B'] }),
    ['A', 'B']
  );
  assert.deepEqual(
    baseResponseOptions({ responseType: 'multi-choice', options: ['X'] }),
    ['X']
  );
});

test('baseResponseOptions: missing options fall back to empty', () => {
  assert.deepEqual(baseResponseOptions({ responseType: 'outcome' }), []);
});

test('reviewerResponseOptions appends the universal N/A to every type', () => {
  assert.deepEqual(reviewerResponseOptions({ responseType: 'yes-no-na' }), [
    'Yes',
    'No',
    'NA',
  ]);
  assert.deepEqual(
    reviewerResponseOptions({
      responseType: 'single-choice',
      options: ['A', 'B'],
    }),
    ['A', 'B', 'NA']
  );
  assert.deepEqual(
    reviewerResponseOptions({ responseType: 'multi-choice', options: ['X'] }),
    ['X', 'NA']
  );
  assert.deepEqual(
    reviewerResponseOptions({ responseType: 'outcome', options: ['Pass'] }),
    ['Pass', 'NA']
  );
});

test('reviewerResponseOptions does not duplicate an authored NA option', () => {
  assert.deepEqual(
    reviewerResponseOptions({
      responseType: 'single-choice',
      options: ['A', 'NA'],
    }),
    ['A', 'NA']
  );
});
