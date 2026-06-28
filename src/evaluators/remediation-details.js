// @ts-check
// TODO(simplify-ui): Preserve this as a pure function/data boundary for the
// simplified component model. Function components should pass data in and
// render results with h(); evaluator modules should stay free of DOM, lifecycle,
// or framework concerns.

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
  if (
    field.type === 'select' &&
    value !== '' &&
    !(field.options ?? []).includes(value)
  ) {
    throw new Error(
      `Invalid value "${value}" for select Remediation Detail "${field.key}".`
    );
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
