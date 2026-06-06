// @ts-check
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').RemediationField} RemediationField */

/**
 * Records a single Remediation Detail value against an Answer (ADR-0017),
 * returning a fresh Answer with the value stored inline under
 * `remediationDetails[field.key]`.
 *
 * @param {Answer} answer
 * @param {RemediationField} field
 * @param {string} value
 * @returns {Answer}
 */
export function captureRemediationDetail(answer, field, value) {
  if (field.type === 'select' && value !== '' && !(field.options ?? []).includes(value)) {
    throw new Error(`Invalid value "${value}" for select Remediation Detail "${field.key}".`);
  }
  const details = { ...answer.remediationDetails };
  if (value === '') {
    delete details[field.key];
  } else {
    details[field.key] = value;
  }
  if (Object.keys(details).length === 0) {
    const { remediationDetails: _drop, ...rest } = answer;
    return rest;
  }
  return { ...answer, remediationDetails: details };
}
