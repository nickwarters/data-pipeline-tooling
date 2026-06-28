// @ts-check
import { captureFocus, restoreFocus } from '../lib/view.js';
import { CRQuestion } from './cr-question.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */

/**
 * @typedef {Object} QuestionListProps
 * @property {QuestionDefinition[]} questions
 * @property {Record<string, Answer>} answers
 * @property {'edit'|'read-only'|'hidden'} access
 * @property {CRQuestion[]} [existing]
 */

/**
 * Compose a list of question hosts from data. Existing hosts are reused by id
 * so answer changes do not replace focused DOM nodes when the catalogue order is
 * stable.
 *
 * @param {QuestionListProps} props
 * @returns {CRQuestion[]}
 */
export function QuestionList({ questions, answers, access, existing = [] }) {
  /** @type {Map<string, CRQuestion>} */
  const existingById = new Map();
  for (const element of existing) {
    if (element.question?.id) existingById.set(element.question.id, element);
  }

  return questions.map((question) => {
    const answerValue = answers[question.id]?.value;
    const currentValue =
      answerValue ?? (question.responseType === 'multi-choice' ? [] : '');

    const existingElement = existingById.get(question.id);
    const element = existingElement ?? new CRQuestion();
    if (!existingElement) {
      /** @type {any} */ (element).tagName = 'cr-question';
    }
    element.tabIndex = -1;

    element.question = question;
    element.access = access;
    element.currentValue = currentValue;
    if (!existingElement) element._render();
    return element;
  });
}

export class CRQuestionList extends HTMLElement {
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
     * @type {CRQuestion[]}
     */
    this.questionElements = [];
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
    let firstNewIndex = -1;
    questions.forEach((question, index) => {
      if (firstNewIndex === -1 && !previous.has(question.id)) {
        firstNewIndex = index;
      }
    });

    const focusSnapshot = captureFocus(this);

    this.questions = questions;
    this.answers = answers;
    const changed = this._render();

    if (previous.size > 0 && firstNewIndex !== -1) {
      const child = this.questionElements[firstNewIndex];
      if (child) HTMLElement.prototype.focus.call(child);
      return;
    }

    if (changed) restoreFocus(this, focusSnapshot);
  }

  /** @returns {boolean} */
  _render() {
    const previousElements = [...this.questionElements];
    const nextElements = QuestionList({
      questions: this.questions,
      answers: this.answers,
      access: this.access,
      existing: previousElements,
    });

    this.questionElements = nextElements;
    this._renderedIds = new Set(this.questions.map((question) => question.id));

    if (
      childrenChanged(previousElements, nextElements) ||
      nextElements.length === 0
    ) {
      this.replaceChildren(...nextElements);
      return true;
    }

    return false;
  }
}

/**
 * @param {CRQuestion[]} previous
 * @param {CRQuestion[]} next
 * @returns {boolean}
 */
function childrenChanged(previous, next) {
  if (previous.length !== next.length) return true;
  return next.some((element, index) => previous[index] !== element);
}

customElements.define('cr-question-list', CRQuestionList);
