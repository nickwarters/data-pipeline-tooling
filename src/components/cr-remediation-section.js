// @ts-check
import { CRElement } from './cr-element.js';
import { evaluate } from '../evaluators/applicability-evaluator.js';
import { isFailure } from '../evaluators/failure-evaluator.js';
import './cr-attribute-menu.js';

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
