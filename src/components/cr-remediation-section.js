// @ts-check
import { CRElement } from './cr-element.js';
import { evaluate } from '../evaluators/applicability-evaluator.js';
import { isFailure } from '../evaluators/failure-evaluator.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */

export class CRRemediationSection extends CRElement {
  constructor() {
    super();
    /** @type {QuestionDefinition[]} */
    this.catalogue = [];
    /** @type {Record<string, Answer>} */
    this.answers = {};
    /** @type {boolean} Whether this Case Type attributes failures to a person. */
    this.attributeFailures = false;
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

    const attributedParty = this.answers[q.id]?.attributedParty;
    if (this.attributeFailures && attributedParty) {
      const ap = document.createElement('p');
      ap.className = 'cr-remediation-attributed-party';
      ap.textContent = `Attributed to: ${attributedParty.displayName}`;
      li.appendChild(ap);
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
}

customElements.define('cr-remediation-section', CRRemediationSection);
