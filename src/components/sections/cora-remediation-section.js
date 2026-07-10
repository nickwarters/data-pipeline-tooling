// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import { evaluate } from '../../evaluators/applicability-evaluator.js';
import { isFailure } from '../../evaluators/failure-evaluator.js';
import { buildCaptureControl } from '../../lib/capture-engine.js';
import { AttributeMenu } from './cora-attribute-menu.js';
import './cora-capture-groups.js';

import { normaliseConfiguredActions } from '../../evaluators/configured-outcome.js';

/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {{ loginName: string, displayName: string }} Party */

/**
 * @typedef {object} RemediationSectionProps
 * @property {QuestionDefinition[]} catalogue
 * @property {Record<string, Answer>} answers
 * @property {boolean} attributeFailures
 * @property {SharePointClient | null} client
 * @property {Party | null} responsibleParty
 * @property {boolean} canAttribute
 * @property {import('../../sharepoint-client.js').RemediationField[]} remediationFields
 * @property {boolean} canCaptureDetails
 * @property {import('../../sharepoint-client.js').CaptureGroup[]} captureGroups
 * @property {boolean} canCapture
 * @property {Map<string, import('./cora-capture-groups.js').CORACaptureGroups>} captureEls
 * @property {boolean} canSelectRemediation
 * @property {(questionId: string, fieldKey: string, value: string) => void} dispatchCapture
 * @property {(questionId: string, key: string, value: string) => void} dispatchDetail
 * @property {(questionId: string, attributedParty: Party | null) => void} dispatchAttribute
 * @property {(questionId: string, action: { id: string, text: string }, selected: boolean) => void} dispatchRemediationAction
 * @property {(questionId: string, value: string) => void} dispatchRemediationFreeForm
 */

/**
 * @param {RemediationSectionProps} props
 * @returns {Node[]}
 */
export function RemediationSection(props) {
  const applicable = evaluate(props.catalogue, props.answers);
  const failed = props.catalogue.filter(
    (q) => applicable.has(q.id) && isFailure(q, props.answers[q.id])
  );

  const heading = h('h2', {}, 'Failures');

  if (failed.length === 0) {
    const empty = h('p', { class: 'cora-remediation-empty' }, 'No failures.');
    return [heading, empty];
  }

  const list = h('ul', { class: 'cora-remediation-list' });
  for (const q of failed) {
    list.appendChild(renderRemediationItem(props, q));
  }
  return [heading, list];
}

/**
 * @param {RemediationSectionProps} props
 * @param {QuestionDefinition} q
 * @returns {HTMLElement}
 */
export function renderRemediationItem(props, q) {
  const li = h('li', { class: 'cora-remediation-item' });

  if (q.category) {
    li.appendChild(h('p', { class: 'cora-remediation-category' }, q.category));
  }

  li.appendChild(h('p', { class: 'cora-remediation-question' }, q.text));

  const v = props.answers[q.id]?.value;
  const ansText = `Answer: ${Array.isArray(v) ? v.join(', ') : (v ?? '')}`;
  li.appendChild(h('p', { class: 'cora-remediation-answer' }, ansText));

  if (props.attributeFailures) {
    renderRemediationAttribution(props, li, q);
  }

  if (props.remediationFields?.length) {
    renderRemediationDetails(props, li, q);
  }

  if (props.captureGroups?.length) {
    renderRemediationCapture(props, li, q);
  }

  renderRemediationActions(props, li, q);

  return li;
}

/**
 * Renders the reviewer-selectable **Remediation Actions** for a failed item
 *. Each configured action is an independent checkbox, unticked
 * unless the reviewer has already selected it (i.e. its id is present on
 * `answer.remediationActions`); ticking/unticking re-dispatches a bubbling
 * `cora-remediation-action` so the page persists the selected subset onto the
 * Answer. When the Question opts into free-form remediation, an extra text
 * input lets the reviewer add their own action. Read-only viewers see only the
 * selected canned actions and any captured free-form text, both as plain text.
 *
 * @param {RemediationSectionProps} props
 * @param {HTMLElement} li
 * @param {QuestionDefinition} q
 */
