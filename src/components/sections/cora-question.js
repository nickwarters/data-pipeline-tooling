// @ts-check
import { h } from '../../lib/html.js';
import {
  NA_VALUE,
  reviewerResponseOptions,
} from '../../lib/response-options.js';

/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/**
 * Option text longer than this many characters triggers the stacked-card
 * layout (`cora-question-options-long`) instead of the default inline
 * pill layout, so sentence-length single-choice options (e.g. `outcome`
 * wordings) remain readable.
 */
const LONG_OPTION_THRESHOLD = 40;

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

  const isMultiChoice = question.responseType === 'multi-choice';
  const singleChoiceOptions = isMultiChoice
    ? []
    : reviewerResponseOptions(question);
  const hasLongOption = singleChoiceOptions.some(
    (option) => option.length > LONG_OPTION_THRESHOLD
  );
  const fieldsetClass =
    !isMultiChoice && hasLongOption
      ? 'cora-question cora-question-options-long'
      : 'cora-question';

  return [
    h(
      'fieldset',
      {
        class: fieldsetClass,
        id: `cora-q-${question.id}`,
        role: isMultiChoice ? 'group' : 'radiogroup',
        'aria-required': 'true',
      },
      h('legend', {}, question.text),
      isMultiChoice
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
  const options = reviewerResponseOptions(question);
  const current = typeof currentValue === 'string' ? currentValue : '';

  return options.map((option, index) =>
    h(
      'label',
      { class: 'cora-question-option' },
      h('input', {
        type: 'radio',
        name: `cora-q-${question.id}`,
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
  const options = reviewerResponseOptions(question);
  const selected = new Set(Array.isArray(currentValue) ? currentValue : []);

  return options.map((option, index) =>
    h(
      'label',
      {},
      h('input', {
        type: 'checkbox',
        name: `cora-q-${question.id}`,
        value: option,
        'data-focus-key': `answer:${question.id}:${index}`,
        checked: selected.has(option),
        disabled: access === 'read-only',
        onchange: (/** @type {any} */ event) => {
          if (access === 'read-only') return;
          const next = new Set(selected);
          if (event.target.checked) next.add(option);
          else next.delete(option);
          // N/A is exclusive: selecting it clears any real answers, and
          // selecting a real answer clears N/A.
          if (event.target.checked) {
            if (option === NA_VALUE) {
              next.clear();
              next.add(NA_VALUE);
            } else {
              next.delete(NA_VALUE);
            }
          }
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
 * failed Answer. This mirrors — read-only — what the Issues tab lets
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
    h('p', { class: 'cora-question-remediation-label' }, 'Selected remediation')
  );
  if (actions.length) {
    const list = h('ul', { class: 'cora-question-remediation-actions' });
    for (const text of actions) list.appendChild(h('li', {}, text));
    container.appendChild(list);
  }
  if (free) {
    container.appendChild(
      h('p', { class: 'cora-question-remediation-freeform' }, free)
    );
  }
}
