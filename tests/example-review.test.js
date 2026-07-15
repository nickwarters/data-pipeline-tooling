// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../dev/fixtures/example-review-case-type.js';
import { detectCycles } from '../src/evaluators/applicability-evaluator.js';
import { cases } from '../dev/fixtures/cases.js';
import { isOverdue } from '../src/evaluators/overdue-evaluator.js';

/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/**
 * @param {string} value
 * @returns {Answer}
 */
function ans(value) {
  return { value };
}

// --- catalogue shape ---

test('example-review: catalogue has exactly 5 questions', () => {
  assert.strictEqual(config.questions.length, 5);
});

test('example-review: catalogue covers all three response types', () => {
  const types = new Set(config.questions.map((q) => q.responseType));
  assert.ok(types.has('yes-no-na'));
  assert.ok(types.has('single-choice'));
  assert.ok(types.has('multi-choice'));
});

test('example-review: every choice question carries a non-empty options[]', () => {
  for (const q of config.questions) {
    if (
      q.responseType === 'single-choice' ||
      q.responseType === 'multi-choice'
    ) {
      assert.ok(
        Array.isArray(q.options) && q.options.length > 0,
        `${q.id} (${q.responseType}) should have options[]`
      );
    }
  }
});

test('example-review: exactly one question has a showWhen rule', () => {
  const withShowWhen = config.questions.filter((q) => q.showWhen != null);
  assert.strictEqual(withShowWhen.length, 1);
});

test('example-review: showWhen references another question in the catalogue', () => {
  const ids = new Set(config.questions.map((q) => q.id));
  const conditional = config.questions.find((q) => q.showWhen != null);
  assert.ok(conditional, 'expected a question with showWhen');
  const refId = Object.keys(
    /** @type {Record<string,unknown>} */ (conditional.showWhen)
  )[0];
  assert.ok(
    ids.has(refId),
    `showWhen references ${refId} which is not in the catalogue`
  );
});

test('example-review: at least one question has a non-empty remediationActions array', () => {
  const withRemediation = config.questions.filter(
    (q) => q.remediationActions && q.remediationActions.length > 0
  );
  assert.ok(withRemediation.length >= 1);
});

test('example-review: no cycles in showWhen graph', () => {
  assert.strictEqual(detectCycles(config.questions), false);
});

// --- Remediation Details (ADR-0017) ---

test('example-review: declares a remediationFields set with at least one text and one select', () => {
  const fields = config.remediationFields ?? [];
  assert.ok(
    fields.some((f) => f.type === 'text'),
    'expected at least one text field'
  );
  assert.ok(
    fields.some((f) => f.type === 'select'),
    'expected at least one select field'
  );
});

test('example-review: every select remediationField carries a non-empty options[]', () => {
  for (const f of config.remediationFields ?? []) {
    if (f.type === 'select') {
      assert.ok(
        Array.isArray(f.options) && f.options.length > 0,
        `${f.key} (select) should have options[]`
      );
    }
  }
});

// --- Issue Capture groups (ADR-0020) ---

test('example-review: declares captureGroups exercising the text field types', () => {
  const types = new Set(
    (config.captureGroups ?? []).flatMap((g) => g.fields.map((f) => f.type))
  );
  for (const t of ['text', 'textarea', 'select']) {
    assert.ok(
      types.has(/** @type {any} */ (t)),
      `expected a ${t} capture field`
    );
  }
});

test('example-review: capture groups use no radio fields (selects only)', () => {
  const types = (config.captureGroups ?? []).flatMap((g) =>
    g.fields.map((f) => f.type)
  );
  assert.ok(
    !types.includes(/** @type {any} */ ('radio')),
    'capture groups should not use radio fields'
  );
});

test('example-review: capture field keys are unique across groups', () => {
  const keys = (config.captureGroups ?? []).flatMap((g) =>
    g.fields.map((f) => f.key)
  );
  assert.equal(
    new Set(keys).size,
    keys.length,
    'no duplicate capture field keys'
  );
});

test('example-review: every select/radio capture field carries a non-empty options[]', () => {
  for (const g of config.captureGroups ?? []) {
    for (const f of g.fields) {
      if (f.type === 'select' || f.type === 'radio') {
        assert.ok(
          Array.isArray(f.options) && f.options.length > 0,
          `${f.key} (${f.type}) should have options[]`
        );
      }
    }
  }
});

// --- Section config (ADR-0016) ---

test('example-review: sections is a per-Section config object enabling the amended Section set', () => {
  const sections = config.sections ?? {};
  assert.deepEqual(Object.keys(sections).sort(), [
    'amendOutcome',
    'appealRequest',
    'appealReview',
    'conversation',
    'details',
    'issues',
    'notes',
    'questions',
    'remediation',
    'summary',
  ]);
});