export function renderRemediationActions(props, li, q) {
  const answer = props.answers[q.id];
  const selectedIds = new Set(
    (answer?.remediationActions ?? []).map((action) => action.id)
  );
  const configured = normaliseConfiguredActions(
    q.remediationActions ?? [],
    q.id
  );
  const editable = props.canSelectRemediation;
  const visible = editable
    ? configured
    : configured.filter((action) => selectedIds.has(action.id));

  if (visible.length) {
    li.appendChild(
      h(
        'p',
        { class: 'cora-remediation-actions-heading' },
        'Remediation Actions'
      )
    );
    const actions = h('ul', { class: 'cora-remediation-actions' });
    for (const action of visible) {
      actions.appendChild(
        editable
          ? renderRemediationActionCheckbox(
              props,
              q,
              action,
              selectedIds.has(action.id)
            )
          : h('li', { class: 'cora-remediation-action' }, action.text)
      );
    }
    li.appendChild(actions);
  }

  if (q.allowFreeFormRemediation) {
    renderRemediationFreeForm(props, li, q, answer?.freeFormRemediation ?? '');
  }
}

/**
 * @param {RemediationSectionProps} props
 * @param {QuestionDefinition} q
 * @param {import('../../sharepoint-client.js').RemediationActionDefinition} action
 * @param {boolean} checked
 * @returns {HTMLElement}
 */
function renderRemediationActionCheckbox(props, q, action, checked) {
  return h(
    'li',
    { class: 'cora-remediation-action' },
    h(
      'label',
      {},
      h('input', {
        type: 'checkbox',
        class: 'cora-remediation-action-checkbox',
        checked,
        onchange: (/** @type {any} */ event) => {
          props.dispatchRemediationAction(
            q.id,
            { id: action.id, text: action.text },
            event.target.checked
          );
        },
      }),
      h('span', {}, ` ${action.text}`)
    )
  );
}

/**
 * @param {RemediationSectionProps} props
 * @param {HTMLElement} li
 * @param {QuestionDefinition} q
 * @param {string} value
 */
function renderRemediationFreeForm(props, li, q, value) {
  if (!props.canSelectRemediation) {
    if (value) {
      li.appendChild(
        h('p', { class: 'cora-remediation-freeform-value' }, value)
      );
    }
    return;
  }

  li.appendChild(
    h(
      'div',
      { class: 'cora-remediation-freeform' },
      h(
        'label',
        { class: 'cora-remediation-freeform-label' },
        'Free-form action'
      ),
      h('input', {
        type: 'text',
        class: 'cora-remediation-freeform-input',
        value,
        placeholder: 'Describe a remediation in your own words…',
        onchange: (/** @type {any} */ event) => {
          props.dispatchRemediationFreeForm(q.id, event.target.value);
        },
      })
    )
  );
}

/**
 * @param {RemediationSectionProps} props
 * @param {HTMLElement} li
 * @param {QuestionDefinition} q
 */
export function renderRemediationAttribution(props, li, q) {
  const attributedParty = props.answers[q.id]?.attributedParty;

  if (!props.canAttribute) {
    if (attributedParty) {
      li.appendChild(
        h(
          'p',
          { class: 'cora-remediation-attributed-party' },
          `Attributed to: ${attributedParty.displayName}`
        )
      );
    }
    return;
  }

  const menu = AttributeMenu({
    client: props.client,
    responsibleParty: props.responsibleParty,
    attributedParty: attributedParty ?? null,
    onChange: (/** @type {Party | null} */ party) => {
      props.dispatchAttribute(q.id, party);
    },
  });
  li.appendChild(/** @type {any} */ (menu));
}

/**
 * @param {RemediationSectionProps} props
 * @param {HTMLElement} li
 * @param {QuestionDefinition} q
 */
export function renderRemediationDetails(props, li, q) {
  const details = props.answers[q.id]?.remediationDetails ?? {};

  for (const field of props.remediationFields) {
    if (!props.canCaptureDetails) {
      const captured = details[field.key];
      if (captured === undefined || captured === '') continue;
      li.appendChild(
        h(
          'p',
          { class: 'cora-remediation-detail-value' },
          `${field.label}: ${captured}`
        )
      );
      continue;
    }

    const control = buildCaptureControl(
      field,
      details[field.key] ?? '',
      (value) => {
        props.dispatchDetail(q.id, field.key, value);
      },
      'cora-remediation-detail-input'
    );

    const wrap = h(
      'div',
      { class: 'cora-remediation-detail-field' },
      h('label', { class: 'cora-remediation-detail-label' }, field.label),
      control
    );

    li.appendChild(wrap);
  }
}

