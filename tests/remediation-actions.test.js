// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  coerceRemediationAction,
  coerceRemediationActions,
  actionFieldKeys,
} from '../src/evaluators/remediation-actions.js';

/** @typedef {import('../src/sharepoint-client.js').CaptureGroup} CaptureGroup */

/** @type {CaptureGroup[]} */
const GROUPS = [
  {
    key: 'g1',
    label: 'Group 1',
    fields: [
      { key: 'summary', label: 'Summary', type: 'textarea' },
      { key: 'actions', label: 'Actions', type: 'actions' },
    ],
  },
  {
    key: 'g2',
    label: 'Group 2',
    fields: [{ key: 'moreActions', label: 'More', type: 'actions' }],
  },
];

test('coerceRemediationAction: legacy string becomes a pending action with the fallback id', () => {
  assert.deepEqual(
    coerceRemediationAction('Re-issue the letter', 'actions-0'),
    {
      id: 'actions-0',
      text: 'Re-issue the letter',
      status: 'pending',
    }
  );
});

test('coerceRemediationAction: object passes through, keeping cancel reason', () => {
  assert.deepEqual(
    coerceRemediationAction({
      id: 'a1',
      text: 'Refund',
      status: 'cancelled',
      cancelReason: 'Already refunded',
    }),
    {
      id: 'a1',
      text: 'Refund',
      status: 'cancelled',
      cancelReason: 'Already refunded',
    }
  );
});

test('coerceRemediationAction: unrecognised/absent status defaults to pending and drops non-cancel reason', () => {
  assert.deepEqual(
    coerceRemediationAction(
      { text: 'Do it', status: 'bogus', cancelReason: 'x' },
      'k-2'
    ),
    { id: 'k-2', text: 'Do it', status: 'pending' }
  );
  assert.deepEqual(coerceRemediationAction({ id: 'a', text: 'Do it' }), {
    id: 'a',
    text: 'Do it',
    status: 'pending',
  });
});

test('coerceRemediationAction: a cancelled action without a stored reason keeps no reason', () => {
  assert.deepEqual(
    coerceRemediationAction({ id: 'a', text: 'X', status: 'cancelled' }),
    { id: 'a', text: 'X', status: 'cancelled' }
  );
});

test('coerceRemediationActions: mixes strings and objects, generating ids for strings', () => {
  const out = coerceRemediationActions(
    ['legacy one', { id: 'a2', text: 'kept', status: 'complete' }],
    'actions'
  );
  assert.deepEqual(out, [
    { id: 'actions-0', text: 'legacy one', status: 'pending' },
    { id: 'a2', text: 'kept', status: 'complete' },
  ]);
});

test('coerceRemediationActions: undefined list yields an empty array', () => {
  assert.deepEqual(coerceRemediationActions(undefined), []);
});

test('actionFieldKeys: collects every actions-typed field key across groups', () => {
  assert.deepEqual(actionFieldKeys(GROUPS), ['actions', 'moreActions']);
  assert.deepEqual(actionFieldKeys(undefined), []);
});
