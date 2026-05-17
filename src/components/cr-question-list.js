// @ts-check
import { CRElement } from './cr-element.js';
import './cr-question.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */

export class CRQuestionList extends CRElement {
  constructor() {
    super();
    /** @type {QuestionDefinition[]} */
    this.questions = [];
    /** @type {Record<string, Answer>} */
    this.answers = {};
    /** @type {Set<string>} */
    this._renderedIds = new Set();
    /** @type {'edit'|'read-only'|'hidden'} */
    this.access = 'edit';
  }

  connectedCallback() {
    this._render();
  }

  /**
   * Replace the displayed questions and their current answer state.
   * Focus management: when an update introduces a previously-unseen question
   * (a conditional follow-up that just became applicable), focus that
   * question's host so keyboard users can continue answering without hunting.
   * @param {QuestionDefinition[]} questions
   * @param {Record<string, Answer>} answers
   */
  update(questions, answers) {
    const previous = this._renderedIds;
    /** @type {number} */
    let firstNewIndex = -1;
    questions.forEach((q, i) => {
      if (firstNewIndex === -1 && !previous.has(q.id)) firstNewIndex = i;
    });

    this.questions = questions;
    this.answers = answers;
    this._render();

    // Only auto-focus when something genuinely new appeared (not on first render).
    if (previous.size > 0 && firstNewIndex !== -1) {
      const child = /** @type {any} */ (/** @type {any} */ (this)._children?.[firstNewIndex]);
      child?.focus?.();
    }
  }

  _render() {
    const elements = this.questions.map(q => {
      const el = /** @type {import('./cr-question.js').CRQuestion} */ (
        document.createElement('cr-question')
      );
      // tabindex on the host so the element can receive programmatic focus when
      // it appears as a conditional follow-up. CRQuestion's own focus() forwards
      // to the first input so screen-reader users land in the radio group.
      /** @type {any} */ (el).tabIndex = -1;
      el.question = q;
      el.access = this.access;
      const v = this.answers[q.id]?.value;
      el.currentValue = v ?? (q.responseType === 'multi-choice' ? [] : '');
      return el;
    });
    this.replaceChildren(...elements);
    this._renderedIds = new Set(this.questions.map(q => q.id));
  }
}

customElements.define('cr-question-list', CRQuestionList);
