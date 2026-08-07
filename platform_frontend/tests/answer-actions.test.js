// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NA_VALUE } from '../src/lib/response-options.js';
import {
  answerEdited,
  groupOutcomeSet,
  issueCaptured,
  remediationActionToggled,
  remediationFreeFormEdited,
  remediationRequiredSet,
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
    canEditIssues: true,
  });

  assert.deepEqual(next?.q1.capture, { rootCause: 'Rushed' });
});

test('issueCaptured: writes a person value as an object, and clears it with null', () => {
  const groups = /** @type {any} */ ([
    {
      key: 'cause',
      fields: [{ key: 'attributedTo', label: 'Attributed to', type: 'person' }],
    },
  ]);
  const party = { loginName: 'corp\\jsmith', displayName: 'Jane Smith' };
  const set = issueCaptured({
    answers: /** @type {any} */ ({ q1: { value: 'No' } }),
    captureGroups: groups,
    questionId: 'q1',
    fieldKey: 'attributedTo',
    value: party,
    canEditIssues: true,
  });
  assert.deepEqual(set?.q1.capture, { attributedTo: party });

  assert.equal(
    issueCaptured({
      answers: /** @type {any} */ ({ q1: { value: 'No' } }),
      captureGroups: groups,
      questionId: 'q1',
      fieldKey: 'attributedTo',
      value: party,
      canEditIssues: false,
    }),
    null
  );

  const cleared = issueCaptured({
    answers: /** @type {any} */ (set),
    captureGroups: groups,
    questionId: 'q1',
    fieldKey: 'attributedTo',
    value: null,
    canEditIssues: true,
  });
  assert.equal('capture' in (cleared?.q1 ?? {}), false);
});

test('issueCaptured: writes nothing without the capture guard, Answer, or field', () => {
  const answers = /** @type {any} */ ({ q1: { value: 'No' } });
  const input = {
    answers,
    captureGroups: /** @type {any} */ (captureGroups),
    questionId: 'q1',
    fieldKey: 'rootCause',
    value: 'Rushed',
    canEditIssues: true,
  };
  assert.equal(issueCaptured({ ...input, canEditIssues: false }), null);
  assert.equal(issueCaptured({ ...input, questionId: 'missing' }), null);
  assert.equal(issueCaptured({ ...input, fieldKey: 'unknown' }), null);
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
    canEditIssues: true,
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
    canEditIssues: true,
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
    canEditIssues: true,
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
      canEditIssues: true,
    }),
    null
  );
  assert.equal(
    remediationActionToggled({
      answers: selectionAnswers(),
      questionId: 'q1',
      action,
      selected: false,
      canEditIssues: true,
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
      canEditIssues: false,
    }),
    null
  );
  assert.equal(
    remediationActionToggled({
      answers: selectionAnswers(),
      questionId: 'missing',
      action,
      selected: true,
      canEditIssues: true,
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
    canEditIssues: true,
  });
  assert.equal(stored?.q1.freeFormRemediation, 'Escalate to legal');

  const cleared = remediationFreeFormEdited({
    answers: /** @type {any} */ (stored),
    questionId: 'q1',
    value: '',
    canEditIssues: true,
  });
  assert.equal(cleared && 'freeFormRemediation' in cleared.q1, false);
});

test('remediationFreeFormEdited: writes nothing without the guard or the Answer', () => {
  assert.equal(
    remediationFreeFormEdited({
      answers: selectionAnswers(),
      questionId: 'q1',
      value: 'x',
      canEditIssues: false,
    }),
    null
  );
  assert.equal(
    remediationFreeFormEdited({
      answers: selectionAnswers(),
      questionId: 'missing',
      value: 'x',
      canEditIssues: true,
    }),
    null
  );
});

// --- remediationRequiredSet -------------------------------------------------

test('remediationRequiredSet: records the decision', () => {
  const next = remediationRequiredSet({
    answers: selectionAnswers(),
    questionId: 'q1',
    required: 'yes',
    canEditIssues: true,
  });
  assert.deepEqual(next?.q1, { value: 'No', remediationRequired: 'yes' });
});

test('remediationRequiredSet: "no" clears any remediation already recorded', () => {
  const next = remediationRequiredSet({
    answers: selectionAnswers({
      value: 'No',
      remediationRequired: 'yes',
      remediationActions: [{ id: 'a1', text: 'Do it' }],
      freeFormRemediation: 'And apologise',
    }),
    questionId: 'q1',
    required: 'no',
    canEditIssues: true,
  });
  assert.deepEqual(next?.q1, { value: 'No', remediationRequired: 'no' });
});

