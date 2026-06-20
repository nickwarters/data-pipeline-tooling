// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import './cr-question.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */

export class CRQuestionList extends ReactiveElement {
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
    /**
     * Rendered cr-question elements in display order. Exposed so siblings
     * (e.g. cr-case-review's "Jump to next unanswered" handler) can locate
     * a question's host element without reaching into the (browser-only,
     * not-on-our-test-stub) `children` HTMLCollection.
     * @type {import('./cr-question.js').CRQuestion[]}
     */
    this.questionElements = [];
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
      const child = this.questionElements[firstNewIndex];
      child?.focus?.();
    }
  }

  _render() {
    const els = this.render();
    if (Array.isArray(els)) this.replaceChildren(...els);
    else if (els) this.replaceChildren(els);
    else this.replaceChildren();
  }

  render() {
    const elements = this.questions.map(q => {
      const v = this.answers[q.id]?.value;
      const el = /** @type {import('./cr-question.js').CRQuestion} */ (
        h('cr-question', {
          tabIndex: -1,
          question: q,
          access: this.access,
          currentValue: v ?? (q.responseType === 'multi-choice' ? [] : '')
        })
      );
      return el;
    });
    this.questionElements = elements;
    this._renderedIds = new Set(this.questions.map(q => q.id));
    return elements;
  }
}

customElements.define('cr-question-list', CRQuestionList);
