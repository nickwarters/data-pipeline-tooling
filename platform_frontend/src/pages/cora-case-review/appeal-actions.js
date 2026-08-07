// @ts-check
import { buildAmendmentFields } from '../../evaluators/amended-outcome.js';
import { openAppealFields } from '../../services/action-centre-flags.js';

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
  // The queryable pair travels with the blob it is derived from: the Controls
  // worklist filters the column, never the JSON.
  const fields = { appeals, ...openAppealFields(appeals) };
  return { caseRow: { ...input.caseRow, ...fields }, fields };
}

/**
 * Build the immutable Case row and persistence field set for an Appeal
 * resolution. Agreeing includes the linked amendment fields, which must land in
 * the same PATCH as the Appeal itself.
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

  const appealFields = { appeals, ...openAppealFields(appeals) };

  if (input.verdict === 'rejected') {
    return {
      caseRow: { ...input.caseRow, ...appealFields },
      fields: appealFields,
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
    caseRow: { ...input.caseRow, ...appealFields, ...amendmentFields },
    fields: { ...appealFields, ...amendmentFields },
  };
}

/**
 * Build the immutable Case row and transactional fields for a direct amendment.
 *
 * @param {{
 *   caseRow: CaseRow,
 *   outcome: string,
 *   reason: string,
 *   justification: string,
 *   amendedBy: string,
 *   amendedAt: string,
 * }} input
 */
export function amendOutcome(input) {
  const fields = buildAmendmentFields(input.caseRow, {
    outcome: input.outcome,
    reason: input.reason,
    justification: input.justification,
    amendedBy: input.amendedBy,
    amendedAt: input.amendedAt,
  });
  return { caseRow: { ...input.caseRow, ...fields }, fields };
}
