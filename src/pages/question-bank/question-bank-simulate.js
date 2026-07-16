// @ts-check
/**
 * Question Bank impact simulator (issue #202).
 *
 * Pure, read-only preview of what publishing a draft bank would do to a set
 * of sample Cases (fixture answers or sampled historical Cases). Nothing here
 * mutates Cases or publishes bank changes — the caller passes plain data in
 * and gets a report back.
 *
 * The simulator replays each sample Case's Answers through both the baseline
 * (published) and draft banks and diffs the results:
 * - applicability paths gained/lost (`evaluate` over each bank's showWhen graph)
 * - newly required Answers (now applicable but unanswered)
 * - Issues added/removed (`isFailure` against each bank's failureCriteria)
 * - the configured Outcome before/after
 * Every per-case change carries `causedBy`: the changed Question Definitions
 * that explain it, walking showWhen references upstream for indirect effects.
 */

/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('./question-bank-source.js').QuestionBank} QuestionBank */

import { evaluate } from '../../evaluators/applicability-evaluator.js';
import { isFailure } from '../../evaluators/failure-evaluator.js';
import { computeConfiguredOutcome } from '../../evaluators/configured-outcome.js';
import { resolveCompiledOptions } from './question-bank-compile.js';

/**
 * A sample Case to replay: a subset of a CaseRow. Missing `answers` simulates
 * an untouched Case; a missing `title` falls back to the id.
 *
 * @typedef {{ id: string, title?: string, answers?: Record<string, Answer> }} SampleCase
 */

/**
 * @typedef {{ id: string, causedBy: string[] }} AttributedChange
 */

/**
 * @typedef {{
 *   caseId: string,
 *   title: string,
 *   changed: boolean,
 *   applicabilityGained: AttributedChange[],
 *   applicabilityLost: AttributedChange[],
 *   newlyRequired: AttributedChange[],
 *   issuesAdded: AttributedChange[],
 *   issuesRemoved: AttributedChange[],
 *   outcome: { before: string|null, after: string|null, changed: boolean, causedBy: string[] },
 * }} CaseImpact
 */

/**
 * @typedef {{
 *   added: string[],
 *   removed: string[],
 *   changed: Array<{ id: string, fields: string[] }>,
 *   outcomeConfigChanged: boolean,
 * }} BankDiff
 */

/** Question fields whose change can alter a Case's review, in report order. */
const COMPARED_FIELDS = /** @type {const} */ ([
  'text',
  'responseType',
  'options',
  'optionOutcomes',
  'showWhen',
  'failureCriteria',
]);

/**
 * Compiles a bank's active (non-deprecated) questions into runtime
 * QuestionDefinition shape: `outcome`-type questions get their options and
 * optionOutcomes derived from the bank's configured Outcomes.
 *
 * @param {QuestionBank} bank
 * @returns {QuestionDefinition[]}
 */
function activeRuntimeQuestions(bank) {
  return bank.questions
    .filter((q) => !q.deprecated)
    .map((q) => {
      const resolved = resolveCompiledOptions(q, bank.outcomeOptions ?? []);
      return /** @type {QuestionDefinition} */ ({
        ...q,
        options: resolved.options ?? undefined,
        optionOutcomes: resolved.optionOutcomes ?? undefined,
      });
    });
}

/**
 * Diffs the draft bank against the baseline bank at the Question Definition
 * level. Deprecation counts as removal and un-deprecation as addition, since
 * that is what the Reviewer-facing catalogue sees. `changed` compares the
 * compiled runtime shape, so `outcome`-type questions register changes to the
 * Outcomes they derive their options from.
 *
 * @param {QuestionBank} baselineBank
 * @param {QuestionBank} draftBank
 * @returns {BankDiff}
 */
export function diffBanks(baselineBank, draftBank) {
  const base = new Map(
    activeRuntimeQuestions(baselineBank).map((q) => [q.id, q])
  );
  const draft = new Map(
    activeRuntimeQuestions(draftBank).map((q) => [q.id, q])
  );

  /** @type {string[]} */
  const added = [];
  /** @type {string[]} */
  const removed = [];
  /** @type {Array<{ id: string, fields: string[] }>} */
  const changed = [];

  for (const id of base.keys()) {
    if (!draft.has(id)) removed.push(id);
  }
  for (const [id, q] of draft) {
    const b = base.get(id);
    if (!b) {
      added.push(id);
      continue;
    }
    const fields = COMPARED_FIELDS.filter(
      (field) =>
        JSON.stringify(q[field] ?? null) !== JSON.stringify(b[field] ?? null)
    );
    if (fields.length) changed.push({ id, fields });
  }

  const outcomeConfigChanged =
    JSON.stringify(baselineBank.outcomeOptions ?? []) !==
      JSON.stringify(draftBank.outcomeOptions ?? []) ||
    (baselineBank.defaultOutcomeId ?? null) !==
      (draftBank.defaultOutcomeId ?? null);

  return { added, removed, changed, outcomeConfigChanged };
}

