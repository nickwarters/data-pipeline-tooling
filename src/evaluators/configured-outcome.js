// @ts-check
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').OutcomeOption} OutcomeOption */
/** @typedef {import('../sharepoint-client.js').OutcomeResult} OutcomeResult */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').RemediationActionDefinition} RemediationActionDefinition */

/**
 * @param {OutcomeOption[]} outcomeOptions
 * @returns {Map<string, { outcome: string, severity: number }>}
 */
function outcomeOptionMap(outcomeOptions = []) {
  return new Map(
    outcomeOptions.map((option) => [
      option.id,
      {
        outcome: option.id,
        severity: option.severity,
      },
    ])
  );
}

export class OutcomeConfigurationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(`Case Type outcome configuration is invalid: ${message}`);
    this.name = 'OutcomeConfigurationError';
  }
}

/**
 * @param {QuestionDefinition[]} questions
 * @param {OutcomeOption[]} outcomeOptions
 * @param {string} defaultOutcomeId
 */
export function validateConfiguredOutcomeConfig(
  questions,
  outcomeOptions,
  defaultOutcomeId
) {
  if (!Array.isArray(outcomeOptions) || !outcomeOptions.length) {
    throw new OutcomeConfigurationError(
      'outcomeOptions must contain at least one option.'
    );
  }
  const optionIds = new Set();
  for (const option of outcomeOptions) {
    if (!option || typeof option.id !== 'string' || !option.id) {
      throw new OutcomeConfigurationError(
        'each outcome option requires an id.'
      );
    }
    if (optionIds.has(option.id)) {
      throw new OutcomeConfigurationError(
        `duplicate outcome id "${option.id}" is not allowed.`
      );
    }
    optionIds.add(option.id);
    if (typeof option.wording !== 'string' || !option.wording) {
      throw new OutcomeConfigurationError(
        `outcome option "${option.id}" requires wording.`
      );
    }
    if (!Number.isFinite(option.severity)) {
      throw new OutcomeConfigurationError(
        `outcome option "${option.id}" requires a finite severity.`
      );
    }
  }
  if (!defaultOutcomeId) {
    throw new OutcomeConfigurationError('defaultOutcomeId is required.');
  }

  const optionById = outcomeOptionMap(outcomeOptions);
  if (!optionById.has(defaultOutcomeId)) {
    throw new OutcomeConfigurationError(
      `defaultOutcomeId "${defaultOutcomeId}" is not configured.`
    );
  }

  for (const question of questions) {
    for (const outcomeId of Object.values(question.optionOutcomes ?? {})) {
      if (!optionById.has(outcomeId)) {
        throw new OutcomeConfigurationError(
          `question "${question.id}" maps to unknown outcome id "${outcomeId}".`
        );
      }
    }
  }
}

/**
 * Normalises legacy string actions into stable action objects. Object actions
 * keep their configured ids. Remediation Actions no longer carry an outcome —
 * the response drives the Outcome, not the action (question bank redesign) — so
 * any legacy `outcome`/`outcomeId` on an action is inert here.
 *
 * @param {QuestionDefinition['remediationActions']} actions
 * @param {string} questionId
 * @returns {RemediationActionDefinition[]}
 */
export function normaliseConfiguredActions(actions = [], questionId = '') {
  return actions.map((action, index) =>
    typeof action === 'string'
      ? { id: `${questionId}-ra-${index}`, text: action }
      : { id: action.id, text: action.text }
  );
}

/**
 * The response values a Reviewer has selected on an Answer, as a flat list. A
 * `single-choice`/`yes-no-na`/`outcome` Answer carries a single string; a
 * `multi-choice` Answer carries an array. An empty/absent value contributes
 * nothing.
 *
 * @param {Answer | undefined} answer
 * @returns {string[]}
 */
function selectedValues(answer) {
  if (!answer) return [];
  const value = answer.value;
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/**
 * Computes a Case's Outcome purely from configuration: each selected response
 * option maps (via the question's `optionOutcomes`) to one of the Case Type's
 * configured Outcomes, and the **highest-scoring applicable Outcome wins**. The
 * response drives the Outcome — Remediation Actions play no part (question bank
 * redesign). Questions are expected to already be the *applicable* set for the
 * current Answers (the case review view-model prunes non-applicable Answers), so
 * only answered questions contribute.
 *
 * The baseline is the configured `defaultOutcomeId`; any mapped response
 * Outcome with severity `>=` the current best replaces it, so ties resolve to
 * the later, more-specific mapping.
 *
 * @param {QuestionDefinition[]} questions
 * @param {Record<string, Answer>} answers
 * @param {OutcomeOption[]} outcomeOptions
 * @param {string} defaultOutcomeId
 * @returns {OutcomeResult}
 */
export function computeConfiguredOutcome(
  questions,
  answers,
  outcomeOptions = [],
  defaultOutcomeId = ''
) {
  validateConfiguredOutcomeConfig(questions, outcomeOptions, defaultOutcomeId);
  const optionById = outcomeOptionMap(outcomeOptions);
  let best = /** @type {{ outcome: string, severity: number }} */ (
    optionById.get(defaultOutcomeId)
  );

  for (const question of questions) {
    const mapping = question.optionOutcomes;
    if (!mapping) continue;
    for (const value of selectedValues(answers[question.id])) {
      const outcomeId = mapping[value];
      if (!outcomeId) continue;
      const candidate = optionById.get(outcomeId);
      if (!candidate) continue;
      if (candidate.severity >= best.severity) best = candidate;
    }
  }

  return { outcome: best.outcome };
}

/**
 * Derives the read-only response options for an `outcome`-type question from the
 * Case Type's configured Outcomes: each configured Outcome becomes a selectable
 * response whose mapped Outcome is itself. Returns the `options` labels (the
 * Outcome wordings) and the matching `optionOutcomes` map (wording → Outcome id).
 *
 * @param {OutcomeOption[]} outcomeOptions
 * @returns {{ options: string[], optionOutcomes: Record<string, string> }}
 */
export function outcomeResponseOptions(outcomeOptions = []) {
  /** @type {string[]} */
  const options = [];
  /** @type {Record<string, string>} */
  const optionOutcomes = {};
  for (const option of outcomeOptions) {
    options.push(option.wording);
    optionOutcomes[option.wording] = option.id;
  }
  return { options, optionOutcomes };
}
