// @ts-check
import { ShellElement, captureFocus, restoreFocus } from '../../lib/view.js';
import { CORAQuestion } from '../sections/cora-question.js';
import { isFailure } from '../../evaluators/failure-evaluator.js';

/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */

/**
 * @typedef {Object} QuestionListProps
 * @property {QuestionDefinition[]} questions
 * @property {Record<string, Answer>} answers
 * @property {'edit'|'read-only'|'hidden'} access
 * @property {CORAQuestion[]} [existing]
 */

/**
 * Compose a list of question hosts from data. Existing hosts are reused by id
 * so answer changes do not replace focused DOM nodes when the catalogue order is
 * stable.
 *
 * @param {QuestionListProps} props
 * @returns {CORAQuestion[]}
 */
export function QuestionList({ questions, answers, access, existing = [] }) {
  /** @type {Map<string, CORAQuestion>} */
  const existingById = new Map();
  for (const element of existing) {
    if (element.question?.id) existingById.set(element.question.id, element);
  }

  return questions.map((question) => {
    const answer = answers[question.id];
    const answerValue = answer?.value;
    const currentValue =
      answerValue ?? (question.responseType === 'multi-choice' ? [] : '');

    // The Review tab mirrors — read-only — only the Remediation Actions the
    // Reviewer selected on the Issues tab, never the full configured
    // catalogue. Only a still-failing Answer carries a selection.
    const failing = isFailure(question, answer);
    const selectedActions = failing
      ? (answer?.remediationActions ?? []).map((action) => action.text)
      : [];
    const freeFormRemediation = failing
      ? (answer?.freeFormRemediation ?? '')
      : '';

    const existingElement = existingById.get(question.id);
    const element =
      existingElement ??
      /** @type {CORAQuestion} */ (document.createElement('cora-question'));
    element.tabIndex = -1;

    element.question = question;
    element.access = access;
    element.currentValue = currentValue;
    element.selectedActions = selectedActions;
    element.freeFormRemediation = freeFormRemediation;
    if (!existingElement) {
      element.update({
        question,
        access,
        currentValue,
        selectedActions,
        freeFormRemediation,
      });
    } else element.syncRemediation(selectedActions, freeFormRemediation);
    return element;
  });
}

export class CORAQuestionList extends ShellElement {
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
     * Rendered cora-question elements in display order. Exposed so siblings
     * (e.g. cora-case-review's "Jump to next unanswered" handler) can locate
     * a question's host element without reaching into the (browser-only,
     * not-on-our-test-stub) `children` HTMLCollection.
     * @type {CORAQuestion[]}
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

  /**
   * ShellElement render contract: compose the question hosts from current
   * props, reusing existing hosts by id. Pure composition — DOM mutation and
   * bookkeeping live in `_render()`, which callers (connectedCallback,
   * update()) invoke directly since this component's re-renders are driven
   * imperatively rather than by signal reactivity.
   * @returns {CORAQuestion[]}
   */
  render() {
    return QuestionList({
      questions: this.questions,
      answers: this.answers,
      access: this.access,
      existing: this.questionElements,
    });
  }

  /** @returns {boolean} */
  _render() {
    const previousElements = [...this.questionElements];
    const nextElements = this.render();

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
 * @param {CORAQuestion[]} previous
 * @param {CORAQuestion[]} next
 * @returns {boolean}
 */
function childrenChanged(previous, next) {
  if (previous.length !== next.length) return true;
  return next.some((element, index) => previous[index] !== element);
}

customElements.define('cora-question-list', CORAQuestionList);