test('example-review: declares the Outcome vocabulary for the hand-set Amend Outcome verdict (ADR-0026)', () => {
  const ids = (config.outcomeOptions ?? []).map((o) => o.id);
  // computeOutcome only yields pass/fail, but Controls may amend to refer too.
  assert.deepEqual(ids, ['pass', 'refer', 'fail']);
  for (const option of config.outcomeOptions ?? []) {
    assert.ok(option.wording.length > 0, `${option.id} has wording`);
  }
});

test('example-review: routes appeal-raising to the Journey Owner, resolved by Controls (ADR-0027)', () => {
  assert.deepEqual(config.appeal, {
    raisedBy: 'journeyOwner',
    resolvedBy: 'controls',
  });
});

test('example-review: Notes opts out of the Summary while the other block Sections opt in', () => {
  const sections = config.sections ?? {};
  assert.equal(
    sections.notes?.showInSummary,
    false,
    'Notes is excluded from Summary'
  );
  assert.equal(sections.details?.showInSummary, true);
  assert.equal(sections.questions?.showInSummary, true);
  assert.equal(sections.issues?.showInSummary, true);
  assert.equal(sections.remediation?.showInSummary, true);
});

test('example-review: declares Case Details fields, each with a stable key and label', () => {
  const detailFields = config.detailFields ?? [];
  assert.ok(detailFields.length >= 1, 'has at least one Case Details field');
  for (const field of detailFields) {
    assert.equal(typeof field.key, 'string');
    assert.ok(field.key.length > 0, 'key is non-empty');
    assert.equal(typeof field.label, 'string');
    assert.ok(field.label.length > 0, 'label is non-empty');
  }
});

test('example-review: Case Details field keys are unique', () => {
  const keys = (config.detailFields ?? []).map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
});

// --- computeOutcome ---

test('computeOutcome: all Yes → pass', () => {
  const answers = Object.fromEntries(
    config.questions.map((q) => [q.id, ans('Yes')])
  );
  assert.deepStrictEqual(config.computeOutcome(answers).outcome, 'pass');
});

test('computeOutcome: any No → fail', () => {
  const answers = Object.fromEntries(
    config.questions.map((q) => [q.id, ans('Yes')])
  );
  const first = config.questions.find((q) => q.failureCriteria === 'No');
  assert.ok(first, 'expected a question configured to fail on No');
  answers[first.id] = ans('No');
  assert.deepStrictEqual(config.computeOutcome(answers).outcome, 'fail');
});

test('computeOutcome: informational General question without failureCriteria is outcome-neutral', () => {
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition} */
  const infoQuestion = {
    id: 'q-general-info',
    text: 'Was the case context reviewed?',
    category: 'General',
    responseType: 'yes-no-na',
    deprecated: false,
  };
  config.questions.push(infoQuestion);
  try {
    assert.deepStrictEqual(
      config.computeOutcome({
        [infoQuestion.id]: ans('No'),
      }).outcome,
      'pass'
    );
  } finally {
    config.questions.pop();
  }
});

test('computeOutcome: all N/A → pass', () => {
  const answers = Object.fromEntries(
    config.questions.map((q) => [q.id, ans('N/A')])
  );
  assert.deepStrictEqual(config.computeOutcome(answers).outcome, 'pass');
});

test('computeOutcome: mix of Yes and N/A → pass', () => {
  const [q1, q2, q3] = config.questions;
  const answers = {
    [q1.id]: ans('Yes'),
    [q2.id]: ans('N/A'),
    [q3.id]: ans('Yes'),
  };
  assert.deepStrictEqual(config.computeOutcome(answers).outcome, 'pass');
});

test('computeOutcome: No among Yes and N/A → fail', () => {
  const [q1, q2, q3] = config.questions;
  const answers = {
    [q1.id]: ans('Yes'),
    [q2.id]: ans('No'),
    [q3.id]: ans('N/A'),
  };
  assert.deepStrictEqual(config.computeOutcome(answers).outcome, 'fail');
});

test('computeOutcome: empty answers → pass (no No)', () => {
  assert.deepStrictEqual(config.computeOutcome({}).outcome, 'pass');
});

// --- SLA ---

test('example-review: slaHours is a positive number', () => {
  assert.ok(
    typeof config.slaHours === 'number' && config.slaHours > 0,
    'slaHours should be a positive number'
  );
});

test('example-review fixtures: at least one In-progress case with a past dueDate exists', () => {
  const exampleReviewCases = cases.filter(
    (c) => c.caseType === 'example-review'
  );
  const overdueCases = exampleReviewCases.filter((c) => isOverdue(c, config));
  assert.ok(
    overdueCases.length >= 1,
    'expected at least one overdue example-review fixture case'
  );
});
