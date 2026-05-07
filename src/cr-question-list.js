// @ts-check
import { CRElement } from './cr-element.js';
import './cr-question.js';

/** @typedef {import('./sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('./sharepoint-client.js').Answer} Answer */

export class CRQuestionList extends CRElement {
  constructor() {
    super();
    /** @type {QuestionDefinition[]} */
    this.questions = [];
    /** @type {Record<string, Answer>} */
    this.answers = {};
  }

  connectedCallback() {
    this._render();
  }

  /**
   * Replace the displayed questions and their current answer state.
   * @param {QuestionDefinition[]} questions
   * @param {Record<string, Answer>} answers
   */
  update(questions, answers) {
    this.questions = questions;
    this.answers = answers;
    this._render();
  }

  _render() {
    const elements = this.questions.map(q => {
      const el = /** @type {import('./cr-question.js').CRQuestion} */ (
        document.createElement('cr-question')
      );
      el.question = q;
      const v = this.answers[q.id]?.value;
      el.currentValue = v ?? (q.responseType === 'multi-choice' ? [] : '');
      return el;
    });
    this.replaceChildren(...elements);
  }
}

customElements.define('cr-question-list', CRQuestionList);
