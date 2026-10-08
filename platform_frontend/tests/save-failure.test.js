// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySaveFailure,
  describeSaveFailure,
  failureOf,
  isConnectionFailure,
} from '../src/services/save-failure.js';

/** @typedef {import('../src/services/save-failure.js').SaveFailure} SaveFailure */
/** @typedef {import('../src/services/save-failure.js').SaveFailureReason} SaveFailureReason */

test('no response at all is a lost connection', () => {
  assert.deepEqual(classifySaveFailure({ status: 0 }), { reason: 'network' });
});

test('a gateway or service-unavailable answer is SharePoint being unreachable', () => {
  for (const status of [502, 503, 504]) {
    assert.deepEqual(
      classifySaveFailure({ status }),
      { reason: 'unavailable' },
      String(status)
    );
  }
});

test('a bad request or an oversized body is a refused value, keeping what SharePoint said', () => {
  for (const status of [400, 413]) {
    assert.deepEqual(
      classifySaveFailure({ status, message: 'nope' }),
      { reason: 'invalid-value', message: 'nope' },
      String(status)
    );
  }
  assert.deepEqual(classifySaveFailure({ status: 400 }), {
    reason: 'invalid-value',
  });
});

test('a server error is a refused value only when its message says the value was refused', () => {
  const refusals = [
    "'\u000b', hexadecimal value 0x0B, is an invalid character.",
    'The value of the field exceeds the maximum length.',
    'The string is too long.',
  ];
  for (const message of refusals) {
    assert.deepEqual(
      classifySaveFailure({ status: 500, message }),
      { reason: 'invalid-value', message },
      message
    );
  }
  assert.deepEqual(
    classifySaveFailure({ status: 500, message: 'Something broke' }),
    { reason: 'unknown', message: 'Something broke' }
  );
  assert.deepEqual(classifySaveFailure({ status: 500 }), { reason: 'unknown' });
});

test('an unauthorised or forbidden answer is a permission failure', () => {
  for (const status of [401, 403]) {
    assert.deepEqual(
      classifySaveFailure({ status }),
      { reason: 'forbidden' },
      String(status)
    );
  }
});

test('a missing item is a Case that is no longer there', () => {
  assert.deepEqual(classifySaveFailure({ status: 404 }), {
    reason: 'not-found',
  });
});

test('only a lost connection or an unreachable SharePoint is worth waiting out', () => {
  /** @type {SaveFailureReason[]} */
  const reasons = [
    'network',
    'unavailable',
    'invalid-value',
    'person-not-found',
    'forbidden',
    'not-found',
    'unknown',
  ];
  const waitable = reasons.filter((reason) => isConnectionFailure({ reason }));
  assert.deepEqual(waitable, ['network', 'unavailable']);
});

test('every failure is described in words that never mention reconnecting or a status code', () => {
  /** @type {SaveFailure[]} */
  const failures = [
    { reason: 'network' },
    { reason: 'unavailable' },
    { reason: 'invalid-value' },
    { reason: 'person-not-found', account: 'jdoe' },
    { reason: 'forbidden' },
    { reason: 'not-found' },
    { reason: 'unknown' },
    { reason: 'unknown', message: 'Server fault' },
  ];
  for (const failure of failures) {
    const text = describeSaveFailure(failure, { fields: ['notes'] });
    assert.ok(text.length > 0, failure.reason);
    assert.doesNotMatch(text, /reconnect/i, failure.reason);
    assert.doesNotMatch(text, /\b\d{3}\b/, failure.reason);
  }
});

test('a refused value names the field that was not saved', () => {
  const text = describeSaveFailure(
    { reason: 'invalid-value' },
    { fields: ['notes'] }
  );
  assert.match(text, /Notes/);
  assert.match(text, /character/);
});

test('a write the copy has no label for is still described, as a change', () => {
  const text = describeSaveFailure(
    { reason: 'forbidden' },
    { fields: ['onHold', 'placedOnHoldAt'] }
  );
  assert.match(text, /^Your change/);
  assert.match(describeSaveFailure({ reason: 'forbidden' }), /^Your change/);
});

test('a person who could not be found is named by display name, then account, then neither', () => {
  const failure = /** @type {SaveFailure} */ ({
    reason: 'person-not-found',
    account: 'jdoe',
  });
  assert.match(
    describeSaveFailure(failure, { personName: 'Jane Doe' }),
    /^Jane Doe couldn't be added/
  );
  assert.match(describeSaveFailure(failure), /^jdoe couldn't be added/);
  assert.match(
    describeSaveFailure({ reason: 'person-not-found' }),
    /^That person couldn't be added/
  );
});

test("an unknown failure passes on SharePoint's own explanation when there is one", () => {
  assert.match(
    describeSaveFailure({ reason: 'unknown', message: 'List is locked' }),
    /List is locked/
  );
});

test("a failed result's own failure wins, and one that names none is read from its status", () => {
  assert.deepEqual(
    failureOf({ status: 500, failure: { reason: 'person-not-found' } }),
    { reason: 'person-not-found' }
  );
  assert.deepEqual(failureOf({ status: 0 }), { reason: 'network' });
});
