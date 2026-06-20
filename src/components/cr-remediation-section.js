// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import { evaluate } from '../evaluators/applicability-evaluator.js';
import { isFailure } from '../evaluators/failure-evaluator.js';
import { buildCaptureControl } from '../lib/capture-engine.js';
import './cr-attribute-menu.js';
import './cr-capture-groups.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {{ loginName: string, displayName: string }} Party */

export class CRRemediationSection extends ReactiveElement {
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
     * attribute menu. `null` when the Case has none. ADR-0013.
     * @type {Party | null}
     */
    this.responsibleParty = null;
    /**
     * Whether the viewer may set/change/clear the Attributed Party: Assigned
     * Reviewer only, on an In-progress Case (frozen at completion). UX-only per
     * ADR-0010/0011; the server ACL is the real boundary.
     * @type {boolean}
     */
    this.canAttribute = false;
    /**
     * The Case Type's configurable per-failure capture fields (ADR-0017). One
     * shared set applies to every failed Answer; empty when the Case Type
     * declares none.
     * @type {import('../sharepoint-client.js').RemediationField[]}
     */
    this.remediationFields = [];
    /**
     * Whether the viewer may capture Remediation Details. Mirrors `canAttribute`:
     * Assigned Reviewer only, on an In-progress Case (frozen at completion).
     * @type {boolean}
     */
    this.canCaptureDetails = false;
    /**
     * The Case Type's unified **Issue Capture Group**s (ADR-0020). Empty when the
     * Case Type declares none. Supersedes `remediationFields`; both may coexist.
     * @type {import('../sharepoint-client.js').CaptureGroup[]}
     */
    this.captureGroups = [];
    /**
     * Whether the viewer may capture Issue Capture values. Mirrors `canAttribute`:
     * Assigned Reviewer only, on an In-progress Case (frozen at completion).
     * @type {boolean}
     */
    this.canCapture = false;
    /**
     * Per-failed-Answer `cr-capture-groups` instances, keyed by question id and
     * reused across re-renders so each group's ephemeral collapse state survives
     * an autosave-triggered re-render (ADR-0020).
     * @type {Map<string, import('./cr-capture-groups.js').CRCaptureGroups>}
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
    const applicable = evaluate(this.catalogue, this.answers);
    const failed = this.catalogue.filter(
      (q) => applicable.has(q.id) && isFailure(q, this.answers[q.id])
    );

    const heading = h('h2', {}, 'Failures');

    if (failed.length === 0) {
      const empty = h('p', { class: 'cr-remediation-empty' }, 'No failures.');
      return [heading, empty];
    }

    const list = h('ul', { class: 'cr-remediation-list' });
    for (const q of failed) {
      list.appendChild(this._renderItem(q));
    }
    return [heading, list];
  }

  /**
   * @param {QuestionDefinition} q
   * @returns {HTMLElement}
   */
  _renderItem(q) {
    const li = h('li', { class: 'cr-remediation-item' });

    if (q.category) {
      li.appendChild(h('p', { class: 'cr-remediation-category' }, q.category));
    }

    li.appendChild(h('p', { class: 'cr-remediation-question' }, q.text));

    const v = this.answers[q.id]?.value;
    const ansText = `Answer: ${Array.isArray(v) ? v.join(', ') : (v ?? '')}`;
    li.appendChild(h('p', { class: 'cr-remediation-answer' }, ansText));

    if (this.attributeFailures) {
      this._renderAttribution(li, q);
    }

    if (this.remediationFields?.length) {
      this._renderDetails(li, q);
    }

    if (this.captureGroups?.length) {
      this._renderCapture(li, q);
    }

    if (q.remediationActions?.length) {
      const actions = h('ul', { class: 'cr-remediation-actions' });
      for (const text of q.remediationActions) {
        actions.appendChild(h('li', {}, text));
      }
      li.appendChild(actions);
    }

    return li;
  }