/**
 * Extracts the question ids referenced by a showWhen condition (leaf keys of
 * `$and`/`$or` groups and plain condition objects).
 *
 * @param {Record<string, unknown> | undefined} cond
 * @param {Set<string>} into
 */
function collectShowWhenRefs(cond, into) {
  if (!cond) return;
  for (const [key, value] of Object.entries(cond)) {
    if (key === '$and' || key === '$or') {
      for (const child of /** @type {Record<string, unknown>[]} */ (value)) {
        collectShowWhenRefs(child, into);
      }
    } else {
      into.add(key);
    }
  }
}

/**
 * Builds the `causedBy` resolver for a simulation: given a question id, walk
 * the union of both banks' showWhen references upstream and return the
 * impacted (added/removed/changed) Question Definitions that explain a change
 * at that question.
 *
 * @param {QuestionDefinition[]} baseQuestions
 * @param {QuestionDefinition[]} draftQuestions
 * @param {BankDiff} diff
 * @returns {(id: string) => string[]}
 */
function makeCausesResolver(baseQuestions, draftQuestions, diff) {
  const impacted = new Set([
    ...diff.added,
    ...diff.removed,
    ...diff.changed.map((c) => c.id),
  ]);

  /** @type {Map<string, Set<string>>} */
  const refsById = new Map();
  for (const q of [...baseQuestions, ...draftQuestions]) {
    const refs = refsById.get(q.id) ?? new Set();
    collectShowWhenRefs(q.showWhen, refs);
    refsById.set(q.id, refs);
  }

  return (id) => {
    /** @type {Set<string>} */
    const causes = new Set();
    /** @type {Set<string>} */
    const visited = new Set();
    const stack = [id];
    while (stack.length) {
      const current = /** @type {string} */ (stack.pop());
      if (visited.has(current)) continue;
      visited.add(current);
      if (impacted.has(current)) causes.add(current);
      for (const ref of refsById.get(current) ?? []) stack.push(ref);
    }
    return [...causes].sort();
  };
}

/**
 * Applicability with the runtime's cascade applied: the case review
 * view-model drops the Answer of any catalogue question that stops being
 * applicable, which can in turn de-apply downstream questions. Iterate to the
 * fixed point so the simulation reflects where a Case would settle. Answers
 * to ids outside the catalogue are kept, mirroring `handleAnswer`.
 *
 * @param {QuestionDefinition[]} questions
 * @param {Record<string, Answer>} answers
 * @returns {{ applicable: Set<string>, prunedAnswers: Record<string, Answer> }}
 */
function stableApplicability(questions, answers) {
  const catalogueIds = new Set(questions.map((q) => q.id));
  let current = answers;
  for (;;) {
    const applicable = evaluate(questions, current);
    /** @type {Record<string, Answer>} */
    const pruned = {};
    let dropped = false;
    for (const [id, answer] of Object.entries(current)) {
      if (!catalogueIds.has(id) || applicable.has(id)) pruned[id] = answer;
      else dropped = true;
    }
    if (!dropped) return { applicable, prunedAnswers: current };
    current = pruned;
  }
}

/**
 * @param {Answer | undefined} answer
 * @returns {boolean}
 */
function isUnanswered(answer) {
  const value = answer?.value;
  return Array.isArray(value) ? value.length === 0 : !value;
}

/**
 * Computes a bank's configured Outcome for one sample Case, pruning Answers
 * to the applicable set the way the case review view-model does. Returns null
 * when the bank has no Outcome configuration or the configuration is invalid
 * — the simulator degrades instead of aborting the whole report.
 *
 * @param {QuestionBank} bank
 * @param {QuestionDefinition[]} questions
 * @param {Set<string>} applicable
 * @param {Record<string, Answer>} answers
 * @returns {string | null}
 */
function outcomeFor(bank, questions, applicable, answers) {
  if (!bank.outcomeOptions?.length || !bank.defaultOutcomeId) return null;
  const applicableQuestions = questions.filter((q) => applicable.has(q.id));
  /** @type {Record<string, Answer>} */
  const pruned = {};
  for (const q of applicableQuestions) {
    if (answers[q.id]) pruned[q.id] = answers[q.id];
  }
  try {
    return computeConfiguredOutcome(
      applicableQuestions,
      pruned,
      bank.outcomeOptions,
      bank.defaultOutcomeId
    ).outcome;
  } catch {
    return null;
  }
}

/**
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {string[]} ids in `a` but not `b`, sorted
 */
function difference(a, b) {
  return [...a].filter((id) => !b.has(id)).sort();
}

