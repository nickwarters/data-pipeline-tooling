// @ts-check
import { isFailure } from './failure-evaluator.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').Override} Override */
/** @typedef {import('../sharepoint-client.js').RemediationField} RemediationField */

/**
 * The shape a QA Reviewer authors before it becomes a stored {@link Override}:
 * the replacement value plus — for a failing result — the complete replacement
 * set of Remediation Actions / Attributed Party / Remediation Details (replace,
 * never merge, ADR-0018). `reasoning` is mandatory.
 *
 * @typedef {{
 *   answerKey: string,
 *   value: string | string[],
 *   remediationActions?: Array<{id: string, text: string, completed: boolean}>,
 *   attributedParty?: { loginName: string, displayName: string },
 *   remediationDetails?: Record<string, string>,
 *   reasoning: string
 * }} OverrideDraft
 */

/** @typedef {'pass→pass' | 'pass→fail' | 'fail→pass' | 'fail→fail'} Transition */

/**
 * Classify how an Override changes a touched Answer's failure status, comparing
 * the frozen original Answer against the draft value (ADR-0018's three
 * transitions, plus the no-op pass→pass). The driver for whether the completion
 * gate re-applies and whether a Remediation Action set is required.
 *
 * @param {QuestionDefinition} question
 * @param {Answer | undefined} originalAnswer
 * @param {string | string[]} value
 * @returns {Transition}
 */
export function classifyTransition(question, originalAnswer, value) {
  const was = isFailure(question, originalAnswer);
  const now = isFailure(question, { value });
  return `${was ? 'fail' : 'pass'}→${now ? 'fail' : 'pass'}`;
}

/**
 * Validate an Override draft against the Case Type's completion gate (ADR-0018).
 * Returns the list of human-readable problems; an empty array means the draft is
 * safe to save. Reasoning is always required. A **pass→fail** Override re-applies
 * the same completion gate the Case passed for the touched Answer: required
 * Remediation Details (ADR-0017) and — when the Case Type sets `attributeFailures`
 * — an Attributed Party (ADR-0013).
 *
 * @param {OverrideDraft} draft
 * @param {{ question: QuestionDefinition, originalAnswer: Answer | undefined, attributeFailures?: boolean, remediationFields?: RemediationField[] }} context
 * @returns {string[]}
 */
export function validateOverride(draft, context) {
  /** @type {string[]} */
  const errors = [];
  if (!draft.reasoning || draft.reasoning.trim() === '') {
    errors.push('Reasoning is required.');
  }

  // Only a pass→fail Override re-applies the completion gate: it newly attributes
  // a failure, so it must satisfy the same checks the Case did (ADR-0018).
  if (
    classifyTransition(
      context.question,
      context.originalAnswer,
      draft.value
    ) === 'pass→fail'
  ) {
    if (context.attributeFailures && !draft.attributedParty) {
      errors.push('An Attributed Party is required for the failure.');
    }
    for (const field of context.remediationFields ?? []) {
      if (!field.required) continue;
      const captured = draft.remediationDetails?.[field.key];
      if (captured === undefined || captured === '') {
        errors.push(
          `Remediation Detail "${field.label}" is required for the failure.`
        );
      }
    }
  }
  return errors;
}

/**
 * Stamp a validated draft into a stored {@link Override}. Throws if the draft
 * fails {@link validateOverride}, so an invalid correction can never reach the
 * SaveQueue.
 *
 * @param {OverrideDraft} draft
 * @param {{ question: QuestionDefinition, originalAnswer: Answer | undefined, attributeFailures?: boolean, remediationFields?: RemediationField[], author: string, at: string, source?: 'qa' | 'appeal', sourceCaseId?: string, sourceAppealId?: string }} context
 * @returns {Override}
 */
export function buildOverride(draft, context) {
  const errors = validateOverride(draft, context);
  if (errors.length) {
    throw new Error(`Cannot author Override: ${errors.join(' ')}`);
  }
  /** @type {Override} */
  const override = {
    source: context.source ?? 'qa',
    author: context.author,
    at: context.at,
    answerKey: draft.answerKey,
    value: draft.value,
    reasoning: draft.reasoning,
  };
  if (context.sourceCaseId) override.sourceCaseId = context.sourceCaseId;
  if (context.sourceAppealId) override.sourceAppealId = context.sourceAppealId;
  if (draft.remediationActions)
    override.remediationActions = draft.remediationActions;
  if (draft.attributedParty) override.attributedParty = draft.attributedParty;
  if (draft.remediationDetails)
    override.remediationDetails = draft.remediationDetails;
  return override;
}
