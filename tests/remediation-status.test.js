// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  REMEDIATION_STATUSES,
  REMEDIATION_STATUS_LABELS,
  REMEDIATION_DETAIL_LABELS,
  answerRemediation,
  hasRemediation,
  remediationRows,
  isRemediationResolved,
  remediationComplete,
  setRemediationStatus,
} from '../src/evaluators/remediation-status.js';

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/** @type {QuestionDefinition[]} */
const CATALOGUE = [
  {
    id: 'q1',
    text: 'Greeted the customer?',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
  {
    id: 'q2',
    text: 'Explained the outcome?',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
  {
    id: 'q3',
    text: 'Only applies after q1 fails',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
    showWhen: { q1: { equals: 'No' } },
  },
];

/** @returns {Record<string, Answer>} */
function failedWithActions() {
  return {
    q1: {
      value: 'No',
      remediationActions: [
        { id: 'a1', text: 'Call the customer back', completed: false },
      ],
    },
  };
}

test('answerRemediation: reads selected actions and free-form text; null when neither', () => {
  assert.equal(answerRemediation(undefined), null);
  assert.equal(answerRemediation({ value: 'No' }), null);
  assert.equal(
    answerRemediation({ value: 'No', remediationActions: [] }),
    null
  );
  assert.equal(
    answerRemediation({ value: 'No', freeFormRemediation: '   ' }),
    null
  );

  assert.deepEqual(
    answerRemediation({
      value: 'No',
      remediationActions: [{ id: 'a1', text: 'Refund', completed: false }],
      freeFormRemediation: 'Also apologise',
    }),
    { actions: [{ id: 'a1', text: 'Refund' }], freeForm: 'Also apologise' }
  );

  assert.deepEqual(
    answerRemediation({ value: 'No', freeFormRemediation: 'Apologise' }),
    { actions: [], freeForm: 'Apologise' }
  );
});

test('hasRemediation: true when any Answer carries remediation', () => {
  assert.equal(hasRemediation(failedWithActions()), true);
  assert.equal(
    hasRemediation({ q1: { value: 'No', freeFormRemediation: 'Apologise' } }),
    true
  );
  assert.equal(hasRemediation({ q1: { value: 'No' } }), false);
  assert.equal(hasRemediation({}), false);
  assert.equal(hasRemediation(/** @type {any} */ (undefined)), false);
});

test('remediationRows: only applicable, failed Questions that carry remediation', () => {
  const rows = remediationRows(CATALOGUE, {
    // fails and has remediation -> a row
    q1: {
      value: 'No',
      remediationActions: [{ id: 'a1', text: 'Call back', completed: false }],
    },
    // fails but has no remediation (optional) -> no row
    q2: { value: 'No' },
    // applicable (q1 = No) and carries remediation, but passed -> no row
    q3: {
      value: 'Yes',
      remediationActions: [{ id: 'a2', text: 'Nope', completed: false }],
    },
  });

  assert.deepEqual(
    rows.map((row) => row.question.id),
    ['q1']
  );
  assert.deepEqual(rows[0].actions, [{ id: 'a1', text: 'Call back' }]);
  assert.equal(rows[0].freeForm, '');
  assert.equal(rows[0].status, null);
  assert.equal(rows[0].details, '');
});

test('remediationRows: a non-applicable Question never produces a row', () => {
  // q3 needs q1 = 'No'; here q1 passes, so q3 is not applicable even though it
  // still carries remediation from an earlier edit.
  const rows = remediationRows(CATALOGUE, {
    q1: { value: 'Yes' },
    q3: {
      value: 'No',
      remediationActions: [{ id: 'a3', text: 'Stale', completed: false }],
    },
  });
  assert.deepEqual(rows, []);
});

test('remediationRows: surfaces the stored status and details', () => {
  const rows = remediationRows(CATALOGUE, {
    q1: {
      value: 'No',
      freeFormRemediation: 'Write to the customer',
      remediationStatus: { status: 'partial', details: 'Letter drafted' },
    },
  });
  assert.equal(rows[0].status, 'partial');
  assert.equal(rows[0].details, 'Letter drafted');
  assert.equal(rows[0].freeForm, 'Write to the customer');
});

test('remediationRows: an unrecognised stored status reads as unset', () => {
  const rows = remediationRows(CATALOGUE, {
    q1: /** @type {any} */ ({
      value: 'No',
      freeFormRemediation: 'x',
      remediationStatus: { status: 'nonsense' },
    }),
  });
  assert.equal(rows[0].status, null);
  assert.equal(rows[0].details, '');
});

test('setRemediationStatus: complete drops any details', () => {
  const next = setRemediationStatus(
    { value: 'No', remediationStatus: { status: 'partial', details: 'half' } },
    'complete',
    'ignored'
  );
  assert.deepEqual(next.remediationStatus, { status: 'complete' });
});

test('setRemediationStatus: partial and cancelled keep their text', () => {
  assert.deepEqual(
    setRemediationStatus({ value: 'No' }, 'partial', 'Two of three done')
      .remediationStatus,
    { status: 'partial', details: 'Two of three done' }
  );
  assert.deepEqual(
    setRemediationStatus({ value: 'No' }, 'cancelled', 'Customer declined')
      .remediationStatus,
    { status: 'cancelled', details: 'Customer declined' }
  );
});

test('setRemediationStatus: missing text is stored as empty, leaving the row unresolved', () => {
  const next = setRemediationStatus({ value: 'No' }, 'cancelled', '');
  assert.deepEqual(next.remediationStatus, {
    status: 'cancelled',
    details: '',
  });
  assert.equal(
    isRemediationResolved(/** @type {any} */ (next.remediationStatus)),
    false
  );
});

test('setRemediationStatus: an empty status clears the field entirely', () => {
  const next = setRemediationStatus(
    { value: 'No', remediationStatus: { status: 'complete' } },
    '',
    ''
  );
  assert.equal('remediationStatus' in next, false);
});

test('remediationRows: an unchanged catalogue and Answers reuse the last result', () => {
  // The rows are derived through a full applicability pass, and both the view and
  // the completion gate ask for them on every render — which, while the Reviewer
  // types a justification, is every keystroke. Same inputs, same array.
  const answers = failedWithActions();
  const first = remediationRows(CATALOGUE, answers);
  assert.equal(remediationRows(CATALOGUE, answers), first);

  const edited = {
    ...answers,
    q1: { ...answers.q1, remediationStatus: { status: 'complete' } },
  };
  const second = remediationRows(CATALOGUE, /** @type {any} */ (edited));
  assert.notEqual(second, first);
  assert.equal(second[0].status, 'complete');

  // A different catalogue against the same Answers is not the cached result.
  assert.notEqual(
    remediationRows([CATALOGUE[0]], /** @type {any} */ (edited)),
    second
  );
});

test('setRemediationStatus: clearing an already-unresolved row is a no-op', () => {
  // The caller short-circuits on identity to skip the write. Returning a fresh
  // object for a field that was never there would PATCH the Answers blob — and
  // bump the ETag — for nothing.
  /** @type {Answer} */
  const answer = { value: 'No' };
  assert.equal(setRemediationStatus(answer, '', ''), answer);
});

test('setRemediationStatus: an unrecognised status is rejected, leaving the Answer untouched', () => {
  /** @type {Answer} */
  const answer = { value: 'No', remediationStatus: { status: 'complete' } };
  assert.equal(
    setRemediationStatus(answer, /** @type {any} */ ('done-ish'), ''),
    answer
  );
});

test('isRemediationResolved: complete always; partial/cancelled only with text', () => {
  assert.equal(isRemediationResolved(null), false);
  assert.equal(isRemediationResolved({ status: 'complete' }), true);
  assert.equal(isRemediationResolved({ status: 'partial' }), false);
  assert.equal(
    isRemediationResolved({ status: 'partial', details: '  ' }),
    false
  );
  assert.equal(
    isRemediationResolved({ status: 'partial', details: 'some' }),
    true
  );
  assert.equal(
    isRemediationResolved({ status: 'cancelled', details: 'why' }),
    true
  );
});

test('remediationComplete: every remediation row must be resolved', () => {
  // Answers are replaced, never mutated in place — that is how the store writes
  // them, and what lets `remediationRows` key its cache on identity.
  const answers = failedWithActions();
  assert.equal(remediationComplete(CATALOGUE, answers), false);

  const started = { q1: setRemediationStatus(answers.q1, 'partial', '') };
  assert.equal(
    remediationComplete(CATALOGUE, started),
    false,
    'partial without details is not resolved'
  );

  const finished = {
    q1: setRemediationStatus(answers.q1, 'partial', 'Half done'),
  };
  assert.equal(remediationComplete(CATALOGUE, finished), true);
});

test('remediationComplete: vacuously true when the Case carries no remediation', () => {
  assert.equal(remediationComplete(CATALOGUE, {}), true);
  assert.equal(remediationComplete(CATALOGUE, { q1: { value: 'No' } }), true);
});

test('the status vocabulary is complete/partial/cancelled with viewer-facing labels', () => {
  assert.deepEqual(REMEDIATION_STATUSES, ['complete', 'partial', 'cancelled']);
  assert.deepEqual(REMEDIATION_STATUS_LABELS, {
    complete: 'Complete',
    partial: 'Partially complete',
    cancelled: 'Cancelled',
  });
  assert.deepEqual(REMEDIATION_DETAIL_LABELS, {
    partial: 'Details',
    cancelled: 'Justification',
  });
});
