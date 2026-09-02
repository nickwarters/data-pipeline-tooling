// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../case-types/complaints.js';
import {
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
import {
  validateGeneralQuestions,
  validateAnswerKeyNamespace,
  unfilledRequiredGeneralQuestion,
  GENERAL_ANSWER_PREFIX,
} from '../src/evaluators/general-questions.js';
import { SHARED_GENERAL_QUESTIONS } from '../case-types/general-questions.js';
import { resolveCompiledOptions } from '../src/pages/question-bank/question-bank-compile.js';
import { cases } from '../dev/fixtures/cases.js';
import { isReportable } from '../src/lib/case-machine.js';

// --- catalogue shape ---

test('complaints: every Question id uses the Case Type prefix and is unique', () => {
  const ids = config.questions.map((question) => question.id);
  for (const id of ids) assert.match(id, /^q-cmp-\d{4}$/, id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate Question ids');
});

// --- Issue Capture Groups ---

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
  // `required` is the one thing an inclusion may add: it says how hard this
  // Case Type insists on an answer, never what the question asks.
  const fields = config.generalQuestions ?? [];
  assert.ok(fields.length > 0);
  for (const field of fields) {
    const shared = SHARED_GENERAL_QUESTIONS[field.key];
    assert.ok(shared, `${field.key} is in the shared catalogue`);
    const { key, required: _required, ...asked } = field;
    assert.deepEqual(
      asked,
      shared,
      `${key} is asked as the catalogue words it`
    );
  }
});

test('complaints: a Case cannot be sent until the Reviewer says how it was reviewed', () => {
  const fields = config.generalQuestions ?? [];
  assert.equal(unfilledRequiredGeneralQuestion(fields, {}), true);
  assert.equal(
    unfilledRequiredGeneralQuestion(fields, {
      [`${GENERAL_ANSWER_PREFIX}reviewChannel`]: { value: 'Call recording' },
    }),
    false,
    'observations are an invitation to say something, not a gate'
  );
});

test('complaints: attributes failures through a tagged person capture field', () => {
  const fields = (config.captureGroups ?? []).flatMap((group) => group.fields);
  const attribution = fields.filter(
    (field) => field.role === 'attributedParty'
  );
  assert.equal(attribution.length, 1);
  assert.equal(attribution[0].type, 'person');
});

// --- Code-owned Case Type structure ---

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

test('complaints: frontline initiates the Conversation at Actions In Progress', () => {
  assert.deepEqual(config.sections?.conversation, {
    allowMessagesWhen: ['Actions In Progress'],
    initiatedBy: 'responsibleParty',
  });
});

test('complaints: offers Group Outcome without naming authored group exceptions', () => {
  assert.equal(config.allowBulkOutcome, true);
  assert.deepEqual(Object.keys(config.questionGroups ?? {}), []);
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

/**
 * The Complaints Cases whose Answers this catalogue is entitled to judge —
 * every one that is not frozen against an older Question Bank version.
 *
 * A Case stamped with a `questionBankVersion` resolves its questions from that
 * version's export, so its Answers answer *that* catalogue: it may hold an
 * Answer to a question since retired, and hold none for questions added after
 * it was reviewed. Both read as defects against today's bank and are correct
 * against its own. The stamped Cases are held to the same rules against the
 * version they name, in published-bank-versions.test.js.
 */
function liveBankComplaintsCases() {
  return cases.filter(
    (c) => c.caseType === 'complaints' && !c.questionBankVersion
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

test('complaints: every outcome-type question declares a non-empty questionGroup', () => {
  // A question with no group silently falls into a group named `General`,
  // which collides with the General Questions section below the groups.
  for (const q of outcomeQuestions()) {
    assert.ok(q.questionGroup, `${q.id} declares a non-empty questionGroup`);
  }
});

test('complaints fixtures: the Cases past the reportable milestone answer every applicable Question', () => {
  const catalogue = config.questions.filter((q) => !q.deprecated);
  const reportable = liveBankComplaintsCases().filter((c) =>
    isReportable(c.status)
  );
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
  for (const row of liveBankComplaintsCases()) {
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
  for (const row of liveBankComplaintsCases()) {
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

// --- Group Outcome ---

/**
 * Pick any unconditional group with one response that is a failure for every
 * target. The equivalence is the contract; neither a particular group nor its
 * current authored wording is.
 */
function groupOutcomeSubject() {
  const groups = new Set(config.questions.map(questionGroupOf));
  for (const questionGroup of groups) {
    const targets = groupOutcomeTargets(config.questions, questionGroup);
    if (targets.length === 0 || targets.some((target) => target.showWhen)) {
      continue;
    }
    const value = (targets[0].options ?? []).find((option) =>
      targets.every((target) =>
        deriveFailureValues(target, config.defaultOutcomeId).includes(option)
      )
    );
    if (value) return { questionGroup, targets, value };
  }
  throw new Error(
    'expected an unconditional Question Group with a shared failing response'
  );
}

test('complaints: a Group Outcome is exactly the same Answers as marking the group one at a time', () => {
  // The property the Group Outcome is built on: it is a write shortcut, not a
  // second way of answering. Seeding one Answer with a failure-lifetime key
  // means both routes have something to materialise over, rather than comparing
  // two runs that never exercised it.
  const { questionGroup, targets, value } = groupOutcomeSubject();
  /** @type {any} */
  const seed = {
    [targets[0].id]: { value, remediationRequired: true },
  };
  const bulk = groupOutcomeSet({
    answers: seed,
    catalogue: config.questions,
    questionGroup,
    value,
    canEdit: true,
  });

  /** @type {any} */
  let one = seed;
  for (const target of targets) {
    one = answerEdited({
      answers: one,
      catalogue: config.questions,
      questionId: target.id,
      value,
      canEdit: true,
    });
  }

  assert.deepEqual(bulk, one);
  assert.deepEqual(
    config.computeOutcome(/** @type {any} */ (bulk)),
    config.computeOutcome(one),
    'the Outcome cannot tell the two routes apart either'
  );
});