/**
 * Simulates the impact of publishing `draftBank` over `baselineBank` against
 * a set of sample Cases. Read-only: neither the banks nor the Cases are
 * mutated, and nothing is published.
 *
 * @param {QuestionBank} baselineBank
 * @param {QuestionBank} draftBank
 * @param {SampleCase[]} sampleCases
 * @returns {{
 *   diff: BankDiff,
 *   cases: CaseImpact[],
 *   totals: {
 *     casesChanged: number,
 *     applicabilityGained: number,
 *     applicabilityLost: number,
 *     newlyRequired: number,
 *     issuesAdded: number,
 *     issuesRemoved: number,
 *     outcomesChanged: number,
 *   },
 * }}
 */
export function simulateBankImpact(baselineBank, draftBank, sampleCases) {
  const baseQuestions = activeRuntimeQuestions(baselineBank);
  const draftQuestions = activeRuntimeQuestions(draftBank);
  const diff = diffBanks(baselineBank, draftBank);
  const causesFor = makeCausesResolver(baseQuestions, draftQuestions, diff);

  /** @param {string} id @returns {AttributedChange} */
  const attributed = (id) => ({ id, causedBy: causesFor(id) });

  const totals = {
    casesChanged: 0,
    applicabilityGained: 0,
    applicabilityLost: 0,
    newlyRequired: 0,
    issuesAdded: 0,
    issuesRemoved: 0,
    outcomesChanged: 0,
  };

  const cases = sampleCases.map((sample) => {
    const answers = sample.answers ?? {};
    const { applicable: baseApplicable, prunedAnswers: baseAnswers } =
      stableApplicability(baseQuestions, answers);
    const { applicable: draftApplicable, prunedAnswers: draftAnswers } =
      stableApplicability(draftQuestions, answers);

    const applicabilityGained = difference(draftApplicable, baseApplicable);
    const applicabilityLost = difference(baseApplicable, draftApplicable);
    const newlyRequired = applicabilityGained.filter((id) =>
      isUnanswered(draftAnswers[id])
    );

    const baseIssues = new Set(
      baseQuestions
        .filter(
          (q) => baseApplicable.has(q.id) && isFailure(q, baseAnswers[q.id])
        )
        .map((q) => q.id)
    );
    const draftIssues = new Set(
      draftQuestions
        .filter(
          (q) => draftApplicable.has(q.id) && isFailure(q, draftAnswers[q.id])
        )
        .map((q) => q.id)
    );
    const issuesAdded = difference(draftIssues, baseIssues);
    const issuesRemoved = difference(baseIssues, draftIssues);

    const before = outcomeFor(
      baselineBank,
      baseQuestions,
      baseApplicable,
      baseAnswers
    );
    const after = outcomeFor(
      draftBank,
      draftQuestions,
      draftApplicable,
      draftAnswers
    );
    const outcomeChanged = before !== after;
    // Attribute the Outcome change to every changed question that moved this
    // Case: contributions enter and leave via Issues, applicability, and
    // optionOutcomes edits on answered applicable questions.
    /** @type {Set<string>} */
    const outcomeCauses = new Set();
    if (outcomeChanged) {
      for (const id of [
        ...issuesAdded,
        ...issuesRemoved,
        ...applicabilityGained,
        ...applicabilityLost,
      ]) {
        for (const cause of causesFor(id)) outcomeCauses.add(cause);
      }
      for (const { id, fields } of diff.changed) {
        if (!fields.includes('optionOutcomes')) continue;
        if (
          (baseApplicable.has(id) || draftApplicable.has(id)) &&
          !isUnanswered(answers[id])
        ) {
          outcomeCauses.add(id);
        }
      }
    }

    const impact = {
      caseId: sample.id,
      title: sample.title ?? sample.id,
      applicabilityGained: applicabilityGained.map(attributed),
      applicabilityLost: applicabilityLost.map(attributed),
      newlyRequired: newlyRequired.map(attributed),
      issuesAdded: issuesAdded.map(attributed),
      issuesRemoved: issuesRemoved.map(attributed),
      outcome: {
        before,
        after,
        changed: outcomeChanged,
        causedBy: [...outcomeCauses].sort(),
      },
      changed:
        outcomeChanged ||
        applicabilityGained.length > 0 ||
        applicabilityLost.length > 0 ||
        issuesAdded.length > 0 ||
        issuesRemoved.length > 0,
    };

    if (impact.changed) totals.casesChanged++;
    totals.applicabilityGained += applicabilityGained.length;
    totals.applicabilityLost += applicabilityLost.length;
    totals.newlyRequired += newlyRequired.length;
    totals.issuesAdded += issuesAdded.length;
    totals.issuesRemoved += issuesRemoved.length;
    if (outcomeChanged) totals.outcomesChanged++;

    return impact;
  });

  return { diff, cases, totals };
}
