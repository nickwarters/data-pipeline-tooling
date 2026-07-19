// @ts-check
import { buildAmendmentFields } from '../../evaluators/amended-outcome.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').Appeal} Appeal */
/** @typedef {import('../../sharepoint-client.js').AmendedOutcome} AmendedOutcome */

/**
 * Build the next immutable Case row for an additive Appeal request.
 *
 * @param {{
 *   caseRow: CaseRow,
 *   appellant: string,
 *   rationale: string,
 *   citedAnswerKeys: string[],
 *   id: string,
 *   at: string,
 * }} input
 */
export function raiseAppeal(input) {
  /** @type {Appeal} */
  const appeal = {
    id: input.id,
    appellant: input.appellant,
    at: input.at,
    rationale: input.rationale,
    state: 'raised',
  };
  if (input.citedAnswerKeys.length) {
    appeal.citedAnswerKeys = input.citedAnswerKeys;
  }
  const appeals = [...(input.caseRow.appeals ?? []), appeal];
  return { caseRow: { ...input.caseRow, appeals }, appeals };
}

/**
 * Build the immutable Case row and persistence field set for an Appeal
 * resolution. Agreeing includes the linked amendment fields transactionally.
 *
 * @param {{
 *   caseRow: CaseRow,
 *   appealId: string,
 *   verdict: 'agreed'|'rejected',
 *   rationale: string,
 *   resolver: string,
 *   at: string,
 *   outcome?: string,
 *   justification?: string,
 * }} input
 */
export function resolveAppeal(input) {
  /** @type {Appeal['resolution']} */
  const resolution = {
    verdict: input.verdict,
    rationale: input.rationale,
    resolver: input.resolver,
    at: input.at,
  };
  const appeals = (input.caseRow.appeals ?? []).map((appeal) =>
    appeal.id === input.appealId
      ? { ...appeal, state: /** @type {'resolved'} */ ('resolved'), resolution }
      : appeal
  );

  if (input.verdict === 'rejected') {
    return {
      caseRow: { ...input.caseRow, appeals },
      fields: { appeals },
      transactional: false,
    };
  }

  /** @type {AmendedOutcome} */
  const amendment = {
    outcome: input.outcome ?? '',
    justification: input.justification ?? '',
    amendedBy: input.resolver,
    amendedAt: input.at,
    fromAppealId: input.appealId,
  };
  const amendmentFields = buildAmendmentFields(input.caseRow, amendment);
  return {
    caseRow: { ...input.caseRow, appeals, ...amendmentFields },
    fields: { appeals, ...amendmentFields },
    transactional: true,
  };
}

/**
 * Build the immutable Case row and transactional fields for a direct amendment.
 *
 * @param {{
 *   caseRow: CaseRow,
 *   outcome: string,
 *   justification: string,
 *   amendedBy: string,
 *   amendedAt: string,
 * }} input
 */
export function amendOutcome(input) {
  const fields = buildAmendmentFields(input.caseRow, {
    outcome: input.outcome,
    justification: input.justification,
    amendedBy: input.amendedBy,
    amendedAt: input.amendedAt,
  });
  return { caseRow: { ...input.caseRow, ...fields }, fields };
}
