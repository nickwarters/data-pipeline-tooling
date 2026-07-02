// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  coerceRemediationAction,
  coerceRemediationActions,
  validateRemediationAction,
  isActionResolved,
  setActionStatus,
  actionFieldKeys,
  sentActionsForAnswer,
  allSentActions,
  remediationTrackingComplete,
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

test('validateRemediationAction: cancelled without a reason throws', () => {
  assert.throws(
    () =>
      validateRemediationAction({ id: 'a', text: 'X', status: 'cancelled' }),
    /cannot be cancelled without a reason/
  );
  assert.throws(() =>
    validateRemediationAction({
      id: 'a',
      text: 'X',
      status: 'cancelled',
      cancelReason: '   ',
    })
  );
});

test('validateRemediationAction: resolved/pending actions are accepted', () => {
  assert.doesNotThrow(() =>
    validateRemediationAction({ id: 'a', text: 'X', status: 'pending' })
  );
  assert.doesNotThrow(() =>
    validateRemediationAction({ id: 'a', text: 'X', status: 'complete' })
  );
  assert.doesNotThrow(() =>
    validateRemediationAction({
      id: 'a',
      text: 'X',
      status: 'cancelled',
      cancelReason: 'reason',
    })
  );
});

test('isActionResolved: complete and cancelled-with-reason are resolved; pending and cancelled-without-reason are not', () => {
  assert.equal(
    isActionResolved({ id: 'a', text: 'X', status: 'complete' }),
    true
  );
  assert.equal(
    isActionResolved({
      id: 'a',
      text: 'X',
      status: 'cancelled',
      cancelReason: 'r',
    }),
    true
  );
  assert.equal(
    isActionResolved({ id: 'a', text: 'X', status: 'pending' }),
    false
  );
  assert.equal(
    isActionResolved({
      id: 'a',
      text: 'X',
      status: 'cancelled',
      cancelReason: ' ',
    }),
    false
  );
});

test('setActionStatus: cancelling requires a reason and stamps it', () => {
  assert.deepEqual(
    setActionStatus(
      { id: 'a', text: 'X', status: 'pending' },
      'cancelled',
      'no longer needed'
    ),
    {
      id: 'a',
      text: 'X',
      status: 'cancelled',
      cancelReason: 'no longer needed',
    }
  );
  assert.throws(() =>
    setActionStatus({ id: 'a', text: 'X', status: 'pending' }, 'cancelled')
  );
});

test('setActionStatus: switching away from cancelled drops a stale reason', () => {
  const cancelled = {
    id: 'a',
    text: 'X',
    status: /** @type {const} */ ('cancelled'),
    cancelReason: 'was cancelled',
  };
  assert.deepEqual(setActionStatus(cancelled, 'complete'), {
    id: 'a',
    text: 'X',
    status: 'complete',
  });
});

test('actionFieldKeys: collects every actions-typed field key across groups', () => {
  assert.deepEqual(actionFieldKeys(GROUPS), ['actions', 'moreActions']);
  assert.deepEqual(actionFieldKeys(undefined), []);
});

test('sentActionsForAnswer: reads and coerces actions from the answer capture, ignoring non-arrays', () => {
  /** @type {import('../src/sharepoint-client.js').Answer} */
  const answer = {
    value: 'No',
    capture: {
      summary: 'text value',
      actions: ['legacy', { id: 'a2', text: 'obj', status: 'complete' }],
    },
  };
  assert.deepEqual(
    sentActionsForAnswer(answer, ['summary', 'actions', 'moreActions']),
    [
      { id: 'actions-0', text: 'legacy', status: 'pending' },
      { id: 'a2', text: 'obj', status: 'complete' },
    ]
  );
});

test('sentActionsForAnswer: no capture yields empty', () => {
  assert.deepEqual(sentActionsForAnswer({ value: 'No' }, ['actions']), []);
  assert.deepEqual(sentActionsForAnswer(undefined, ['actions']), []);
});

test('allSentActions: flattens across answers; empty when no actions fields are declared', () => {
  /** @type {Record<string, import('../src/sharepoint-client.js').Answer>} */
  const answers = {
    q1: { value: 'No', capture: { actions: ['do a'] } },
    q2: {
      value: 'No',
      capture: { moreActions: [{ id: 'b', text: 'do b', status: 'complete' }] },
    },
  };
  assert.deepEqual(allSentActions(answers, GROUPS), [
    { id: 'actions-0', text: 'do a', status: 'pending' },
    { id: 'b', text: 'do b', status: 'complete' },
  ]);
  assert.deepEqual(allSentActions(answers, []), []);
});

test('remediationTrackingComplete: true only when every sent action is resolved', () => {
  /** @type {Record<string, import('../src/sharepoint-client.js').Answer>} */
  const pending = {
    q1: { value: 'No', capture: { actions: ['still pending'] } },
  };
  assert.equal(remediationTrackingComplete(pending, GROUPS), false);

  /** @type {Record<string, import('../src/sharepoint-client.js').Answer>} */
  const resolved = {
    q1: {
      value: 'No',
      capture: { actions: [{ id: 'a', text: 'x', status: 'complete' }] },
    },
    q2: {
      value: 'No',
      capture: {
        moreActions: [
          { id: 'b', text: 'y', status: 'cancelled', cancelReason: 'dup' },
        ],
      },
    },
  };
  assert.equal(remediationTrackingComplete(resolved, GROUPS), true);
});

test('remediationTrackingComplete: inert (true) on the no-actions path', () => {
  assert.equal(remediationTrackingComplete({}, GROUPS), true);
  assert.equal(
    remediationTrackingComplete({ q1: { value: 'No' } }, GROUPS),
    true
  );
});

test('allSentActions: tolerates a nullish answers map', () => {
  assert.deepEqual(allSentActions(/** @type {any} */ (undefined), GROUPS), []);
});
