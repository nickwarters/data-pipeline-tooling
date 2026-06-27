// @ts-check
import { isFailure } from './failure-evaluator.js';

/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').OutcomeDescriptor} OutcomeDescriptor */
/** @typedef {import('../sharepoint-client.js').OutcomeOption} OutcomeOption */
/** @typedef {import('../sharepoint-client.js').OutcomeResult} OutcomeResult */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').RemediationActionDefinition} RemediationActionDefinition */

export const DEFAULT_OUTCOME_SEVERITY = {
  pass: 0,
  refer: 50,
  fail: 100,
};

const FALLBACK_PASS = /** @type {const} */ ({
  outcome: 'pass',
  wording: 'Pass',
  severity: DEFAULT_OUTCOME_SEVERITY.pass,
});

const FALLBACK_FAIL = /** @type {const} */ ({
  outcome: 'fail',
  wording: 'Fail',
  severity: DEFAULT_OUTCOME_SEVERITY.fail,
});

/**
 * @param {string} outcome
 * @returns {string}
 */
export function defaultWordingFor(outcome) {
  if (outcome === 'pass') return 'Pass';
  if (outcome === 'refer') return 'Refer';
  if (outcome === 'fail') return 'Fail';
  return outcome;
}

/**
 * @param {OutcomeDescriptor} descriptor
 * @returns {{ outcome: string, wording: string, severity: number }}
 */
export function normaliseOutcome(descriptor) {
  return {
    outcome: descriptor.outcome,
    wording: descriptor.wording || defaultWordingFor(descriptor.outcome),
    severity: descriptor.severity ?? 0,
  };
}

/**
 * @param {OutcomeOption[]} outcomeOptions
 * @returns {Map<string, { outcome: string, wording: string, severity: number }>}
 */
function outcomeOptionMap(outcomeOptions = []) {
  return new Map(
    outcomeOptions.map((option) => [
      option.id,
      {
        outcome: option.id,
        wording: option.wording,
        severity: option.severity ?? 0,
      },
    ])
  );
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
 * @param {OutcomeOption[]} [outcomeOptions]
 * @returns {OutcomeResult}
 */
export function computeConfiguredOutcome(
  questions,
  answers,
  outcomeOptions = []
) {
  let best = normaliseOutcome(FALLBACK_PASS);
  const optionById = outcomeOptionMap(outcomeOptions);

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
      .map((action) =>
        action.outcomeId ? optionById.get(action.outcomeId) : action.outcome
      )
      .filter((outcome) => outcome !== undefined)
      .map((outcome) =>
        normaliseOutcome(/** @type {OutcomeDescriptor} */ (outcome))
      );

    const candidates = actionOutcomes.length
      ? actionOutcomes
      : question.outcome?.noActionOutcomeId &&
          optionById.has(question.outcome.noActionOutcomeId)
        ? [
            /** @type {{ outcome: string, wording: string, severity: number }} */ (
              optionById.get(question.outcome.noActionOutcomeId)
            ),
          ]
        : question.outcome?.noAction
          ? [normaliseOutcome(question.outcome.noAction)]
          : [normaliseOutcome(FALLBACK_FAIL)];

    for (const candidate of candidates) {
      if (candidate.severity >= best.severity) best = candidate;
    }
  }

  return { outcome: best.outcome, wording: best.wording };
}
