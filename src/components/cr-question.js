// @ts-check
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
  ];
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

/**
 * Read-only display of the Remediation Actions the Reviewer has *selected* for a
 * failed Answer (issue #250). This mirrors — read-only — what the Issues tab lets
 * the Reviewer tick, so the Review tab shows only what persists (the selected
 * subset + any free-form entry), never the full configured catalogue. Populates
 * the supplied container in place so it can be refreshed without rebuilding the
 * question's inputs (preserving focus/native state).
 *
 * @param {HTMLElement} container
 * @param {string[]} selectedActions
 * @param {string} freeFormRemediation
 */
export function renderSelectedRemediation(
  container,
  selectedActions,
  freeFormRemediation
) {
  container.replaceChildren();
  const actions = selectedActions ?? [];
  const free = freeFormRemediation ?? '';
  if (actions.length === 0 && !free) return;

  container.appendChild(
    h('p', { class: 'cr-question-remediation-label' }, 'Selected remediation')
  );
  if (actions.length) {
    const list = h('ul', { class: 'cr-question-remediation-actions' });
    for (const text of actions) list.appendChild(h('li', {}, text));
    container.appendChild(list);
  }
  if (free) {
    container.appendChild(
      h('p', { class: 'cr-question-remediation-freeform' }, free)
    );
  }
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
    /**
     * Text of the Remediation Actions selected on this Answer (issue #250),
     * shown read-only beneath the question. Set by the owning cr-question-list.
     * @type {string[]}
     */
    this.selectedActions = [];
    /** @type {string} Free-form remediation text captured on this Answer. */
    this.freeFormRemediation = '';
    /**
     * Stable host child that holds the read-only selected-remediation display.
     * Kept across renders so the Review tab can refresh it in place without
     * rebuilding the inputs. `null` until first render / when no question.
     * @type {HTMLElement | null}
     */
    this._remediationNode = null;
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
    if (!this.question) {
      this._remediationNode = null;
      this.replaceChildren(...content);
      return;
    }
    const node = document.createElement('div');
    node.className = 'cr-question-remediation';
    this._remediationNode = node;
    renderSelectedRemediation(
      node,
      this.selectedActions,
      this.freeFormRemediation
    );
    this.replaceChildren(...content, node);
  }

  /**
   * Refresh only the read-only selected-remediation display (issue #250) without
   * re-rendering the question's inputs — so a selection made on the Issues tab is
   * reflected here on the Review tab without disturbing radio focus/state.
   *
   * @param {string[]} selectedActions
   * @param {string} freeFormRemediation
   */
  syncRemediation(selectedActions, freeFormRemediation) {
    // Only touch the DOM when the selection actually changed: an unconditional
    // replaceChildren would be a needless subtree mutation on every autosave
    // re-render (and, in the browser, is unnecessary churn).
    const unchanged =
      this.freeFormRemediation === freeFormRemediation &&
      this.selectedActions.length === selectedActions.length &&
      this.selectedActions.every((text, i) => text === selectedActions[i]);
    this.selectedActions = selectedActions;
    this.freeFormRemediation = freeFormRemediation;
    if (!unchanged && this._remediationNode) {
      renderSelectedRemediation(
        this._remediationNode,
        selectedActions,
        freeFormRemediation
      );
    }
  }

  focus() {
    const input = /** @type {HTMLElement | null} */ (
      this.querySelector('input')
    );
    if (input) input.focus();
  }
}

customElements.define('cr-question', CRQuestion);