  /**
   * Renders the Attributed Party surface on a failed item (ADR-0013). Read-only
   * viewers see just the cached displayName. Editors get the compact
   * `cr-attribute-menu` (icon/chip + popover) instead, which offers the
   * Responsible Party quick-pick and people search; its `cr-attribute-change`
   * is re-dispatched here as a bubbling `cr-attribute` carrying the question id.
   * Persistence is the page's responsibility so the answers signal stays the
   * single source of truth.
   *
   * @param {HTMLElement} li
   * @param {QuestionDefinition} q
   */
  _renderAttribution(li, q) {
    const attributedParty = this.answers[q.id]?.attributedParty;

    if (!this.canAttribute) {
      if (attributedParty) {
        li.appendChild(
          h(
            'p',
            { class: 'cr-remediation-attributed-party' },
            `Attributed to: ${attributedParty.displayName}`
          )
        );
      }
      return;
    }

    const menu =
      /** @type {import('./cr-attribute-menu.js').CRAttributeMenu} */ (
        h('cr-attribute-menu', {
          client: this.client,
          responsibleParty: this.responsibleParty,
          'oncr-attribute-change': (/** @type {any} */ ev) => {
            const detail =
              /** @type {CustomEvent<{ attributedParty: Party | null }>} */ (ev)
                .detail;
            this._dispatchAttribute(q.id, detail.attributedParty);
          },
        })
      );
    menu.attributedParty = attributedParty ?? null;
    li.appendChild(/** @type {any} */ (menu));
  }

  /**
   * Renders the configurable Remediation Details surface on a failed item
   * (ADR-0017). This slice is a minimal capture surface: editors get one control
   * per declared field (text input or select); read-only viewers see only the
   * fields that already carry a captured value. Persistence is the page's
   * responsibility (it owns the answers signal), so each change is re-dispatched
   * as a bubbling `cr-remediation-detail` carrying the question id, field key,
   * and new value.
   *
   * @param {HTMLElement} li
   * @param {QuestionDefinition} q
   */
  _renderDetails(li, q) {
    const details = this.answers[q.id]?.remediationDetails ?? {};

    for (const field of this.remediationFields) {
      if (!this.canCaptureDetails) {
        const captured = details[field.key];
        if (captured === undefined || captured === '') continue;
        li.appendChild(
          h(
            'p',
            { class: 'cr-remediation-detail-value' },
            `${field.label}: ${captured}`
          )
        );
        continue;
      }

      const control = buildCaptureControl(
        field,
        details[field.key] ?? '',
        (value) => {
          this._dispatchDetail(q.id, field.key, value);
        },
        'cr-remediation-detail-input'
      );

      const wrap = h(
        'div',
        { class: 'cr-remediation-detail-field' },
        h('label', { class: 'cr-remediation-detail-label' }, field.label),
        control
      );

      li.appendChild(wrap);
    }
  }

  /**
   * Renders the unified **Issue Capture Group**s for a failed item (ADR-0020)
   * via the `cr-capture-groups` component. The instance is reused per question id
   * so each group's ephemeral collapse state survives autosave re-renders. The
   * component's bubbling `cr-capture` (field key + value) is caught here and
   * re-dispatched as a `cr-capture` carrying the question id; persistence is the
   * page's responsibility so the answers signal stays the single source of truth.
   *
   * @param {HTMLElement} li
   * @param {QuestionDefinition} q
   */
  _renderCapture(li, q) {
    let cg = this._captureEls.get(q.id);
    if (!cg) {
      cg = /** @type {import('./cr-capture-groups.js').CRCaptureGroups} */ (
        h('cr-capture-groups', {
          'oncr-capture': (/** @type {any} */ ev) => {
            /** @type {any} */ (ev).stopPropagation?.();
            const { fieldKey, value } =
              /** @type {CustomEvent<{ fieldKey: string, value: string }>} */ (
                ev
              ).detail;
            this._dispatchCapture(q.id, fieldKey, value);
          },
        })
      );
      this._captureEls.set(q.id, cg);
    }
    const capture = this.answers[q.id]?.capture ?? {};
    cg.groups = this.captureGroups;
    cg.capture = capture;
    cg.canCapture = this.canCapture;
    cg.update?.(this.captureGroups, capture, this.canCapture);
    li.appendChild(/** @type {any} */ (cg));
  }

  /**
   * @param {string} questionId
   * @param {string} fieldKey
   * @param {string} value
   */
  _dispatchCapture(questionId, fieldKey, value) {
    this.dispatchEvent(
      new CustomEvent('cr-capture', {
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
      new CustomEvent('cr-remediation-detail', {
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
      new CustomEvent('cr-attribute', {
        detail: { questionId, attributedParty },
        bubbles: true,
      })
    );
  }
}

customElements.define('cr-remediation-section', CRRemediationSection);
