// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../case-types/hello-review.js';
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

test('hello-review: catalogue has exactly 5 questions', () => {
  assert.strictEqual(config.questions.length, 5);
});

test('hello-review: catalogue covers all three response types', () => {
  const types = new Set(config.questions.map((q) => q.responseType));
  assert.ok(types.has('yes-no-na'));
  assert.ok(types.has('single-choice'));
  assert.ok(types.has('multi-choice'));
});

test('hello-review: every choice question carries a non-empty options[]', () => {
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

test('hello-review: exactly one question has a showWhen rule', () => {
  const withShowWhen = config.questions.filter((q) => q.showWhen != null);
  assert.strictEqual(withShowWhen.length, 1);
});

test('hello-review: showWhen references another question in the catalogue', () => {
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

test('hello-review: at least one question has a non-empty remediationActions array', () => {
  const withRemediation = config.questions.filter(
    (q) => q.remediationActions && q.remediationActions.length > 0
  );
  assert.ok(withRemediation.length >= 1);
});

test('hello-review: no cycles in showWhen graph', () => {
  assert.strictEqual(detectCycles(config.questions), false);
});

// --- Remediation Details (ADR-0017) ---

test('hello-review: declares a remediationFields set with at least one text and one select', () => {
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

test('hello-review: every select remediationField carries a non-empty options[]', () => {
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

test('hello-review: declares captureGroups exercising all four string field types', () => {
  const types = new Set(
    (config.captureGroups ?? []).flatMap((g) => g.fields.map((f) => f.type))
  );
  for (const t of ['text', 'textarea', 'select', 'radio']) {
    assert.ok(
      types.has(/** @type {any} */ (t)),
      `expected a ${t} capture field`
    );
  }
});

test('hello-review: capture field keys are unique across groups', () => {
  const keys = (config.captureGroups ?? []).flatMap((g) =>
    g.fields.map((f) => f.key)
  );
  assert.equal(
    new Set(keys).size,
    keys.length,
    'no duplicate capture field keys'
  );
});

test('hello-review: every select/radio capture field carries a non-empty options[]', () => {
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

test('hello-review: sections is a per-Section config object enabling all seven Sections', () => {
  const sections = config.sections ?? {};
  assert.deepEqual(Object.keys(sections).sort(), [
    'appeal',
    'conversation',
    'details',
    'notes',
    'questions',
    'remediation',
    'summary',
  ]);
});

test('hello-review: Notes opts out of the Summary while the other block Sections opt in', () => {
  const sections = config.sections ?? {};
  assert.equal(
    sections.notes?.showInSummary,
    false,
    'Notes is excluded from Summary'
  );
  assert.equal(sections.details?.showInSummary, true);
  assert.equal(sections.questions?.showInSummary, true);
  assert.equal(sections.remediation?.showInSummary, true);
});

// --- computeOutcome ---

test('computeOutcome: all Yes → pass', () => {
  const answers = Object.fromEntries(
    config.questions.map((q) => [q.id, ans('Yes')])
  );
  assert.deepStrictEqual(config.computeOutcome(answers), { verdict: 'pass' });
});

test('computeOutcome: any No → fail', () => {
  const answers = Object.fromEntries(
    config.questions.map((q) => [q.id, ans('Yes')])
  );
  const [first] = config.questions;
  answers[first.id] = ans('No');
  assert.deepStrictEqual(config.computeOutcome(answers), { verdict: 'fail' });
});

test('computeOutcome: all N/A → pass', () => {
  const answers = Object.fromEntries(
    config.questions.map((q) => [q.id, ans('N/A')])
  );
  assert.deepStrictEqual(config.computeOutcome(answers), { verdict: 'pass' });
});

test('computeOutcome: mix of Yes and N/A → pass', () => {
  const [q1, q2, q3] = config.questions;
  const answers = {
    [q1.id]: ans('Yes'),
    [q2.id]: ans('N/A'),
    [q3.id]: ans('Yes'),
  };
  assert.deepStrictEqual(config.computeOutcome(answers), { verdict: 'pass' });
});

test('computeOutcome: No among Yes and N/A → fail', () => {
  const [q1, q2, q3] = config.questions;
  const answers = {
    [q1.id]: ans('Yes'),
    [q2.id]: ans('No'),
    [q3.id]: ans('N/A'),
  };
  assert.deepStrictEqual(config.computeOutcome(answers), { verdict: 'fail' });
});

test('computeOutcome: empty answers → pass (no No)', () => {
  assert.deepStrictEqual(config.computeOutcome({}), { verdict: 'pass' });
});

// --- SLA ---

test('hello-review: slaHours is a positive number', () => {
  assert.ok(
    typeof config.slaHours === 'number' && config.slaHours > 0,
    'slaHours should be a positive number'
  );
});

test('hello-review fixtures: at least one In-progress case with a past dueDate exists', () => {
  const helloReviewCases = cases.filter((c) => c.caseType === 'hello-review');
  const overdueCases = helloReviewCases.filter((c) => isOverdue(c, config));
  assert.ok(
    overdueCases.length >= 1,
    'expected at least one overdue hello-review fixture case'
  );
});
