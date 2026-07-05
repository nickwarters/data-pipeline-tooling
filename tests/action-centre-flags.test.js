// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATE_REASON_FLAGS,
  reasonFlagFields,
  writeReasonFlag,
} from '../src/services/action-centre-flags.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

test('STATE_REASON_FLAGS covers exactly the four app-written state reasons', () => {
  assert.deepEqual(Object.keys(STATE_REASON_FLAGS).sort(), [
    'appeals',
    'awaitingFrontline',
    'reopened',
    'reviewRequired',
  ]);
});

test('reasonFlagFields: setting a reason stamps flag=true and its clock at `at`', () => {
  const at = '2026-07-05T09:00:00.000Z';
  assert.deepEqual(reasonFlagFields('awaitingFrontline', true, at), {
    awaitingResponsibleParty: true,
    awaitingSince: at,
  });
  assert.deepEqual(reasonFlagFields('appeals', true, at), {
    hasOpenAppeal: true,
    appealRaisedAt: at,
  });
  assert.deepEqual(reasonFlagFields('reopened', true, at), {
    reopened: true,
    reopenedAt: at,
  });
});

test('reasonFlagFields: clearing a reason sets flag=false and nulls its clock', () => {
  assert.deepEqual(reasonFlagFields('awaitingFrontline', false), {
    awaitingResponsibleParty: false,
    awaitingSince: null,
  });
  assert.deepEqual(reasonFlagFields('reopened', false), {
    reopened: false,
    reopenedAt: null,
  });
});

test('reasonFlagFields: reviewRequired writes only the flag (age uses built-in Created)', () => {
  assert.deepEqual(
    reasonFlagFields('reviewRequired', true, '2026-07-05T00:00:00Z'),
    {
      reviewRequired: true,
    }
  );
  assert.deepEqual(reasonFlagFields('reviewRequired', false), {
    reviewRequired: false,
  });
});

test('reasonFlagFields: `at` defaults to now when omitted on a set', () => {
  const before = Date.now();
  const fields = reasonFlagFields('appeals', true);
  const after = Date.now();
  assert.equal(fields.hasOpenAppeal, true);
  const stamped = new Date(
    /** @type {string} */ (fields.appealRaisedAt)
  ).getTime();
  assert.ok(stamped >= before && stamped <= after);
});

test('reasonFlagFields: an unknown reason throws rather than writing a bogus column', () => {
  assert.throws(
    () => reasonFlagFields(/** @type {any} */ ('overdue'), true),
    /Unknown state reason: overdue/
  );
});

test('writeReasonFlag: enqueues the flag pair as one atomic field-level PATCH', () => {
  /** @type {Array<{ caseId: string, fields: Partial<CaseRow> }>} */
  const writes = [];
  const fakeQueue = /** @type {any} */ ({
    enqueueFields: (
      /** @type {string} */ caseId,
      /** @type {Partial<CaseRow>} */ fields
    ) => writes.push({ caseId, fields }),
  });

  writeReasonFlag(
    fakeQueue,
    'case-9',
    'reopened',
    true,
    '2026-07-05T12:00:00Z'
  );

  assert.deepEqual(writes, [
    {
      caseId: 'case-9',
      fields: { reopened: true, reopenedAt: '2026-07-05T12:00:00Z' },
    },
  ]);
});

test('writeReasonFlag: forwards the default `at` when omitted', () => {
  /** @type {Array<Partial<CaseRow>>} */
  const writes = [];
  const fakeQueue = /** @type {any} */ ({
    enqueueFields: (
      /** @type {string} */ _caseId,
      /** @type {Partial<CaseRow>} */ fields
    ) => writes.push(fields),
  });

  writeReasonFlag(fakeQueue, 'case-9', 'awaitingFrontline', true);

  assert.equal(writes[0].awaitingResponsibleParty, true);
  assert.equal(typeof writes[0].awaitingSince, 'string');
});
