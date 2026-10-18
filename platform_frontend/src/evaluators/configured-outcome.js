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
  defaultOutcomeId = ''
) {
  if (!Array.isArray(questions)) {
    throw new OutcomeConfigurationError('questions must be an array.');
  }
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
 * current Answers (the Case Review loader prunes non-applicable Answers), so
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
  const optionById = outcomeOptionMap(outcomeOptions);
  let best = /** @type {{ outcome: string, severity: number }} */ (
    optionById.get(defaultOutcomeId)
  );
  if (!best) {
    throw new OutcomeConfigurationError(
      `defaultOutcomeId "${defaultOutcomeId}" is not configured.`
    );
  }

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
 * response whose mapped Outcome is itself.
 *
 * A response is identified by the Outcome's **id**, never its wording: `options`
 * is the list of ids, `optionOutcomes` maps each id to itself, and
 * `optionLabels` carries the wording a Reviewer reads. The id is what an Answer
 * stores, so rewording an Outcome changes what is displayed and nothing that
 * was recorded — the same reason a Case's Outcome snapshot stores the id.
 *
 * @param {OutcomeOption[]} outcomeOptions
 * @returns {{ options: string[], optionOutcomes: Record<string, string>, optionLabels: Record<string, string> }}
 */
export function outcomeResponseOptions(outcomeOptions = []) {
  /** @type {string[]} */
  const options = [];
  /** @type {Record<string, string>} */
  const optionOutcomes = {};
  /** @type {Record<string, string>} */
  const optionLabels = {};
  for (const option of outcomeOptions) {
    options.push(option.id);
    optionOutcomes[option.id] = option.id;
    optionLabels[option.id] = option.wording;
  }
  return { options, optionOutcomes, optionLabels };
}

/**
 * The wording each `outcome`-type question's options are shown with, from the
 * Outcome vocabulary they were published with. Derived where a catalogue is
 * materialised and never stored, so rewording an Outcome reaches every Case
 * without touching one.
 *
 * Only options that are Outcome ids get a label. A question published before
 * Answers stored the id lists the wordings themselves as its options, and
 * those already read as they should.
 *
 * @param {QuestionDefinition[]} questions
 * @param {OutcomeOption[]} outcomeOptions
 * @returns {QuestionDefinition[]}
 */
export function withResponseLabels(questions, outcomeOptions = []) {
  const wordingById = new Map(
    outcomeOptions.map((option) => [option.id, option.wording])
  );
  return questions.map((question) => {
    if (question.responseType !== 'outcome') return question;
    /** @type {Record<string, string>} */
    const optionLabels = {};
    for (const option of question.options ?? []) {
      const wording = wordingById.get(option);
      if (wording !== undefined) optionLabels[option] = wording;
    }
    return Object.keys(optionLabels).length
      ? { ...question, optionLabels }
      : question;
  });
}

/**
 * Upgrades Answers recorded before an `outcome`-type question stored the
 * Outcome id: a value that is not one of the question's options but is the
 * wording of an Outcome whose id is becomes that id. Everything else — an id
 * already, the universal N/A, an unanswered question, a value no Outcome is
 * worded as — is left exactly as stored.
 *
 * Judged against the question's own options, so a Case frozen against a bank
 * published before the change, whose options are still the wordings, keeps
 * the wordings it was reviewed with. The upgrade is in memory; it reaches the
 * Case row with the next write of its Answers.
 *
 * @param {QuestionDefinition[]} questions
 * @param {Record<string, Answer>} answers
 * @param {OutcomeOption[]} outcomeOptions
 * @returns {Record<string, Answer>}
 */
export function withResponseIds(questions, answers, outcomeOptions = []) {
  const idByWording = new Map(
    outcomeOptions.map((option) => [option.wording, option.id])
  );
  /** @type {Record<string, Answer> | null} */
  let upgraded = null;
  for (const question of questions) {
    if (question.responseType !== 'outcome') continue;
    const answer = answers[question.id];
    const value = answer?.value;
    if (typeof value !== 'string' || !value) continue;
    const options = question.options ?? [];
    if (options.includes(value)) continue;
    const id = idByWording.get(value);
    if (id === undefined || !options.includes(id)) continue;
    upgraded ??= { ...answers };
    upgraded[question.id] = { ...answer, value: id };
  }
  return upgraded ?? answers;
}
