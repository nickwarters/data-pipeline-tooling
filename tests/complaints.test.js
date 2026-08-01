// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../case-types/complaints.js';
import {
  detectCycles,
  allApplicableAnswered,
  evaluate,
} from '../src/evaluators/applicability-evaluator.js';
import {
  groupOutcomeTargets,
  questionGroupOf,
} from '../src/pages/cora-case-review/group-outcome-view.js';
import {
  answerEdited,
  groupOutcomeSet,
} from '../src/pages/cora-case-review/answer-actions.js';
import { deriveFailureValues } from '../src/evaluators/failure-evaluator.js';
import { validateCaptureGroups } from '../src/evaluators/issue-capture.js';
import {
  validateGeneralQuestions,
  validateAnswerKeyNamespace,
  GENERAL_ANSWER_PREFIX,
} from '../src/evaluators/general-questions.js';
import { resolveGeneralQuestions } from '../case-types/general-questions.js';
import { reviewerResponseOptions } from '../src/lib/response-options.js';
import { resolveCompiledOptions } from '../src/pages/question-bank/question-bank-compile.js';
import { cases } from '../dev/fixtures/cases.js';
import { isReportable } from '../src/lib/case-machine.js';

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

test('complaints: the catalogue is exactly the q-cmp Question Definitions', () => {
  // The q-cmp catalogue REPLACED the original seven Complaints Questions
  // rather than joining them, so a stray survivor would keep scoring Outcomes
  // and blocking completion from a Question Group nobody expects to see.
  const expected = Array.from(
    { length: 49 },
    (_, index) => `q-cmp-${String(index + 1).padStart(4, '0')}`
  );
  assert.deepEqual(
    config.questions.map((q) => q.id),
    expected
  );
});

test('complaints: catalogue spans at least 2 distinct Question Groups', () => {
  const cats = new Set(
    config.questions.map((q) => q.questionGroup).filter(Boolean)
  );
  assert.ok(cats.size >= 2, `got categories: ${[...cats].join(', ')}`);
});

