// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { simulatorEnabled } from '../src/question-bank/question-bank-flags.js';

test('simulatorEnabled: true only for simulate=1', () => {
  assert.equal(simulatorEnabled('?simulate=1'), true);
  assert.equal(simulatorEnabled('?mock=1&simulate=1'), true);
  assert.equal(simulatorEnabled('?simulate=0'), false);
  assert.equal(simulatorEnabled('?simulate=true'), false);
  assert.equal(simulatorEnabled('?mock=1'), false);
  assert.equal(simulatorEnabled(''), false);
});

test('simulatorEnabled: defaults to the current location search', () => {
  const orig = /** @type {any} */ (globalThis).location;
  try {
    /** @type {any} */ (globalThis).location = { search: '?simulate=1' };
    assert.equal(simulatorEnabled(), true);
    /** @type {any} */ (globalThis).location = { search: '' };
    assert.equal(simulatorEnabled(), false);
    /** @type {any} */ (globalThis).location = undefined;
    assert.equal(simulatorEnabled(), false);
  } finally {
    /** @type {any} */ (globalThis).location = orig;
  }
});
