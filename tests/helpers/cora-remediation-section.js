// @ts-check

/** @typedef {import('../../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../../src/sharepoint-client.js').Answer} Answer */

import { installDom, findByClass, findAllByClass } from '../_dom-stub.js';

installDom();

// ===== IMPORTS (after stubs) =====
export const { CORARemediationSection } =
  await import('../../src/components/sections/cora-remediation-section.js');

/** @type {QuestionDefinition[]} */
export const CATALOGUE = [
  {
    id: 'q-welcome',
    text: 'Greeted professionally?',
    questionGroup: 'Opening',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    remediationActions: ['Refresh greeting training.'],
    deprecated: false,
  },
  {
    id: 'q-needs',
    text: 'Needs identified?',
    questionGroup: 'Discovery',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    remediationActions: ['Retrain agent.', 'Update script.'],
    deprecated: false,
  },
  {
    id: 'q-resolve',
    text: 'Issue resolved?',
    responseType: 'yes-no-na',
    showWhen: { 'q-needs': { equals: 'Yes' } },
    failureValues: ['No'],
    remediationActions: ['Escalate.'],
    deprecated: false,
  },
];

/**
 * @param {any} root
 * @param {string} tag
 * @returns {any}
 */
export function findByTag(root, tag) {
  for (const c of root._children ?? []) {
    if (c._tagName === tag) return c;
    const nested = findByTag(c, tag);
    if (nested) return nested;
  }
  return null;
}

/** @type {QuestionDefinition[]} */
export const FREEFORM_CAT = [
  {
    id: 'q-free',
    text: 'Followed process?',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    remediationActions: ['Retrain agent.'],
    allowFreeFormRemediation: true,
    deprecated: false,
  },
];

/** @type {QuestionDefinition[]} */
export const FAIL_CAT = [
  {
    id: 'q1',
    text: 'Greeted?',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
];

/** @type {import('../../src/sharepoint-client.js').RemediationField[]} */
export const DETAIL_FIELDS = [
  { key: 'rootCause', label: 'Root cause', type: 'text' },
  {
    key: 'severity',
    label: 'Severity',
    type: 'select',
    options: ['Low', 'Med', 'High'],
  },
];

/** @type {import('../../src/sharepoint-client.js').CaptureGroup[]} */
export const CAPTURE_GROUPS = [
  {
    key: 'cause',
    label: 'Cause',
    collapsed: false,
    fields: [{ key: 'rootCause', label: 'Root cause', type: 'text' }],
  },
];

export { findByClass, findAllByClass };
