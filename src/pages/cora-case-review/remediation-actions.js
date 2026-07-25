// @ts-check
import { captureRemediationDetail } from '../../evaluators/remediation-details.js';

/** @typedef {import('../../sharepoint-client.js').Answer} Answer */

/**
 * Apply one configured Remediation Detail edit to route-owned Answers. The
 * existing evaluator remains the single source of truth for clearing and
 * retaining detail fields; the caller sends the returned Answers through the
 * Case Review auto-save effect.
 *
 * Shares the Answer-action contract (#510): `null` means "write nothing" — the
 * viewer cannot edit, or there is no such Answer or configured field.
 *
 * @param {{
 *   answers: Record<string, Answer>,
 *   questionId: string,
 *   key: string,
 *   value: string,
 *   canEdit: boolean,
 *   fields: import('../../sharepoint-client.js').RemediationField[],
 * }} input
 * @returns {Record<string, Answer> | null}
 */
export function editRemediationDetail({
  answers,
  questionId,
  key,
  value,
  canEdit,
  fields,
}) {
  if (!canEdit) return null;
  const answer = answers[questionId];
  const field = fields.find((candidate) => candidate.key === key);
  if (!answer || !field) return null;
  return {
    ...answers,
    [questionId]: captureRemediationDetail(answer, field, value),
  };
}
