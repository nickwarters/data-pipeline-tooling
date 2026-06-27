// @ts-check
import { isFailure } from './failure-evaluator.js';

/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').OutcomeDescriptor} OutcomeDescriptor */
/** @typedef {import('../sharepoint-client.js').OutcomeResult} OutcomeResult */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').RemediationActionDefinition} RemediationActionDefinition */

export const DEFAULT_OUTCOME_RANK = {
  pass: 0,
  refer: 50,
  fail: 100,
};

const FALLBACK_PASS = /** @type {const} */ ({
  verdict: 'pass',
  wording: 'Pass',
  rank: DEFAULT_OUTCOME_RANK.pass,
});

const FALLBACK_FAIL = /** @type {const} */ ({
  verdict: 'fail',
  wording: 'Fail',
  rank: DEFAULT_OUTCOME_RANK.fail,
});

/**
 * @param {'pass' | 'refer' | 'fail'} verdict
 * @returns {string}
 */
export function defaultWordingFor(verdict) {
  if (verdict === 'pass') return 'Pass';
  if (verdict === 'refer') return 'Refer';
  return 'Fail';
}

/**
 * @param {OutcomeDescriptor} descriptor
 * @returns {Required<OutcomeDescriptor>}
 */
export function normaliseOutcome(descriptor) {
  return {
    verdict: descriptor.verdict,
    wording: descriptor.wording || defaultWordingFor(descriptor.verdict),
    rank: descriptor.rank ?? DEFAULT_OUTCOME_RANK[descriptor.verdict],
  };
}

/**
 * Normalises legacy string actions into stable action objects. Existing object
 * actions keep their configured ids and outcomes.
 *
 * @param {QuestionDefinition['remediationActions']} actions
 * @param {string} questionId
 * @returns {RemediationActionDefinition[]}
 */
export function normaliseConfiguredActions(actions = [], questionId = '') {
  return actions.map((action, index) =>
    typeof action === 'string'
      ? { id: `${questionId}-ra-${index}`, text: action }
      : action
  );
}

/**
 * @param {QuestionDefinition[]} questions
 * @param {Record<string, Answer>} answers
 * @returns {OutcomeResult}
 */
export function computeConfiguredOutcome(questions, answers) {
  let best = normaliseOutcome(FALLBACK_PASS);

  for (const question of questions) {
    const answer = answers[question.id];
    if (!isFailure(question, answer)) continue;

    const selectedActionIds = new Set(
      answer.remediationActions?.map((action) => action.id) ?? []
    );
    const actionOutcomes = normaliseConfiguredActions(
      question.remediationActions,
      question.id
    )
      .filter((action) => selectedActionIds.has(action.id))
      .map((action) => action.outcome)
      .filter((outcome) => outcome !== undefined)
      .map((outcome) =>
        normaliseOutcome(/** @type {OutcomeDescriptor} */ (outcome))
      );

    const candidates = actionOutcomes.length
      ? actionOutcomes
      : question.outcome?.noAction
        ? [normaliseOutcome(question.outcome.noAction)]
        : [normaliseOutcome(FALLBACK_FAIL)];

    for (const candidate of candidates) {
      if (candidate.rank > best.rank) best = candidate;
    }
  }

  return { verdict: best.verdict, wording: best.wording };
}