/**
 * @param {RemediationSectionProps} props
 * @param {HTMLElement} li
 * @param {QuestionDefinition} q
 */
export function renderRemediationCapture(props, li, q) {
  let cg = props.captureEls.get(q.id);
  if (!cg) {
    cg = /** @type {import('./cora-capture-groups.js').CORACaptureGroups} */ (
      h('cora-capture-groups', {
        'oncora-capture': (/** @type {any} */ ev) => {
          /** @type {any} */ (ev).stopPropagation?.();
          const { fieldKey, value } =
            /** @type {CustomEvent<{ fieldKey: string, value: string }>} */ (ev)
              .detail;
          props.dispatchCapture(q.id, fieldKey, value);
        },
      })
    );
    props.captureEls.set(q.id, cg);
  }
  const capture = props.answers[q.id]?.capture ?? {};
  cg.groups = props.captureGroups;
  cg.capture = capture;
  cg.canCapture = props.canCapture;
  cg.update?.(props.captureGroups, capture, props.canCapture);
  li.appendChild(/** @type {any} */ (cg));
}

export class CORARemediationSection extends ShellElement {
  constructor() {
    super();
    /** @type {QuestionDefinition[]} */
    this.catalogue = [];
    /** @type {Record<string, Answer>} */
    this.answers = {};
    /** @type {boolean} Whether this Case Type attributes failures to a person. */
    this.attributeFailures = false;
    /** @type {SharePointClient | null} Backs the embedded people picker. */
    this.client = null;
    /**
     * The Case's Responsible Party, offered as a one-click quick-pick in each
     * attribute menu. `null` when the Case has none. the architecture decision.
     * @type {Party | null}
     */
    this.responsibleParty = null;
    /**
     * Whether the viewer may set/change/clear the Attributed Party: Assigned
     * Reviewer only, on an In-progress Case (frozen at completion). UX-only per
     * the architecture decision/0011; the server ACL is the real boundary.
     * @type {boolean}
     */
    this.canAttribute = false;
    /**
     * The Case Type's configurable per-failure capture fields. One
     * shared set applies to every failed Answer; empty when the Case Type
     * declares none.
     * @type {import('../../sharepoint-client.js').RemediationField[]}
     */
    this.remediationFields = [];
    /**
     * Whether the viewer may capture Remediation Details. Mirrors `canAttribute`:
     * Assigned Reviewer only, on an In-progress Case (frozen at completion).
     * @type {boolean}
     */
    this.canCaptureDetails = false;
    /**
     * The Case Type's unified **Issue Capture Group**s. Empty when the
     * Case Type declares none. Both `captureGroups` and `remediationFields` may coexist.
     * @type {import('../../sharepoint-client.js').CaptureGroup[]}
     */
    this.captureGroups = [];
    /**
     * Whether the viewer may capture Issue Capture values. Mirrors `canAttribute`:
     * Assigned Reviewer only, on an In-progress Case (frozen at completion).
     * @type {boolean}
     */
    this.canCapture = false;
    /**
     * Whether the viewer may select which Remediation Actions apply to a failed
     * Answer and add a free-form action. Assigned Reviewer only, on
     * a not-yet-reportable Case; read-only viewers see the selected subset.
     * @type {boolean}
     */
    this.canSelectRemediation = false;
    /**
     * Per-failed-Answer `cora-capture-groups` instances, keyed by question id and
     * reused across re-renders so each group's ephemeral collapse state survives
     * an autosave-triggered re-render.
     * @type {Map<string, import('./cora-capture-groups.js').CORACaptureGroups>}
     */
    this._captureEls = new Map();
  }

  /**
   * @param {QuestionDefinition[]} catalogue
   * @param {Record<string, Answer>} answers
   * @param {boolean} [attributeFailures]
   */
  update(catalogue, answers, attributeFailures = false) {
    this.catalogue = catalogue;
    this.answers = answers;
    this.attributeFailures = attributeFailures;
    this._render();
  }

  _render() {
    const els = this.render();
    if (Array.isArray(els)) this.replaceChildren(...els);
    else if (els) this.replaceChildren(els);
    else this.replaceChildren();
  }

  render() {
    return RemediationSection(this._props());
  }

  /**
   * @param {QuestionDefinition} q
   * @returns {HTMLElement}
   */
  _renderItem(q) {
    return renderRemediationItem(this._props(), q);
  }

