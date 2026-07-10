// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../case-types/complaints.js';
import { detectCycles } from '../src/evaluators/applicability-evaluator.js';
import { cases } from '../dev/fixtures/cases.js';

/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/**
 * @param {string} value
 * @returns {Answer}
 */
function ans(value) {
  return { value };
}

// --- catalogue shape ---

test('complaints: catalogue has at least 5 questions', () => {
  assert.ok(config.questions.length >= 5, `got ${config.questions.length}`);
});

test('complaints: catalogue spans at least 2 distinct sections (category)', () => {
  const cats = new Set(config.questions.map((q) => q.category).filter(Boolean));
  assert.ok(cats.size >= 2, `got categories: ${[...cats].join(', ')}`);
});

test('complaints: every choice question carries a non-empty options[]', () => {
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

test('complaints: at least one question has a showWhen rule referencing the catalogue', () => {
  const ids = new Set(config.questions.map((q) => q.id));
  const withShowWhen = config.questions.filter((q) => q.showWhen != null);
  assert.ok(withShowWhen.length >= 1, 'expected at least one showWhen');
  for (const q of withShowWhen) {
    for (const refId of Object.keys(
      /** @type {Record<string,unknown>} */ (q.showWhen)
    )) {
      assert.ok(
        ids.has(refId),
        `${q.id}.showWhen references ${refId} which is not in the catalogue`
      );
    }
  }
});

test('complaints: at least one question has failureCriteria and remediationActions', () => {
  const withBoth = config.questions.filter(
    (q) =>
      q.failureCriteria != null &&
      q.remediationActions &&
      q.remediationActions.length > 0
  );
  assert.ok(withBoth.length >= 1);
});

test('complaints: no cycles in showWhen graph', () => {
  assert.strictEqual(detectCycles(config.questions), false);
});

test('complaints: attributes failures to a person', () => {
  assert.equal(config.attributeFailures, true);
});

test('complaints: slaHours is a positive number', () => {
  assert.ok(
    typeof config.slaHours === 'number' && config.slaHours > 0,
    'slaHours should be a positive number'
  );
});

// --- Section / appeal / outcome config ---

test('complaints: declares no listName so its Cases are openable in the mock store', () => {
  assert.equal(config.listName, undefined);
});

test('complaints: sections enable the appeal/amend Section set', () => {
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

test('complaints: routes appeal-raising to the Journey Owner, resolved by Controls (ADR-0027)', () => {
  assert.deepEqual(config.appeal, {
    raisedBy: 'journeyOwner',
    resolvedBy: 'controls',
  });
});

test('complaints: declares the Outcome vocabulary for the hand-set Amend Outcome verdict (ADR-0026)', () => {
  const ids = (config.outcomeOptions ?? []).map((o) => o.id);
  assert.deepEqual(ids, ['pass', 'refer', 'fail']);
  for (const option of config.outcomeOptions ?? []) {
    assert.ok(option.wording.length > 0, `${option.id} has wording`);
  }
});

test('complaints: declares Case Details fields, each with a stable key and label', () => {
  const detailFields = config.detailFields ?? [];
  assert.ok(detailFields.length >= 1, 'has at least one Case Details field');
  for (const field of detailFields) {
    assert.equal(typeof field.key, 'string');
    assert.ok(field.key.length > 0, 'key is non-empty');
    assert.equal(typeof field.label, 'string');
    assert.ok(field.label.length > 0, 'label is non-empty');
  }
});

// --- computeOutcome (response-driven: highest-scoring applicable outcome) ---

test('complaints computeOutcome: empty answers → pass', () => {
  assert.deepStrictEqual(config.computeOutcome({}).outcome, 'pass');
});

test('complaints computeOutcome: no mapped responses → pass', () => {
  const answers = Object.fromEntries(
    config.questions.map((q) => [q.id, ans('Yes')])
  );
  assert.deepStrictEqual(config.computeOutcome(answers).outcome, 'pass');
});

test('complaints computeOutcome: a response mapped to refer yields refer', () => {
  // A "No" on redress is configured to score `refer`.
  assert.deepStrictEqual(
    config.computeOutcome({ 'q-cm-redress': ans('No') }).outcome,
    'refer'
  );
});

test('complaints computeOutcome: a response mapped to fail yields fail', () => {
  // A "No" on acknowledgement is configured to score `fail`.
  assert.deepStrictEqual(
    config.computeOutcome({ 'q-cm-ack': ans('No') }).outcome,
    'fail'
  );
});

test('complaints computeOutcome: the highest-scoring applicable outcome wins', () => {
  const answers = {
    'q-cm-redress': ans('No'), // refer
    'q-cm-ack': ans('No'), // fail
  };
  assert.deepStrictEqual(config.computeOutcome(answers).outcome, 'fail');
});

// --- q-cm-letter-structure (sentence-length single-choice options) ---

test('complaints: letter-structure question offers three graded sentence-length options within the option cap', () => {
  const q = config.questions.find((x) => x.id === 'q-cm-letter-structure');
  assert.ok(q, 'expected q-cm-letter-structure in the catalogue');
  assert.equal(q.text, 'Is the complaint letter structure used?');
  assert.equal(q.responseType, 'single-choice');
  const options = q.options ?? [];
  assert.equal(options.length, 3);
  for (const option of options) {
    // MAX_OPTION_LENGTH (cora-options-editor): options are capped at 250 chars.
    assert.ok(
      option.length <= 250,
      `option exceeds the 250-char cap (${option.length}): ${option}`
    );
  }
  // Sentence-length wordings are the point of this question: it exercises the
  // stacked-card layout, which triggers above the 40-char threshold.
  assert.ok(
    options.some((option) => option.length > 40),
    'expected at least one sentence-length option'
  );
});

test('complaints computeOutcome: letter-structure grades map to pass, refer and fail', () => {
  const q = config.questions.find((x) => x.id === 'q-cm-letter-structure');
  assert.ok(q && q.options);
  const [noImpact, couldImpact, harm] = q.options;
  assert.equal(
    config.computeOutcome({ 'q-cm-letter-structure': ans(noImpact) }).outcome,
    'pass'
  );
  assert.equal(
    config.computeOutcome({ 'q-cm-letter-structure': ans(couldImpact) })
      .outcome,
    'refer'
  );
  assert.equal(
    config.computeOutcome({ 'q-cm-letter-structure': ans(harm) }).outcome,
    'fail'
  );
  // Only the harm grade flags a failed Answer for the Issues/Remediation flow.
  assert.equal(q.failureCriteria, harm);
});

// --- fixtures ---

test('complaints fixtures: an outstanding and a completed Complaints Case exist', () => {
  const complaints = cases.filter((c) => c.caseType === 'complaints');
  assert.ok(
    complaints.some((c) => c.status === 'In-progress'),
    'expected an outstanding (In-progress) Complaints Case'
  );
  assert.ok(
    complaints.some((c) => c.status === 'Completed'),
    'expected a Completed Complaints Case'
  );
});

test('complaints fixtures: the Completed Case reference answers compute to its frozen outcomeAtCompletion', () => {
  const completed = cases.find(
    (c) => c.caseType === 'complaints' && c.status === 'Completed'
  );
  assert.ok(completed, 'expected a Completed Complaints Case');
  assert.equal(
    config.computeOutcome(completed.answers).outcome,
    completed.outcomeAtCompletion
  );
});
