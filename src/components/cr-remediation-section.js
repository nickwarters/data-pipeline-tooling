// @ts-check
import { CRElement } from './cr-element.js';
import { evaluate } from '../evaluators/applicability-evaluator.js';
import { isFailure } from '../evaluators/failure-evaluator.js';
import './cr-attribute-menu.js';
import './cr-capture-groups.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {{ loginName: string, displayName: string }} Party */

export class CRRemediationSection extends CRElement {
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

  connectedCallback() {
    this._render();
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
    const applicable = evaluate(this.catalogue, this.answers);
    const failed = this.catalogue.filter(q =>
      applicable.has(q.id)
      && isFailure(q, this.answers[q.id])
    );

    const heading = document.createElement('h2');
    heading.textContent = 'Failures';

    if (failed.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'cr-remediation-empty';
      empty.textContent = 'No failures.';
      this.replaceChildren(heading, empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'cr-remediation-list';
    for (const q of failed) {
      list.appendChild(this._renderItem(q));
    }
    this.replaceChildren(heading, list);
  }

  /**
   * @param {QuestionDefinition} q
   * @returns {HTMLElement}
   */
  _renderItem(q) {
    const li = document.createElement('li');
    li.className = 'cr-remediation-item';

    if (q.category) {
      const cat = document.createElement('p');
      cat.className = 'cr-remediation-category';
      cat.textContent = q.category;
      li.appendChild(cat);
    }

    const qText = document.createElement('p');
    qText.className = 'cr-remediation-question';
    qText.textContent = q.text;
    li.appendChild(qText);

    const ans = document.createElement('p');
    ans.className = 'cr-remediation-answer';
    const v = this.answers[q.id]?.value;
    ans.textContent = `Answer: ${Array.isArray(v) ? v.join(', ') : v ?? ''}`;
    li.appendChild(ans);

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
      const actions = document.createElement('ul');
      actions.className = 'cr-remediation-actions';
      for (const text of q.remediationActions) {
        const item = document.createElement('li');
        item.textContent = text;
        actions.appendChild(item);
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
        const ap = document.createElement('p');
        ap.className = 'cr-remediation-attributed-party';
        ap.textContent = `Attributed to: ${attributedParty.displayName}`;
        li.appendChild(ap);
      }
      return;
    }

    const menu = /** @type {import('./cr-attribute-menu.js').CRAttributeMenu} */ (
      document.createElement('cr-attribute-menu')
    );
    menu.client = this.client;
    menu.attributedParty = attributedParty ?? null;
    menu.responsibleParty = this.responsibleParty;
    menu.addEventListener('cr-attribute-change', (ev) => {
      const detail = /** @type {CustomEvent<{ attributedParty: Party | null }>} */ (ev).detail;
      this._dispatchAttribute(q.id, detail.attributedParty);
    });
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
        const value = document.createElement('p');
        value.className = 'cr-remediation-detail-value';
        value.textContent = `${field.label}: ${captured}`;
        li.appendChild(value);
        continue;
      }

      const wrap = document.createElement('div');
      wrap.className = 'cr-remediation-detail-field';

      const label = document.createElement('label');
      label.className = 'cr-remediation-detail-label';
      label.textContent = field.label;
      wrap.appendChild(label);

      const control = this._buildDetailControl(field, details[field.key] ?? '');
      control.addEventListener('change', (ev) => {
        const target = /** @type {{ value: string }} */ (/** @type {any} */ (ev).target);
        this._dispatchDetail(q.id, field.key, target.value);
      });
      wrap.appendChild(control);

      li.appendChild(wrap);
    }
  }

  /**
   * @param {import('../sharepoint-client.js').RemediationField} field
   * @param {string} current
   * @returns {HTMLElement}
   */
  _buildDetailControl(field, current) {
    if (field.type === 'select') {
      const select = /** @type {any} */ (document.createElement('select'));
      select.className = 'cr-remediation-detail-input';
      const blank = /** @type {any} */ (document.createElement('option'));
      blank.value = '';
      blank.textContent = '—';
      select.appendChild(blank);
      for (const opt of field.options ?? []) {
        const option = /** @type {any} */ (document.createElement('option'));
        option.value = opt;
        option.textContent = opt;
        select.appendChild(option);
      }
      select.value = current;
      return select;
    }

    const input = /** @type {any} */ (document.createElement('input'));
    input.className = 'cr-remediation-detail-input';
    input.type = 'text';
    input.value = current;
    return input;
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
        document.createElement('cr-capture-groups')
      );
      cg.addEventListener('cr-capture', (ev) => {
        /** @type {any} */ (ev).stopPropagation?.();
        const { fieldKey, value } =
          /** @type {CustomEvent<{ fieldKey: string, value: string }>} */ (ev).detail;
        this._dispatchCapture(q.id, fieldKey, value);
      });
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
