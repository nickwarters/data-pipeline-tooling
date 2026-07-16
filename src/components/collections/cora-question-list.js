// @ts-check
import { ShellElement, captureFocus, restoreFocus } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import { CORAQuestion } from '../sections/cora-question.js';
import { isFailure } from '../../evaluators/failure-evaluator.js';
import { NA_VALUE } from '../../lib/response-options.js';

/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').OutcomeOption} OutcomeOption */
/** @typedef {import('../../sharepoint-client.js').QuestionGroupConfig} QuestionGroupConfig */

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

/**
 * The value a group-verdict control should display: when every applicable
 * `outcome`-type question in the group carries the same Answer value (and
 * there is at least one), that value; otherwise ''.
 *
 * @param {QuestionDefinition[]} groupQuestions
 * @param {Record<string, Answer>} answers
 * @returns {string}
 */
export function currentGroupVerdict(groupQuestions, answers) {
  const outcomeQuestions = groupQuestions.filter(
    (q) => q.responseType === 'outcome'
  );
  if (!outcomeQuestions.length) return '';
  /** @type {string} */
  let shared = '';
  for (const q of outcomeQuestions) {
    const v = answers[q.id]?.value;
    if (typeof v !== 'string' || !v) return '';
    if (!shared) shared = v;
    else if (shared !== v) return '';
  }
  return shared;
}

/**
 * Interleaves `category` headings (top level, shown only when any question
 * declares one) and `questionGroup` headings — with the optional bulk-verdict
 * control — between the question hosts (#390 Parts 1 and 3). Heading nodes are
 * cached by key so an unchanged catalogue produces an identical children
 * array and the DOM (and focus) is left alone.
 *
 * @param {{
 *   questions: QuestionDefinition[],
 *   hosts: CORAQuestion[],
 *   answers: Record<string, Answer>,
 *   access: 'edit'|'read-only'|'hidden',
 *   questionGroups: Record<string, QuestionGroupConfig>,
 *   outcomeOptions: OutcomeOption[],
 *   headingCache: Map<string, HTMLElement>,
 *   onGroupVerdict: (detail: { group: string, value: string }) => void,
 * }} props
 * @returns {Node[]}
 */
export function composeGroupedChildren({
  questions,
  hosts,
  answers,
  access,
  questionGroups,
  outcomeOptions,
  headingCache,
  onGroupVerdict,
}) {
  const hasCategories = questions.some((q) => q.category);
  const hasGroups = questions.some((q) => q.questionGroup);
  /** @type {Node[]} */
  const children = [];
  /** @type {string | null} */
  let prevCategory = null;
  /** @type {string | null} */
  let prevGroup = null;

  questions.forEach((question, index) => {
    const category = question.category || 'General';
    const group = question.questionGroup || 'General';

    if (hasCategories && category !== prevCategory) {
      const key = `cat:${category}`;
      let heading = headingCache.get(key);
      if (!heading) {
        heading = h(
          'h3',
          { class: 'cora-question-category-heading' },
          category
        );
        headingCache.set(key, heading);
      }
      children.push(heading);
      prevGroup = null;
    }

    if (hasGroups && (group !== prevGroup || category !== prevCategory)) {
      const withVerdict =
        access === 'edit' && Boolean(questionGroups[group]?.allowBulkOutcome);
      const key = `grp:${category}|${group}|${withVerdict ? 'v' : ''}`;
      let heading = headingCache.get(key);
      if (!heading) {
        heading = h(
          'div',
          { class: 'cora-question-group-heading' },
          h('h4', {}, group)
        );
        if (withVerdict) {
          const wrapper = groupVerdictSelect(
            group,
            outcomeOptions,
            onGroupVerdict
          );
          heading.appendChild(wrapper);
          /** @type {any} */ (heading)._verdictSelect = /** @type {any} */ (
            wrapper
          )._verdictSelect;
        }
        headingCache.set(key, heading);
      }
      if (withVerdict) {
        const select = /** @type {any} */ (heading)._verdictSelect;
        if (select) {
          select.value = currentGroupVerdict(
            questions.filter((q) => (q.questionGroup || 'General') === group),
            answers
          );
        }
      }
      children.push(heading);
    }

    prevCategory = category;
    prevGroup = group;
    children.push(hosts[index]);
  });

  return children;
}

/**
 * The bulk-verdict `<select>` for a Question Group configured with
 * `allowBulkOutcome`: the Case Type's Outcome wordings plus the universal
 * N/A. Selecting a verdict is a write shortcut — the handler applies it to
 * every applicable `outcome`-type question in the group; there is no
 * group-level state on the Case.
 *
 * @param {string} group
 * @param {OutcomeOption[]} outcomeOptions
 * @param {(detail: { group: string, value: string }) => void} onGroupVerdict
 * @returns {HTMLElement}
 */
function groupVerdictSelect(group, outcomeOptions, onGroupVerdict) {
  const select = h(
    'select',
    {
      class: 'cora-group-verdict',
      'aria-label': `Mark all ${group} outcome questions`,
      'data-focus-key': `group-verdict:${group}`,
      onchange: (/** @type {any} */ event) => {
        if (!event.target.value) return;
        onGroupVerdict({ group, value: event.target.value });
      },
    },
    h('option', { value: '' }, 'Group verdict…'),
    ...outcomeOptions.map((option) =>
      h('option', { value: option.wording }, option.wording)
    ),
    h('option', { value: NA_VALUE }, NA_VALUE)
  );
  const wrapper = h(
    'label',
    { class: 'cora-group-verdict-label' },
    h('span', {}, 'Mark all'),
    select
  );
  /** @type {any} */ (wrapper)._verdictSelect = select;
  return wrapper;
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
     * Per-Case-Type Question Group configuration
     * (`CaseTypeConfig.questionGroups`), set by the mounting controller.
     * @type {Record<string, QuestionGroupConfig>}
     */
    this.questionGroups = {};
    /**
     * The Case Type's configured Outcomes, for the group-verdict options.
     * @type {OutcomeOption[]}
     */
    this.outcomeOptions = [];
    /**
     * Cached heading nodes keyed by category/group so re-renders with an
     * unchanged catalogue reuse identical children (no DOM churn).
     * @type {Map<string, HTMLElement>}
     */
    this._headingNodes = new Map();
    /**
     * The full rendered children (headings + question hosts) from the last
     * render, for the changed-children comparison.
     * @type {Node[]}
     */
    this._childNodes = [];
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
    const previousChildren = this._childNodes;
    const nextElements = this.render();

    this.questionElements = nextElements;
    this._renderedIds = new Set(this.questions.map((question) => question.id));

    const nextChildren = composeGroupedChildren({
      questions: this.questions,
      hosts: nextElements,
      answers: this.answers,
      access: this.access,
      questionGroups: this.questionGroups ?? {},
      outcomeOptions: this.outcomeOptions ?? [],
      headingCache: this._headingNodes,
      onGroupVerdict: (detail) => {
        this.dispatchEvent(
          new CustomEvent('cora-group-verdict', { detail, bubbles: true })
        );
      },
    });
    this._childNodes = nextChildren;

    if (
      childrenChanged(previousChildren, nextChildren) ||
      nextChildren.length === 0
    ) {
      this.replaceChildren(...nextChildren);
      return true;
    }

    return false;
  }
}

/**
 * @param {Node[]} previous
 * @param {Node[]} next
 * @returns {boolean}
 */
function childrenChanged(previous, next) {
  if (previous.length !== next.length) return true;
  return next.some((element, index) => previous[index] !== element);
}

customElements.define('cora-question-list', CORAQuestionList);
