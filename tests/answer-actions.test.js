// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerEdited,
  failureAttributed,
  issueCaptured,
  remediationActionToggled,
  remediationFreeFormEdited,
  remediationResolved,
} from '../src/pages/cora-case-review/answer-actions.js';

/** @type {any[]} */
const catalogue = [
  {
    id: 'q1',
    text: 'Question one',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
  {
    id: 'q2',
    text: 'Only when q1 is No',
    responseType: 'yes-no-na',
    showWhen: { q1: { equals: 'No' } },
    deprecated: false,
  },
];

const captureGroups = [
  { key: 'cause', fields: [{ key: 'rootCause', label: 'Root cause' }] },
];

// --- answerEdited -----------------------------------------------------------

test('answerEdited: records the value and leaves the caller Answers untouched', () => {
  const answers = /** @type {any} */ ({ q1: { value: 'Yes' } });
  const next = answerEdited({
    answers,
    catalogue,
    questionId: 'q1',
    value: 'No',
    canEdit: true,
  });

  assert.deepEqual(next?.q1, { value: 'No' });
  assert.deepEqual(answers.q1, { value: 'Yes' }, 'the input is not mutated');
});

test('answerEdited: drops Answers to Questions the edit made inapplicable', () => {
  const next = answerEdited({
    answers: /** @type {any} */ ({ q1: { value: 'No' }, q2: { value: 'Yes' } }),
    catalogue,
    questionId: 'q1',
    value: 'Yes',
    canEdit: true,
  });

  assert.equal(next && 'q2' in next, false);
});

test('answerEdited: keeps answer keys outside the catalogue (General Questions)', () => {
  const next = answerEdited({
    answers: /** @type {any} */ ({ 'general:tone': { value: 'Good' } }),
    catalogue,
    questionId: 'q1',
    value: 'Yes',
    canEdit: true,
  });

  assert.deepEqual(next?.['general:tone'], { value: 'Good' });
});

test('answerEdited: an Answer that stops failing sheds its failure-lifecycle keys', () => {
  const next = answerEdited({
    answers: /** @type {any} */ ({
      q1: {
        value: 'No',
        capture: { rootCause: 'Rushed' },
        remediationActions: [{ id: 'ra-0', text: 'Retrain' }],
        freeFormRemediation: 'Escalate',
      },
    }),
    catalogue,
    questionId: 'q1',
    value: 'Yes',
    canEdit: true,
  });

  assert.deepEqual(next?.q1, { value: 'Yes' });
});

test('answerEdited: a read-only Reviewer writes nothing', () => {
  assert.equal(
    answerEdited({
      answers: /** @type {any} */ ({}),
      catalogue,
      questionId: 'q1',
      value: 'No',
      canEdit: false,
    }),
    null
  );
});

// --- issueCaptured ----------------------------------------------------------

test('issueCaptured: writes the captured field onto the Answer', () => {
  const next = issueCaptured({
    answers: /** @type {any} */ ({ q1: { value: 'No' } }),
    captureGroups: /** @type {any} */ (captureGroups),
    questionId: 'q1',
    fieldKey: 'rootCause',
    value: 'Rushed',
    canCapture: true,
  });

  assert.deepEqual(next?.q1.capture, { rootCause: 'Rushed' });
});

test('issueCaptured: writes nothing without the capture guard, Answer, or field', () => {
  const answers = /** @type {any} */ ({ q1: { value: 'No' } });
  const input = {
    answers,
    captureGroups: /** @type {any} */ (captureGroups),
    questionId: 'q1',
    fieldKey: 'rootCause',
    value: 'Rushed',
    canCapture: true,
  };
  assert.equal(issueCaptured({ ...input, canCapture: false }), null);
  assert.equal(issueCaptured({ ...input, questionId: 'missing' }), null);
  assert.equal(issueCaptured({ ...input, fieldKey: 'unknown' }), null);
});

// --- failureAttributed ------------------------------------------------------

test('failureAttributed: attaches and clears the Responsible Party', () => {
  const party = { loginName: 'i:0#.w|corp\\bob', displayName: 'Bob' };
  const attributed = failureAttributed({
    answers: /** @type {any} */ ({ q1: { value: 'No' } }),
    questionId: 'q1',
    attributedParty: party,
    canAttribute: true,
  });
  assert.deepEqual(attributed?.q1.attributedParty, party);

  const cleared = failureAttributed({
    answers: /** @type {any} */ (attributed),
    questionId: 'q1',
    attributedParty: null,
    canAttribute: true,
  });
  assert.equal(cleared && 'attributedParty' in cleared.q1, false);
});

test('failureAttributed: a non-attributing Case Type writes nothing', () => {
  assert.equal(
    failureAttributed({
      answers: /** @type {any} */ ({ q1: { value: 'No' } }),
      questionId: 'q1',
      attributedParty: { loginName: 'x', displayName: 'X' },
      canAttribute: false,
    }),
    null
  );
});

test('failureAttributed: writes nothing when the Answer does not exist', () => {
  assert.equal(
    failureAttributed({
      answers: /** @type {any} */ ({}),
      questionId: 'q1',
      attributedParty: null,
      canAttribute: true,
    }),
    null
  );
});

// --- remediationActionToggled -----------------------------------------------

/** @param {any} [answer] */
function selectionAnswers(answer = { value: 'No' }) {
  return /** @type {any} */ ({ q1: answer });
}

test('remediationActionToggled: ticking writes the selection onto the Answer', () => {
  const next = remediationActionToggled({
    answers: selectionAnswers(),
    questionId: 'q1',
    action: { id: 'ra-0', text: 'Retrain' },
    selected: true,
    canSelectRemediation: true,
  });

  assert.deepEqual(next?.q1.remediationActions, [
    { id: 'ra-0', text: 'Retrain' },
  ]);
});

test('remediationActionToggled: ticking preserves the other selected actions', () => {
  const next = remediationActionToggled({
    answers: selectionAnswers({
      value: 'No',
      remediationActions: [{ id: 'ra-0', text: 'Retrain' }],
    }),
    questionId: 'q1',
    action: { id: 'ra-1', text: 'Update script' },
    selected: true,
    canSelectRemediation: true,
  });

  assert.deepEqual(next?.q1.remediationActions, [
    { id: 'ra-0', text: 'Retrain' },
    { id: 'ra-1', text: 'Update script' },
  ]);
});

test('remediationActionToggled: unticking the last action drops the key', () => {
  const next = remediationActionToggled({
    answers: selectionAnswers({
      value: 'No',
      remediationActions: [{ id: 'ra-0', text: 'Retrain' }],
    }),
    questionId: 'q1',
    action: { id: 'ra-0', text: 'Retrain' },
    selected: false,
    canSelectRemediation: true,
  });

  assert.equal(next && 'remediationActions' in next.q1, false);
});

test('remediationActionToggled: a redundant tick or untick writes nothing', () => {
  const selected = selectionAnswers({
    value: 'No',
    remediationActions: [{ id: 'ra-0', text: 'Retrain' }],
  });
  const action = { id: 'ra-0', text: 'Retrain' };
  assert.equal(
    remediationActionToggled({
      answers: selected,
      questionId: 'q1',
      action,
      selected: true,
      canSelectRemediation: true,
    }),
    null
  );
  assert.equal(
    remediationActionToggled({
      answers: selectionAnswers(),
      questionId: 'q1',
      action,
      selected: false,
      canSelectRemediation: true,
    }),
    null
  );
});

test('remediationActionToggled: writes nothing without the guard or the Answer', () => {
  const action = { id: 'ra-0', text: 'Retrain' };
  assert.equal(
    remediationActionToggled({
      answers: selectionAnswers(),
      questionId: 'q1',
      action,
      selected: true,
      canSelectRemediation: false,
    }),
    null
  );
  assert.equal(
    remediationActionToggled({
      answers: selectionAnswers(),
      questionId: 'missing',
      action,
      selected: true,
      canSelectRemediation: true,
    }),
    null
  );
});

// --- remediationFreeFormEdited ----------------------------------------------

test('remediationFreeFormEdited: stores the text and clears it when empty', () => {
  const stored = remediationFreeFormEdited({
    answers: selectionAnswers(),
    questionId: 'q1',
    value: 'Escalate to legal',
    canSelectRemediation: true,
  });
  assert.equal(stored?.q1.freeFormRemediation, 'Escalate to legal');

  const cleared = remediationFreeFormEdited({
    answers: /** @type {any} */ (stored),
    questionId: 'q1',
    value: '',
    canSelectRemediation: true,
  });
  assert.equal(cleared && 'freeFormRemediation' in cleared.q1, false);
});

test('remediationFreeFormEdited: writes nothing without the guard or the Answer', () => {
  assert.equal(
    remediationFreeFormEdited({
      answers: selectionAnswers(),
      questionId: 'q1',
      value: 'x',
      canSelectRemediation: false,
    }),
    null
  );
  assert.equal(
    remediationFreeFormEdited({
      answers: selectionAnswers(),
      questionId: 'missing',
      value: 'x',
      canSelectRemediation: true,
    }),
    null
  );
});

// --- remediationResolved ----------------------------------------------------

/** @param {any} [answer] */
function trackedAnswers(
  answer = {
    value: 'No',
    remediationActions: [{ id: 'a1', text: 'Do it' }],
  }
) {
  return /** @type {any} */ ({ q1: answer });
}

test('remediationResolved: records a complete resolution', () => {
  const next = remediationResolved({
    answers: trackedAnswers(),
    questionId: 'q1',
    status: 'complete',
    canResolve: true,
  });
  assert.deepEqual(next?.q1.remediationStatus, { status: 'complete' });
});

test('remediationResolved: keeps the details a partial or cancelled resolution carries', () => {
  const next = remediationResolved({
    answers: trackedAnswers(),
    questionId: 'q1',
    status: 'cancelled',
    details: 'Customer declined',
    canResolve: true,
  });
  assert.deepEqual(next?.q1.remediationStatus, {
    status: 'cancelled',
    details: 'Customer declined',
  });
});

test('remediationResolved: an as-yet-empty justification is stored, not dropped', () => {
  const next = remediationResolved({
    answers: trackedAnswers(),
    questionId: 'q1',
    status: 'cancelled',
    canResolve: true,
  });
  assert.deepEqual(next?.q1.remediationStatus, {
    status: 'cancelled',
    details: '',
  });
});

test('remediationResolved: an empty status clears the resolution', () => {
  const resolved = remediationResolved({
    answers: trackedAnswers(),
    questionId: 'q1',
    status: 'complete',
    canResolve: true,
  });
  const cleared = remediationResolved({
    answers: /** @type {any} */ (resolved),
    questionId: 'q1',
    status: '',
    canResolve: true,
  });
  assert.equal(cleared && 'remediationStatus' in cleared.q1, false);
});

test('remediationResolved: a read-only viewer writes nothing', () => {
  assert.equal(
    remediationResolved({
      answers: trackedAnswers(),
      questionId: 'q1',
      status: 'complete',
      canResolve: false,
    }),
    null
  );
});

test('remediationResolved: writes nothing for a missing Answer or an unknown status', () => {
  assert.equal(
    remediationResolved({
      answers: trackedAnswers(),
      questionId: 'missing',
      status: 'complete',
      canResolve: true,
    }),
    null
  );
  assert.equal(
    remediationResolved({
      answers: trackedAnswers(),
      questionId: 'q1',
      status: /** @type {any} */ ('done-ish'),
      canResolve: true,
    }),
    null
  );
});

test('remediationResolved: writes nothing for an Answer carrying no remediation', () => {
  // The write path agrees with the row set the Remediation tab derives: only a
  // Question with remediation attached is a row, so only one can be resolved.
  assert.equal(
    remediationResolved({
      answers: trackedAnswers({ value: 'No' }),
      questionId: 'q1',
      status: 'complete',
      canResolve: true,
    }),
    null
  );
});

test('remediationResolved: clearing an unresolved row writes nothing', () => {
  assert.equal(
    remediationResolved({
      answers: trackedAnswers(),
      questionId: 'q1',
      status: '',
      canResolve: true,
    }),
    null
  );
});