test('complaints: every choice question carries a non-empty options[]', () => {
  for (const q of config.questions) {
    if (
      q.responseType === 'single-choice' ||
      q.responseType === 'multi-choice' ||
      q.responseType === 'outcome'
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
    const refIds = Object.keys(
      /** @type {Record<string,unknown>} */ (q.showWhen)
    );
    assert.ok(refIds.length >= 1, `${q.id}.showWhen names no question`);
    for (const refId of refIds) {
      assert.ok(
        ids.has(refId),
        `${q.id}.showWhen references ${refId} which is not in the catalogue`
      );
      // A rule whose responses are not authorable options of the question it
      // depends on can never fire, which reads as "the question is broken"
      // rather than "the question is hidden".
      const referenced = config.questions.find((x) => x.id === refId);
      const rule = /** @type {Record<string, Record<string, unknown>>} */ (
        q.showWhen
      )[refId];
      const values =
        'in' in rule
          ? /** @type {string[]} */ (rule['in'])
          : [/** @type {string} */ (rule['equals'])];
      for (const value of values) {
        assert.ok(
          (referenced?.options ?? []).includes(value),
          `${q.id}.showWhen expects ${refId} = "${value}", which is not an option of ${refId}`
        );
      }
    }
  }
});

test('complaints: at least one question maps a failing response and has remediationActions', () => {
  const withBoth = config.questions.filter(
    (q) =>
      deriveFailureValues(q, config.defaultOutcomeId).length > 0 &&
      q.remediationActions &&
      q.remediationActions.length > 0
  );
  assert.ok(withBoth.length >= 1);
});

test('complaints: no cycles in showWhen graph', () => {
  assert.strictEqual(detectCycles(config.questions), false);
});

// --- Issue Capture Groups ---

test('complaints: declares Issue Capture Groups with unique field keys', () => {
  const groups = config.captureGroups ?? [];
  assert.ok(groups.length >= 1, 'expected at least one capture group');
  const keys = groups.flatMap((g) => g.fields.map((f) => f.key));
  assert.ok(keys.length >= 1, 'expected at least one capture field');
  assert.equal(
    new Set(keys).size,
    keys.length,
    'capture field keys must be unique across groups'
  );
  // Passes the same validation gate the loader applies at load time.
  assert.doesNotThrow(() => validateCaptureGroups(groups));
});

test('complaints: General Questions and Question Definition ids pass the load-time gates', () => {
  assert.ok(
    (config.generalQuestions ?? []).length >= 1,
    'expected the live Case Type to declare a General Question'
  );
  assert.doesNotThrow(() => validateGeneralQuestions(config.generalQuestions));
  assert.doesNotThrow(() => validateAnswerKeyNamespace(config.questions));
});

test('complaints: its General Questions are shared ones, resolved to the catalogue definitions', () => {
  // Included by key rather than restated, so the answer keys — and so any
  // cross-Case-Type reporting on them — stay stable as Case Types are added.
  assert.deepEqual(
    config.generalQuestions,
    resolveGeneralQuestions(['reviewChannel', 'reviewerObservations'])
  );
});

test('complaints: every capture field is a supported type with options for choices', () => {
  // The closed `CaptureField.type` set. `'actions'` was removed with the
  // per-action Remediation record: nothing renders it, nothing validates
  // it, and declaring one silently produced a text box writing a string into a
  // slot typed `RemediationAction[]`.
  const allowed = new Set(['text', 'textarea', 'select', 'radio', 'person']);
  for (const group of config.captureGroups ?? []) {
    for (const field of group.fields) {
      assert.ok(
        allowed.has(field.type),
        `${field.key} has unsupported type ${field.type}`
      );
      if (field.type === 'select' || field.type === 'radio') {
        assert.ok(
          Array.isArray(field.options) && field.options.length > 0,
          `${field.key} (${field.type}) should carry a non-empty options[]`
        );
      }
    }
  }
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

test('complaints: declares its own list (Cases-Complaints) like every Case Type', () => {
  assert.equal(config.listName, 'Cases-Complaints');
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

test('complaints: routes appeal-raising to the Journey Owner', () => {
  assert.deepEqual(config.appeal, { raisedBy: 'journeyOwner' });
});

test('complaints: declares the Outcome vocabulary for the hand-set Amend Outcome verdict', () => {
  const ids = (config.outcomeOptions ?? []).map((o) => o.id);
  assert.deepEqual(ids, [
    'good',
    'good-with-process-enhancement',
    'poor',
    'poor-with-harm',
  ]);
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

test('complaints: Case Type descriptors declare no table or dashboard composition', () => {
  assert.equal('dashboardPanels' in config, false);
  assert.equal('caseTableColumns' in config, false);
});

// --- computeOutcome (response-driven: highest-scoring applicable outcome) ---

test('complaints computeOutcome: empty answers → good', () => {
  assert.deepStrictEqual(config.computeOutcome({}).outcome, 'good');
});

test('complaints computeOutcome: no mapped responses → good', () => {
  const answers = Object.fromEntries(
    config.questions.map((q) => [q.id, ans('Yes')])
  );
  assert.deepStrictEqual(config.computeOutcome(answers).outcome, 'good');
});

test('complaints computeOutcome: a response mapped to poor yields poor', () => {
  assert.deepStrictEqual(
    config.computeOutcome({ 'q-cmp-0016': ans('Poor') }).outcome,
    'poor'
  );
});

test('complaints computeOutcome: a response mapped to poor-with-harm yields poor-with-harm', () => {
  assert.deepStrictEqual(
    config.computeOutcome({ 'q-cmp-0001': ans('Poor with harm') }).outcome,
    'poor-with-harm'
  );
});

test('complaints computeOutcome: the highest-scoring applicable outcome wins', () => {
  const answers = {
    'q-cmp-0016': ans('Poor'),
    'q-cmp-0001': ans('Poor with harm'),
  };
  assert.deepStrictEqual(
    config.computeOutcome(answers).outcome,
    'poor-with-harm'
  );
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

test('complaints fixtures: include an On hold Case for the mock Case Review toggle', () => {
  const onHold = cases.find((candidate) => candidate.onHold === true);
  assert.ok(onHold);
  assert.equal(typeof onHold.placedOnHoldAt, 'string');
});

test('complaints config: limits each Reviewer to three active Cases', () => {
  assert.equal(config.maxInProgressCases, 3);
});

/**
 * The Complaints Cases past the reportable milestone, selected on status alone
 * so the rule picks up any Case added later.
 *
 * A Case only reaches this milestone by being reviewed, so an empty Answers
 * blob on one of these rows is a fixture defect, not a demo shortcut.
 */
function reportableComplaintsCases() {
  return cases.filter(
    (c) => c.caseType === 'complaints' && isReportable(c.status)
  );
}

test('complaints fixtures: every reference Case with answers computes to its frozen outcomeAtCompletion', () => {
  const frozen = reportableComplaintsCases();
  assert.ok(frozen.length >= 1, 'expected a frozen-Outcome Complaints Case');
  for (const row of frozen) {
    assert.equal(
      config.computeOutcome(row.answers).outcome,
      row.outcomeAtCompletion,
      `${row.id} recomputes to its frozen Outcome`
    );
  }
});

// --- outcome-type Question Definitions ---

/** The outcome-type questions, in catalogue order. */
function outcomeQuestions() {
  return config.questions.filter((q) => q.responseType === 'outcome');
}

test('complaints: every Question Definition is outcome-scored', () => {
  // The ids themselves are pinned where the catalogue is asserted whole.
  assert.equal(outcomeQuestions().length, config.questions.length);
});

test('complaints: an outcome-type question offers the Case Type Outcomes plus N/A', () => {
  const q = config.questions.find((x) => x.id === 'q-cmp-0001');
  assert.ok(q, 'expected q-cmp-0001 in the catalogue');
  assert.deepEqual(reviewerResponseOptions(q), [
    'Good',
    'Good with process enhancement',
    'Poor',
    'Poor with harm',
    'NA',
  ]);
});

test('complaints: every outcome-type question carries the compiled Outcome options and mapping', () => {
  // The runtime does not derive options for an outcome-type question: it reads
  // whatever the artifact stored. Round-tripping every one of them through the
  // compiler catches the artifact drifting from what a republish would emit.
  for (const q of outcomeQuestions()) {
    const resolved = resolveCompiledOptions(q, config.outcomeOptions ?? []);
    assert.deepEqual(q.options, resolved.options, `${q.id} options`);
    assert.deepEqual(
      q.optionOutcomes,
      resolved.optionOutcomes,
      `${q.id} optionOutcomes`
    );
  }
});

test('complaints: an outcome-type question fails on every non-default Outcome', () => {
  const q = config.questions.find((x) => x.id === 'q-cmp-0001');
  assert.ok(q);
  assert.deepEqual(deriveFailureValues(q, config.defaultOutcomeId), [
    'Good with process enhancement',
    'Poor',
    'Poor with harm',
  ]);
});

test('complaints computeOutcome: an outcome-type answer scores itself', () => {
  // One non-default response is enough to prove an outcome-type Answer reaches
  // computeOutcome; the wording-to-Outcome mapping itself is pinned by the
  // compiled-options round-trip.
  assert.equal(
    config.computeOutcome({ 'q-cmp-0001': ans('Poor with harm') }).outcome,
    'poor-with-harm'
  );
});

test('complaints: every outcome-type question declares a non-empty questionGroup', () => {
  // A question with no group silently falls into a group named `General`,
  // which collides with the General Questions section below the groups.
  for (const q of outcomeQuestions()) {
    assert.ok(q.questionGroup, `${q.id} declares a non-empty questionGroup`);
  }
});

test('complaints fixtures: the Cases past the reportable milestone answer every applicable Question', () => {
  const catalogue = config.questions.filter((q) => !q.deprecated);
  const reportable = reportableComplaintsCases();
  assert.ok(reportable.length >= 1, 'expected a reportable Complaints Case');
  for (const row of reportable) {
    assert.equal(
      allApplicableAnswered(catalogue, row.answers),
      true,
      `${row.id} answers every applicable Question`
    );
  }
});

test('complaints fixtures: no Case past the reportable milestone has empty Answers', () => {
  for (const row of reportableComplaintsCases()) {
    assert.ok(
      Object.keys(row.answers).length > 0,
      `${row.id} is past the reportable milestone with no Answers`
    );
  }
});

test('complaints fixtures: every Answer key names a Question the catalogue still has', () => {
  // An Answer stored against a Question that no longer exists is invisible in
  // the app but still scores the Outcome, so a half-finished rename reads as a
  // Case whose Outcome nothing on screen explains.
  const ids = new Set(config.questions.map((q) => q.id));
  for (const row of cases.filter((c) => c.caseType === 'complaints')) {
    for (const key of Object.keys(row.answers)) {
      if (key.startsWith(GENERAL_ANSWER_PREFIX)) continue;
      assert.ok(
        ids.has(key),
        `${row.id} answers ${key}, which is not in the catalogue`
      );
    }
  }
});

test('complaints fixtures: no Answer is stored against a Question the Case hides', () => {
  // Outcome scoring does not consult applicability, so an Answer left behind on
  // a hidden Question keeps scoring one the Reviewer was never shown. The
  // fixtures decide applicability for themselves, and this is what keeps that
  // decision honest as the conditional Question's rule changes.
  for (const row of cases.filter((c) => c.caseType === 'complaints')) {
    const applicable = evaluate(config.questions, row.answers);
    for (const key of Object.keys(row.answers)) {
      if (key.startsWith(GENERAL_ANSWER_PREFIX)) continue;
      assert.ok(
        applicable.has(key),
        `${row.id} answers ${key}, which its own Answers hide`
      );
    }
  }
});

test('complaints fixtures: the outstanding Case is deliberately not completable', () => {
  const catalogue = config.questions.filter((q) => !q.deprecated);
  const row = cases.find((c) => c.id === 'complaints-case-1');
  assert.ok(row, 'expected complaints-case-1 in the fixtures');
  assert.equal(allApplicableAnswered(catalogue, row.answers), false);
});

test('complaints offers only a complete or cancelled remediation resolution', () => {
  assert.deepEqual(config.remediationStatuses, ['complete', 'cancelled']);
});

// --- Group Outcome ---

test('complaints opts every one of its Question Groups into the Group Outcome', () => {
  const present = [...new Set(config.questions.map(questionGroupOf))];

  assert.equal(config.allowBulkOutcome, true);
  assert.deepEqual(
    Object.keys(config.questionGroups ?? {}),
    [],
    'no group is an exception, so none needs naming'
  );
  assert.equal(present.length, 7);
  for (const group of present) {
    assert.ok(
      groupOutcomeTargets(config.questions, group).length > 0,
      `${group} has at least one Question a Group Outcome can write to`
    );
  }
});

test('complaints: a Regulatory & Reporting Group Outcome can reveal a further Question', () => {
  const gate = config.questions.find((q) => q.id === 'q-cmp-0045');
  const gated = config.questions.find((q) => q.id === 'q-cmp-0046');

  assert.equal(gate?.questionGroup, 'Regulatory & Reporting');
  assert.equal(gated?.questionGroup, 'Regulatory & Reporting');
  assert.equal(gate?.responseType, 'outcome');
  assert.equal(gated?.responseType, 'outcome');
  assert.deepEqual(gated?.showWhen, {
    'q-cmp-0045': {
      in: ['Good with process enhancement', 'Poor', 'Poor with harm'],
    },
  });
});

test('complaints: a Group Outcome is exactly the same Answers as marking the group one at a time', () => {
  // The property the Group Outcome is built on: it is a write shortcut, not a
  // second way of answering. Acknowledgement is the clean subject — no
  // intra-group showWhen. Seeding one Answer with a failure-lifetime key means
  // both routes have something to materialise over, rather than comparing two
  // runs that never exercised it.
  const targets = groupOutcomeTargets(config.questions, 'Acknowledgement');
  /** @type {any} */
  const seed = {
    [targets[0].id]: { value: 'Poor', remediationRequired: true },
  };
  const bulk = groupOutcomeSet({
    answers: seed,
    catalogue: config.questions,
    questionGroup: 'Acknowledgement',
    value: 'Poor',
    canEdit: true,
  });

  /** @type {any} */
  let one = seed;
  for (const target of targets) {
    one = answerEdited({
      answers: one,
      catalogue: config.questions,
      questionId: target.id,
      value: 'Poor',
      canEdit: true,
    });
  }

  assert.equal(targets.length, 7);
  assert.deepEqual(bulk, one);
  assert.deepEqual(
    config.computeOutcome(/** @type {any} */ (bulk)),
    config.computeOutcome(one),
    'the Outcome cannot tell the two routes apart either'
  );
});
