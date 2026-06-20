// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { captureRemediationDetail } from '../src/evaluators/remediation-details.js';

/** @typedef {import('../src/sharepoint-client.js').RemediationField} RemediationField */

/** @type {RemediationField} */
const TEXT_FIELD = { key: 'rootCause', label: 'Root cause', type: 'text' };

/** @type {RemediationField} */
const SELECT_FIELD = {
  key: 'severity',
  label: 'Severity',
  type: 'select',
  options: ['Low', 'Med', 'High'],
};

test('captureRemediationDetail: records a text value against the Answer', () => {
  const out = captureRemediationDetail(
    { value: 'No' },
    TEXT_FIELD,
    'Agent rushed the call'
  );
  assert.deepEqual(out.remediationDetails, {
    rootCause: 'Agent rushed the call',
  });
  assert.equal(out.value, 'No', 'the rest of the Answer is preserved');
});

test('captureRemediationDetail: accepts a select value that is one of the options', () => {
  const out = captureRemediationDetail({ value: 'No' }, SELECT_FIELD, 'High');
  assert.deepEqual(out.remediationDetails, { severity: 'High' });
});

test('captureRemediationDetail: rejects a select value that is not one of the options', () => {
  assert.throws(
    () => captureRemediationDetail({ value: 'No' }, SELECT_FIELD, 'Critical'),
    /Critical/,
    'an out-of-range select value must be rejected at capture time'
  );
});

test('captureRemediationDetail: merges with existing details rather than replacing them', () => {
  const out = captureRemediationDetail(
    { value: 'No', remediationDetails: { rootCause: 'Rushed' } },
    SELECT_FIELD,
    'High'
  );
  assert.deepEqual(out.remediationDetails, {
    rootCause: 'Rushed',
    severity: 'High',
  });
});

test('captureRemediationDetail: clearing a value removes its key', () => {
  const out = captureRemediationDetail(
    {
      value: 'No',
      remediationDetails: { rootCause: 'Rushed', severity: 'High' },
    },
    TEXT_FIELD,
    ''
  );
  assert.deepEqual(out.remediationDetails, { severity: 'High' });
});

test('captureRemediationDetail: clearing the last value drops remediationDetails entirely', () => {
  const out = captureRemediationDetail(
    { value: 'No', remediationDetails: { rootCause: 'Rushed' } },
    TEXT_FIELD,
    ''
  );
  assert.equal('remediationDetails' in out, false);
  assert.equal(out.value, 'No');
});

test('captureRemediationDetail: clearing an empty select value is allowed (not validated)', () => {
  const out = captureRemediationDetail({ value: 'No' }, SELECT_FIELD, '');
  assert.equal('remediationDetails' in out, false);
});
