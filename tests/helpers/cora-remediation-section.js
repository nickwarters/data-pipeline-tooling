// @ts-check

/** @typedef {import('../../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../../src/sharepoint-client.js').Answer} Answer */

import { installDom, findByClass, findAllByClass } from '../_dom-stub.js';

installDom();

// ===== IMPORTS (after stubs) =====
const {
  failedQuestions,
  RemediationSection,
  renderRemediationAttribution,
  renderRemediationCapture,
  renderRemediationDetails,
  renderRemediationItem,
  updateRemediationItem,
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
    /** @type {any} */
    this.client = null;
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
    /** @type {Map<string, any>} */
    this._captureEls = new Map();
    /** @type {Map<string, HTMLElement>} */
    this._items = new Map();
    /** @type {Map<string, Answer | undefined>} */
    this._renderedAnswers = new Map();
    this._renderedStructure = null;
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

  /** @param {RemediationSectionProps} props @param {QuestionDefinition[]} failed */
  _structureSignature(props, failed) {
    return JSON.stringify([
      failed.map((question) => question.id),
      props.attributeFailures,
      props.canAttribute,
      props.canCaptureDetails,
      props.canCapture,
      props.canSelectRemediation,
      props.remediationFields.length,
      props.captureGroups.length,
      props.responsibleParty?.loginName ?? null,
    ]);
  }

  _render() {
    const props = this._buildProps();
    const failed = failedQuestions(props);
    if (
      this._renderedStructure !== null &&
      this._renderedStructure === this._structureSignature(props, failed)
    ) {
      for (const question of failed) {
        const li = this._items.get(question.id);
        if (
          li &&
          props.answers[question.id] !== this._renderedAnswers.get(question.id)
        ) {
          updateRemediationItem(props, li, question);
          this._renderedAnswers.set(question.id, props.answers[question.id]);
        }
      }
      return;
    }
    this.replaceChildren(...this.render());
  }

  render() {
    const props = this._buildProps();
    const failed = failedQuestions(props);
    const nodes = RemediationSection(props);
    this._items.clear();
    this._renderedAnswers.clear();
    const items = nodes.flatMap((node) => [
      .../** @type {HTMLElement} */ (node).querySelectorAll(
        '.cora-remediation-item'
      ),
    ]);
    failed.forEach((question, index) => {
      this._items.set(question.id, /** @type {HTMLElement} */ (items[index]));
      this._renderedAnswers.set(question.id, props.answers[question.id]);
    });
    this._renderedStructure = this._structureSignature(props, failed);
    return nodes;
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
      client: this.client,
      responsibleParty: this.responsibleParty,
      canAttribute: this.canAttribute,
      remediationFields: this.remediationFields,
      canCaptureDetails: this.canCaptureDetails,
      captureGroups: this.captureGroups,
      canCapture: this.canCapture,
      captureEls: this._captureEls,
      canSelectRemediation: this.canSelectRemediation,
      dispatchCapture: (questionId, fieldKey, value) =>
        this._emit('cora-capture', { questionId, fieldKey, value }),
      dispatchDetail: (questionId, key, value) =>
        this._emit('cora-remediation-detail', { questionId, key, value }),
      dispatchAttribute: (questionId, attributedParty) =>
        this._emit('cora-attribute', { questionId, attributedParty }),
      dispatchRemediationAction: (questionId, action, selected) =>
        this._emit('cora-remediation-action', {
          questionId,
          action,
          selected,
        }),
      dispatchRemediationFreeForm: (questionId, value) =>
        this._emit('cora-remediation-freeform', { questionId, value }),
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
