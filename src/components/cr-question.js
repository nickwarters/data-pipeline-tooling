// @ts-check
import { normaliseConfiguredActions } from '../evaluators/configured-outcome.js';
import { isFailure } from '../evaluators/failure-evaluator.js';
import { h } from '../lib/html.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

const YES_NO_NA = ['Yes', 'No', 'NA'];

/**
 * @typedef {Object} QuestionProps
 * @property {QuestionDefinition | null} question
 * @property {string | string[]} currentValue
 * @property {'edit'|'read-only'|'hidden'} access
 * @property {(detail: { questionId: string, value: string | string[] }) => void} onAnswer
 */

/**
 * @param {QuestionProps} props
 * @returns {Node[]}
 */
export function Question({ question, currentValue, access, onAnswer }) {
  if (!question) return [];

  return [
    h(
      'fieldset',
      {
        class: 'cr-question',
        id: `cr-q-${question.id}`,
        role: question.responseType === 'multi-choice' ? 'group' : 'radiogroup',
        'aria-required': 'true',
      },
      h('legend', {}, question.text),
      question.responseType === 'multi-choice'
        ? renderMultiChoice({ question, currentValue, access, onAnswer })
        : renderSingleChoice({ question, currentValue, access, onAnswer })
    ),
    renderRemediationPanel(question, currentValue),
  ].filter((node) => node !== null);
}

/**
 * @param {QuestionDefinition} question
 * @param {string | string[]} currentValue
 * @returns {HTMLElement | null}
 */
function renderRemediationPanel(question, currentValue) {
  if (!question.remediationActions?.length) return null;
  const answer = { value: currentValue };
  if (!isFailure(question, answer)) return null;

  return h(
    'details',
    { class: 'cr-remediation-panel', open: true },
    h('summary', {}, 'Actions required'),
    h(
      'ul',
      {},
      normaliseConfiguredActions(question.remediationActions, question.id).map(
        (action) => h('li', {}, action.text)
      )
    )
  );
}

/**
 * @param {QuestionProps & { question: QuestionDefinition }} props
 * @returns {HTMLElement[]}
 */
function renderSingleChoice({ question, currentValue, access, onAnswer }) {
  const options =
    question.responseType === 'yes-no-na'
      ? YES_NO_NA
      : (question.options ?? []);
  const current = typeof currentValue === 'string' ? currentValue : '';

  return options.map((option, index) =>
    h(
      'label',
      {},
      h('input', {
        type: 'radio',
        name: `cr-q-${question.id}`,
        value: option,
        'data-focus-key': `answer:${question.id}:${index}`,
        checked: current === option,
        disabled: access === 'read-only',
        onchange: () => {
          if (access === 'read-only') return;
          onAnswer({ questionId: question.id, value: option });
        },
      }),
      h('span', {}, ` ${option}`)
    )
  );
}

/**
 * @param {QuestionProps & { question: QuestionDefinition }} props
 * @returns {HTMLElement[]}
 */
function renderMultiChoice({ question, currentValue, access, onAnswer }) {
  const options = question.options ?? [];
  const selected = new Set(Array.isArray(currentValue) ? currentValue : []);

  return options.map((option, index) =>
    h(
      'label',
      {},
      h('input', {
        type: 'checkbox',
        name: `cr-q-${question.id}`,
        value: option,
        'data-focus-key': `answer:${question.id}:${index}`,
        checked: selected.has(option),
        disabled: access === 'read-only',
        onchange: (/** @type {any} */ event) => {
          if (access === 'read-only') return;
          const next = new Set(selected);
          if (event.target.checked) next.add(option);
          else next.delete(option);
          onAnswer({
            questionId: question.id,
            value: options.filter((item) => next.has(item)),
          });
        },
      }),
      h('span', {}, ` ${option}`)
    )
  );
}

export class CRQuestion extends HTMLElement {
  constructor() {
    super();
    /** @type {QuestionDefinition | null} */
    this.question = null;
    /** @type {string | string[]} */
    this.currentValue = '';
    /** @type {'edit'|'read-only'|'hidden'} */
    this.access = 'edit';
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    const content = Question({
      question: this.question,
      currentValue: this.currentValue,
      access: this.access,
      onAnswer: (detail) => {
        this.dispatchEvent(
          new CustomEvent('cr-answer', {
            detail,
            bubbles: true,
          })
        );
      },
    });
    this.replaceChildren(...content);
  }

  focus() {
    const input = /** @type {HTMLElement | null} */ (
      this.querySelector('input')
    );
    if (input) input.focus();
  }
}

customElements.define('cr-question', CRQuestion);