  /**
   * Renders the Attributed Party surface on a failed item. Read-only
   * viewers see just the cached displayName. Editors get the inline
   * `cora-attribute-menu`, always visible, offering the Responsible Party
   * quick-pick and people search; its `cora-attribute-change` is re-dispatched
   * here as a bubbling `cora-attribute` carrying the question id.
   * Persistence is the page's responsibility so the answers signal stays the
   * single source of truth.
   *
   * @param {HTMLElement} li
   * @param {QuestionDefinition} q
   */
  _renderAttribution(li, q) {
    renderRemediationAttribution(this._props(), li, q);
  }

  /**
   * Renders the configurable Remediation Details surface on a failed item
   *. This slice is a minimal capture surface: editors get one control
   * per declared field (text input or select); read-only viewers see only the
   * fields that already carry a captured value. Persistence is the page's
   * responsibility (it owns the answers signal), so each change is re-dispatched
   * as a bubbling `cora-remediation-detail` carrying the question id, field key,
   * and new value.
   *
   * @param {HTMLElement} li
   * @param {QuestionDefinition} q
   */
  _renderDetails(li, q) {
    renderRemediationDetails(this._props(), li, q);
  }

  /**
   * Renders the unified **Issue Capture Group**s for a failed item
   * via the `cora-capture-groups` component. The instance is reused per question id
   * so each group's ephemeral collapse state survives autosave re-renders. The
   * component's bubbling `cora-capture` (field key + value) is caught here and
   * re-dispatched as a `cora-capture` carrying the question id; persistence is the
   * page's responsibility so the answers signal stays the single source of truth.
   *
   * @param {HTMLElement} li
   * @param {QuestionDefinition} q
   */
  _renderCapture(li, q) {
    renderRemediationCapture(this._props(), li, q);
  }

  /**
   * @returns {RemediationSectionProps}
   */
  _props() {
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
        this._dispatchCapture(questionId, fieldKey, value),
      dispatchDetail: (questionId, key, value) =>
        this._dispatchDetail(questionId, key, value),
      dispatchAttribute: (questionId, attributedParty) =>
        this._dispatchAttribute(questionId, attributedParty),
      dispatchRemediationAction: (questionId, action, selected) =>
        this._dispatchRemediationAction(questionId, action, selected),
      dispatchRemediationFreeForm: (questionId, value) =>
        this._dispatchRemediationFreeForm(questionId, value),
    };
  }

  /**
   * @param {string} questionId
   * @param {string} fieldKey
   * @param {string} value
   */
  _dispatchCapture(questionId, fieldKey, value) {
    this.dispatchEvent(
      new CustomEvent('cora-capture', {
        detail: { questionId, fieldKey, value },
        bubbles: true,
      })
    );
  }

  /**
   * @param {string} questionId
   * @param {string} key
   * @param {string} value
   */
  _dispatchDetail(questionId, key, value) {
    this.dispatchEvent(
      new CustomEvent('cora-remediation-detail', {
        detail: { questionId, key, value },
        bubbles: true,
      })
    );
  }

  /**
   * @param {string} questionId
   * @param {{ loginName: string, displayName: string } | null} attributedParty
   */
  _dispatchAttribute(questionId, attributedParty) {
    this.dispatchEvent(
      new CustomEvent('cora-attribute', {
        detail: { questionId, attributedParty },
        bubbles: true,
      })
    );
  }

  /**
   * Re-dispatches a reviewer's Remediation Action tick/untick as a bubbling
   * `cora-remediation-action` carrying the question id, the toggled action, and
   * whether it is now selected. Persistence is the page's job so
   * the answers signal stays the single source of truth.
   *
   * @param {string} questionId
   * @param {{ id: string, text: string }} action
   * @param {boolean} selected
   */
  _dispatchRemediationAction(questionId, action, selected) {
    this.dispatchEvent(
      new CustomEvent('cora-remediation-action', {
        detail: { questionId, action, selected },
        bubbles: true,
      })
    );
  }

  /**
   * Re-dispatches a reviewer's free-form Remediation entry as a bubbling
   * `cora-remediation-freeform` carrying the question id and new text.
   *
   * @param {string} questionId
   * @param {string} value
   */
  _dispatchRemediationFreeForm(questionId, value) {
    this.dispatchEvent(
      new CustomEvent('cora-remediation-freeform', {
        detail: { questionId, value },
        bubbles: true,
      })
    );
  }
}

customElements.define('cora-remediation-section', CORARemediationSection);
