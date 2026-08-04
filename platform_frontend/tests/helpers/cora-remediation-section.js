// @ts-check

/** @typedef {import('../../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../../src/sharepoint-client.js').Answer} Answer */

import { installDom, findByClass, findAllByClass } from '../_dom-stub.js';

installDom();

// ===== IMPORTS (after stubs) =====
const { RemediationSection, renderRemediationCapture, renderRemediationItem } =
  await import('../../src/pages/cora-case-review/remediation-view.js');
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
    /** @type {{loginName: string, displayName: string} | null} */
    this.responsibleParty = null;
    /** @type {import('../../src/sharepoint-client.js').CaptureGroup[]} */
    this.captureGroups = [];
    this.canEditIssues = false;
    /** @type {Record<string, Record<string, { query: string, people: any[] }>>} */
    this.captureSearch = {};
  }

  connectedCallback() {
    this._render();
  }

  /** @param {QuestionDefinition[]} catalogue @param {Record<string, Answer>} answers */
  update(catalogue, answers) {
    this.catalogue = catalogue;
    this.answers = answers;
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
      heading: 'Issues',
      catalogue: this.catalogue,
      answers: this.answers,
      responsibleParty: this.responsibleParty,
      captureGroups: this.captureGroups,
      captureCollapsed: {},
      captureSearch: this.captureSearch,
      responsiblePartySearch: { query: '', people: [] },
      canEditIssues: this.canEditIssues,
      dispatchResponsibleParty() {},
      dispatchResponsiblePartySearch() {},
      dispatchCapture: (questionId, fieldKey, value) =>
        this._emit('cora-capture', { questionId, fieldKey, value }),
      dispatchCaptureSearch: (questionId, fieldKey, query) =>
        this._emit('cora-capture-search', { questionId, fieldKey, query }),
      dispatchCaptureToggle() {},
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
