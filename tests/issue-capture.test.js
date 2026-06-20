// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  captureValue,
  validateCaptureGroups,
  findCaptureField,
} from '../src/evaluators/issue-capture.js';

/** @typedef {import('../src/sharepoint-client.js').CaptureField} CaptureField */

/** @type {CaptureField} */
const TEXT_FIELD = { key: 'rootCause', label: 'Root cause', type: 'text' };
/** @type {CaptureField} */
const TEXTAREA_FIELD = { key: 'detail', label: 'Detail', type: 'textarea' };
/** @type {CaptureField} */
const SELECT_FIELD = {
  key: 'severity',
  label: 'Severity',
  type: 'select',
  options: ['Low', 'Med', 'High'],
};
/** @type {CaptureField} */
const RADIO_FIELD = {
  key: 'repeat',
  label: 'Repeat?',
  type: 'radio',
  options: ['Yes', 'No'],
};

test('captureValue: records a text value into Answer.capture', () => {
  const out = captureValue(
    { value: 'No' },
    TEXT_FIELD,
    'Agent rushed the call'
  );
  assert.deepEqual(out.capture, { rootCause: 'Agent rushed the call' });
  assert.equal(out.value, 'No', 'the rest of the Answer is preserved');
});

test('captureValue: records a textarea value', () => {
  const out = captureValue({ value: 'No' }, TEXTAREA_FIELD, 'Long form notes');
  assert.deepEqual(out.capture, { detail: 'Long form notes' });
});

test('captureValue: accepts a select value that is one of the options', () => {
  const out = captureValue({ value: 'No' }, SELECT_FIELD, 'High');
  assert.deepEqual(out.capture, { severity: 'High' });
});

test('captureValue: accepts a radio value that is one of the options', () => {
  const out = captureValue({ value: 'No' }, RADIO_FIELD, 'Yes');
  assert.deepEqual(out.capture, { repeat: 'Yes' });
});

test('captureValue: rejects a select value that is not one of the options', () => {
  assert.throws(
    () => captureValue({ value: 'No' }, SELECT_FIELD, 'Critical'),
    /Critical/,
    'an out-of-range select value must be rejected at capture time'
  );
});

test('captureValue: rejects a radio value that is not one of the options', () => {
  assert.throws(
    () => captureValue({ value: 'No' }, RADIO_FIELD, 'Maybe'),
    /Maybe/
  );
});

test('captureValue: merges with existing capture rather than replacing it', () => {
  const out = captureValue(
    { value: 'No', capture: { rootCause: 'Rushed' } },
    SELECT_FIELD,
    'High'
  );
  assert.deepEqual(out.capture, { rootCause: 'Rushed', severity: 'High' });
});

test('captureValue: clearing a value removes its key', () => {
  const out = captureValue(
    { value: 'No', capture: { rootCause: 'Rushed', severity: 'High' } },
    TEXT_FIELD,
    ''
  );
  assert.deepEqual(out.capture, { severity: 'High' });
});

test('captureValue: clearing the last value drops capture entirely', () => {
  const out = captureValue(
    { value: 'No', capture: { rootCause: 'Rushed' } },
    TEXT_FIELD,
    ''
  );
  assert.equal('capture' in out, false);
  assert.equal(out.value, 'No');
});

test('captureValue: clearing an empty select value is allowed (not validated)', () => {
  const out = captureValue({ value: 'No' }, SELECT_FIELD, '');
  assert.equal('capture' in out, false);
});

test('validateCaptureGroups: passes when all field keys are unique across groups', () => {
  const groups = [
    {
      key: 'g1',
      label: 'Group 1',
      fields: [{ key: 'a', label: 'A', type: /** @type {const} */ ('text') }],
    },
    {
      key: 'g2',
      label: 'Group 2',
      fields: [{ key: 'b', label: 'B', type: /** @type {const} */ ('text') }],
    },
  ];
  assert.doesNotThrow(() => validateCaptureGroups(groups));
});

test('validateCaptureGroups: throws when a field key is duplicated across groups', () => {
  const groups = [
    {
      key: 'g1',
      label: 'Group 1',
      fields: [{ key: 'dup', label: 'A', type: /** @type {const} */ ('text') }],
    },
    {
      key: 'g2',
      label: 'Group 2',
      fields: [{ key: 'dup', label: 'B', type: /** @type {const} */ ('text') }],
    },
  ];
  assert.throws(() => validateCaptureGroups(groups), /dup/);
});

test('validateCaptureGroups: tolerates an absent captureGroups declaration', () => {
  assert.doesNotThrow(() => validateCaptureGroups(undefined));
});

test('findCaptureField: returns the field with the given key from any group', () => {
  const groups = [
    {
      key: 'g1',
      label: 'G1',
      fields: [{ key: 'a', label: 'A', type: /** @type {const} */ ('text') }],
    },
    {
      key: 'g2',
      label: 'G2',
      fields: [
        {
          key: 'b',
          label: 'B',
          type: /** @type {const} */ ('select'),
          options: ['x'],
        },
      ],
    },
  ];
  assert.equal(findCaptureField(groups, 'b')?.label, 'B');
});

test('findCaptureField: returns undefined for an unknown key', () => {
  assert.equal(findCaptureField([], 'nope'), undefined);
});
