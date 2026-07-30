// @ts-check

/** @typedef {import('../../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../../src/sharepoint-client.js').Answer} Answer */

import { installDom, findByClass, findAllByClass } from '../_dom-stub.js';

installDom();

// ===== IMPORTS (after stubs) =====
const {
  RemediationSection,
  renderRemediationAttribution,
  renderRemediationCapture,
  renderRemediationDetails,
  renderRemediationItem,
} = await import('../../src/pages/cora-case-review/remediation-view.js');
/** @typedef {Parameters<typeof RemediationSection>[0]} RemediationSectionProps */

/**
 * Test-only compatibility harness for the retired custom element API. Product
 * code consumes the pure view directly; these focused behavior tests keep their
 * concise setup while asserting the same public DOM and event contracts.
 */
export class CORARemediationSection extends HTMLElement {
  constructor() {
    super();
    /** @type {QuestionDefinition[]} */
    this.catalogue = [];
    /** @type {Record<string, Answer>} */
    this.answers = {};
    this.attributeFailures = false;
    /** @type {{loginName: string, displayName: string} | null} */
    this.responsibleParty = null;
    this.canAttribute = false;
    /** @type {import('../../src/sharepoint-client.js').RemediationField[]} */
    this.remediationFields = [];
    this.canCaptureDetails = false;
    /** @type {import('../../src/sharepoint-client.js').CaptureGroup[]} */
    this.captureGroups = [];
    this.canCapture = false;
    this.canSelectRemediation = false;
  }

  connectedCallback() {
    this._render();
  }

  /** @param {QuestionDefinition[]} catalogue @param {Record<string, Answer>} answers @param {boolean} [attributeFailures] */
  update(catalogue, answers, attributeFailures = false) {
    this.catalogue = catalogue;
    this.answers = answers;
    this.attributeFailures = attributeFailures;
    this._render();
  }

  _render() {
    this.replaceChildren(...this.render());
  }

  render() {
    return RemediationSection(this._buildProps());
  }

  /** @param {QuestionDefinition} question */
  _renderItem(question) {
    return renderRemediationItem(this._buildProps(), question);
  }

  /** @param {HTMLElement} node @param {QuestionDefinition} question */
  _renderAttribution(node, question) {
    renderRemediationAttribution(this._buildProps(), node, question);
  }

  /** @param {HTMLElement} node @param {QuestionDefinition} question */
  _renderDetails(node, question) {
    renderRemediationDetails(this._buildProps(), node, question);
  }

  /** @param {HTMLElement} node @param {QuestionDefinition} question */
  _renderCapture(node, question) {
    renderRemediationCapture(this._buildProps(), node, question);
  }

  /** @param {string} type @param {any} detail */
  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }

  /** @returns {RemediationSectionProps} */
  _buildProps() {
    return {
      catalogue: this.catalogue,
      answers: this.answers,
      attributeFailures: this.attributeFailures,
      responsibleParty: this.responsibleParty,
      canAttribute: this.canAttribute,
      remediationFields: this.remediationFields,
      canCaptureDetails: this.canCaptureDetails,
      captureGroups: this.captureGroups,
      canCapture: this.canCapture,
      captureCollapsed: {},
      attributionSearch: {},
      canSelectRemediation: this.canSelectRemediation,
      dispatchCapture: (questionId, fieldKey, value) =>
        this._emit('cora-capture', { questionId, fieldKey, value }),
      dispatchCaptureToggle() {},
      dispatchDetail: (questionId, key, value) =>
        this._emit('cora-remediation-detail', { questionId, key, value }),
      dispatchAttribute: (questionId, attributedParty) =>
        this._emit('cora-attribute', { questionId, attributedParty }),
      dispatchAttributeSearch() {},
      dispatchRemediationAction: (questionId, action, selected) =>
        this._emit('cora-remediation-action', {
          questionId,
          action,
          selected,
        }),
      dispatchRemediationFreeForm: (questionId, value) =>
        this._emit('cora-remediation-freeform', { questionId, value }),
      dispatchRemediationRequired: (questionId, required) =>
        this._emit('cora-remediation-required', { questionId, required }),
    };
  }
}

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
    deprecated: false,
  },
];

export const NO_FREEFORM_CAT = [
  { ...FREEFORM_CAT[0], disallowFreeFormRemediation: true },
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