test('remediationRequiredSet: writes nothing without the guard, the Answer, or a change', () => {
  assert.equal(
    remediationRequiredSet({
      answers: selectionAnswers(),
      questionId: 'q1',
      required: 'yes',
      canEditIssues: false,
    }),
    null
  );
  assert.equal(
    remediationRequiredSet({
      answers: selectionAnswers(),
      questionId: 'missing',
      required: 'yes',
      canEditIssues: true,
    }),
    null
  );
  assert.equal(
    remediationRequiredSet({
      answers: selectionAnswers({ value: 'No', remediationRequired: 'no' }),
      questionId: 'q1',
      required: 'no',
      canEditIssues: true,
    }),
    null,
    're-selecting the same decision is a no-op'
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

// --- groupOutcomeSet --------------------------------------------------------

const OUTCOMES = ['Good', 'Poor'];

/**
 * Two Question Groups plus a third whose only Question offers a different
 * vocabulary, so every filter the outcome applies has something to exclude.
 *
 * @type {any[]}
 */
const outcomeCatalogue = [
  {
    id: 'v1',
    responseType: 'outcome',
    questionGroup: 'Alpha',
    options: OUTCOMES,
  },
  {
    id: 'v2',
    responseType: 'outcome',
    questionGroup: 'Alpha',
    options: OUTCOMES,
  },
  {
    id: 'v3',
    responseType: 'outcome',
    questionGroup: 'Alpha',
    options: OUTCOMES,
    showWhen: { v1: { equals: 'Poor' } },
  },
  {
    id: 'v4',
    responseType: 'outcome',
    questionGroup: 'Alpha',
    options: OUTCOMES,
    showWhen: { v1: { equals: 'Good' } },
  },
  { id: 'v5', responseType: 'yes-no-na', questionGroup: 'Alpha' },
  {
    id: 'v6',
    responseType: 'outcome',
    questionGroup: 'Alpha',
    options: OUTCOMES,
    deprecated: true,
  },
  {
    id: 'w1',
    responseType: 'outcome',
    questionGroup: 'Beta',
    options: OUTCOMES,
  },
  {
    id: 'x1',
    responseType: 'outcome',
    questionGroup: 'Gamma',
    options: ['Fine'],
  },
];

/** @param {any} overrides */
function outcome(overrides) {
  return groupOutcomeSet({
    answers: /** @type {any} */ ({}),
    catalogue: outcomeCatalogue,
    questionGroup: 'Alpha',
    value: 'Good',
    canEdit: true,
    ...overrides,
  });
}

test('groupOutcomeSet: writes the chosen wording to every applicable Question in the group and nothing else', () => {
  const next = outcome({
    answers: {
      'general:tone': { value: 'Warm' },
      w1: { value: 'Good' },
    },
  });

  assert.deepEqual(Object.keys(next ?? {}).sort(), [
    'general:tone',
    'v1',
    'v2',
    'w1',
  ]);
  assert.deepEqual(next?.v1, { value: 'Good' });
  assert.deepEqual(next?.v2, { value: 'Good' });
  assert.deepEqual(
    next?.w1,
    { value: 'Good' },
    'a Question in another group is untouched'
  );
  assert.deepEqual(
    next?.['general:tone'],
    { value: 'Warm' },
    'General Question answer keys survive'
  );
});

test('groupOutcomeSet: marks the group not applicable', () => {
  const next = outcome({ value: NA_VALUE });
  assert.deepEqual(next?.v1, { value: NA_VALUE });
  assert.deepEqual(next?.v2, { value: NA_VALUE });
});

test('groupOutcomeSet: a Question hidden when the outcome is set is not written', () => {
  const next = outcome({ value: 'Poor' });
  assert.equal('v4' in (next ?? {}), false);
});

test('groupOutcomeSet: a Question the outcome itself reveals is not filled in', () => {
  const next = outcome({ value: 'Poor' });
  assert.equal(
    'v3' in (next ?? {}),
    false,
    'the Reviewer answers a newly revealed Question themselves'
  );
});

test('groupOutcomeSet: an Answer the outcome makes inapplicable is dropped', () => {
  const next = outcome({
    answers: { v1: { value: 'Good' }, v4: { value: 'Good' } },
    value: 'Poor',
  });

  assert.deepEqual(Object.keys(next ?? {}).sort(), ['v1', 'v2']);
});

test('groupOutcomeSet: a read-only Reviewer writes nothing', () => {
  assert.equal(outcome({ canEdit: false }), null);
});

test('groupOutcomeSet: a wording no Question in the group offers writes nothing', () => {
  assert.equal(outcome({ questionGroup: 'Gamma', value: 'Poor' }), null);
});

test('groupOutcomeSet: a group with no eligible Question writes nothing', () => {
  assert.equal(outcome({ questionGroup: 'Delta' }), null);
});

test('groupOutcomeSet: leaves the caller Answers untouched', () => {
  const answers = /** @type {any} */ ({ v1: { value: 'Poor' } });
  outcome({ answers });
  assert.deepEqual(answers, { v1: { value: 'Poor' } });
});

test('groupOutcomeSet: every Answer stays individually editable afterwards', () => {
  const after = outcome({});
  const edited = answerEdited({
    answers: /** @type {any} */ (after),
    catalogue: outcomeCatalogue,
    questionId: 'v2',
    value: 'Poor',
    canEdit: true,
  });

  assert.deepEqual(edited?.v2, { value: 'Poor' });
  assert.deepEqual(
    edited?.v1,
    { value: 'Good' },
    'the rest of the group holds'
  );
});
