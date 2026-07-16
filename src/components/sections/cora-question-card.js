// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import {
  canMoveQuestion,
  canMoveQuestionWithinCategory,
  moveQuestion,
  moveQuestionWithinCategory,
} from '../../lib/question-order.js';

/**
 * One Question Definition's editing card. The active bank, the baseline
 * questions (for the wording diff), the category-filter state, and the
 * mutation sink all arrive as props and are forwarded to the child editors;
 * this component has no store dependency.
 *
 * @param {{ question: any, questionIndex: number, bank: any, baselineQuestions: any[], categoryFilterActive: boolean, onCommit: (fn: () => void) => void, setClassName: (className: string) => void }} props
 * @returns {Node[] | undefined}
 */
export function QuestionCard(props) {
  const q = props.question;
  if (!q) return;
  const i = props.questionIndex ?? 0;
  const onCommit = props.onCommit;
  const bank = props.bank;
  const bankQuestions = bank?.questions ?? [];
  const categoryFilterActive = props.categoryFilterActive;
  const canMoveUp = categoryFilterActive
    ? canMoveQuestionWithinCategory(bankQuestions, q, -1)
    : canMoveQuestion(bankQuestions, q, -1);
  const canMoveDown = categoryFilterActive
    ? canMoveQuestionWithinCategory(bankQuestions, q, 1)
    : canMoveQuestion(bankQuestions, q, 1);

  const num = h(
    'div',
    { class: 'card-num' },
    h(
      'div',
      { class: 'card-num-label' },
      `№ ${String(i + 1).padStart(2, '0')}`
    ),
    h('input', {
      class: 'id-input',
      value: q.id,
      onchange: (/** @type {any} */ e) =>
        renameQuestion(onCommit, q, e.target.value),
    })
  );

  const wording = h('cora-wording-editor', {
    question: q,
    baselineQuestion: (props.baselineQuestions ?? []).find(
      (/** @type {any} */ candidate) => candidate.id === q.id
    ),
    onCommit,
  });

  const grid = h(
    'div',
    { class: 'field-grid' },
    questionCardField(
      'Category',
      questionCardText(q.category || '', (/** @type {string} */ v) =>
        setQuestionCategory(onCommit, q, v)
      )
    ),
    questionCardField(
      'Response Type',
      questionCardSelect(
        ['yes-no-na', 'single-choice', 'multi-choice', 'outcome'],
        q.responseType,
        (/** @type {string} */ v) => setQuestionResponseType(onCommit, q, v)
      )
    )
  );
  if (q.responseType === 'yes-no-na') {
    grid.appendChild(
      questionCardField(
        'Failure Criteria',
        questionCardSelect(
          ['—', 'Yes', 'No', 'N/A'],
          q.failureCriteria || '—',
          (/** @type {string} */ v) =>
            setQuestionFailureCriteria(onCommit, q, v)
        )
      )
    );
  }

  // Every response type maps its options to Outcomes (the response drives the
  // Outcome), so the options editor renders for all types — read-only for
  // `outcome`, fixed-option for `yes-no-na`, editable for single/multi-choice.
  const bodyChildren = [
    wording,
    grid,
    h('cora-options-editor', {
      question: q,
      outcomeOptions: bank?.outcomeOptions ?? [],
      onCommit,
    }),
    h('cora-question-labels', { question: q, bank, onCommit }),
    h('cora-showwhen-editor', {
      question: q,
      bankQuestions,
      onCommit,
    }),
    h('cora-remediation-actions-editor', { question: q, onCommit }),
  ];

  const body = h('div', { class: 'card-body' }, ...bodyChildren);

  const actions = h(
    'div',
    { class: 'card-actions' },
    h(
      'button',
      {
        class: 'icon-btn',
        title: 'Move question up',
        'aria-label': 'Move question up',
        disabled: !canMoveUp,
        onclick: () =>
          moveQuestionInDraft(
            onCommit,
            bankQuestions,
            categoryFilterActive,
            q,
            -1
          ),
      },
      '↑'
    ),
    h(
      'button',
      {
        class: 'icon-btn',
        title: 'Move question down',
        'aria-label': 'Move question down',
        disabled: !canMoveDown,
        onclick: () =>
          moveQuestionInDraft(
            onCommit,
            bankQuestions,
            categoryFilterActive,
            q,
            1
          ),
      },
      '↓'
    ),
    h(
      'button',
      {
        class: 'icon-btn',
        title: q.deprecated ? 'Restore' : 'Mark deprecated',
        onclick: () => toggleQuestionDeprecated(onCommit, q),
      },
      q.deprecated ? '↩' : '⌀'
    ),
    h(
      'button',
      {
        class: 'icon-btn',
        title: 'Duplicate',
        onclick: () => duplicateQuestion(onCommit, bankQuestions, q),
      },
      '⎘'
    ),
    h(
      'button',
      {
        class: 'icon-btn danger',
        title: 'Remove draft',
        onclick: () => removeQuestionDraft(onCommit, bankQuestions, q),
      },
      '×'
    )
  );

  const stripe = h('div', { class: 'card-stripe' });
  if (q.showWhen && !q.deprecated)
    stripe.style.cssText = 'background: var(--ochre);';

  props.setClassName('card' + (q.deprecated ? ' deprecated' : ''));
  return [stripe, h('div', { class: 'card-head' }, num, body, actions)];
}

export class CORAQuestionCard extends ShellElement {
  constructor() {
    super();
    /** @type {any} */ this.question = null;
    /**
     * The active Question Bank (questions, labels, outcomeOptions), passed
     * down by the mounting site.
     * @type {any}
     */
    this.bank = null;
    /**
     * The last-synced baseline bank's questions, for the wording diff.
     * @type {any[]}
     */
    this.baselineQuestions = [];
    this.questionIndex = 0;
    /** Whether a category filter is active (moves stay within category). */
    this.categoryFilterActive = false;
    /**
     * Mutation sink. Defaults to "just apply the mutation" so the component
     * works standalone; the bank editor injects the store's `commit()`.
     * @type {(fn: () => void) => void}
     */
    this.onCommit = (fn) => fn();
  }

  render() {
    return QuestionCard({
      question: this.question,
      questionIndex: this.questionIndex,
      bank: this.bank,
      baselineQuestions: this.baselineQuestions,
      categoryFilterActive: this.categoryFilterActive,
      onCommit: this.onCommit,
      setClassName: (className) => {
        this.className = className;
      },
    });
  }
  /** @param {string} label @param {any} control */
  _field(label, control) {
    return questionCardField(label, control);
  }
  /** @param {string} value @param {(v: string) => void} onChange */
  _text(value, onChange) {
    return questionCardText(value, onChange);
  }
  /** @param {string[]} options @param {string} value @param {(v: string) => void} onChange */
  _select(options, value, onChange) {
    return questionCardSelect(options, value, onChange);
  }
}

/** @param {string} label @param {any} control */
export function questionCardField(label, control) {
  return h('div', { class: 'field' }, h('label', {}, label), control);
}

/** @param {string} value @param {(v: string) => void} onChange */
export function questionCardText(value, onChange) {
  return /** @type {any} */ (
    h('input', {
      class: 'field-input',
      value,
      onchange: (/** @type {any} */ e) => onChange(e.target.value),
    })
  );
}

/** @param {string[]} options @param {string} value @param {(v: string) => void} onChange */
export function questionCardSelect(options, value, onChange) {
  const s = /** @type {any} */ (
    h('select', {
      class: 'field-select',
      onchange: (/** @type {any} */ e) => onChange(e.target.value),
    })
  );
  options.forEach((o) => {
    const opt = /** @type {any} */ (h('option', { value: o }, o));
    if (o === value) opt.selected = true;
    s.appendChild(opt);
  });
  return s;
}

/** @param {(fn: () => void) => void} onCommit @param {any} q @param {string} id */
export function renameQuestion(onCommit, q, id) {
  onCommit(() => {
    q.id = id.trim() || q.id;
  });
}

/** @param {(fn: () => void) => void} onCommit @param {any} q @param {string} category */
export function setQuestionCategory(onCommit, q, category) {
  onCommit(() => {
    q.category = category || undefined;
  });
}

/** @param {(fn: () => void) => void} onCommit @param {any} q @param {string} responseType */
export function setQuestionResponseType(onCommit, q, responseType) {
  onCommit(() => {
    q.responseType = responseType;
    // `yes-no-na` (fixed Yes/No/NA) and `outcome` (derived from the Case Type's
    // Outcomes) don't carry their own option list; single/multi-choice do.
    if (responseType === 'yes-no-na' || responseType === 'outcome')
      delete q.options;
    else if (!q.options) q.options = ['Option A', 'Option B'];
    // `outcome`-type option→Outcome mapping is derived read-only, never stored.
    if (responseType === 'outcome') delete q.optionOutcomes;
  });
}

/** @param {(fn: () => void) => void} onCommit @param {any} q @param {string} failureCriteria */
export function setQuestionFailureCriteria(onCommit, q, failureCriteria) {
  onCommit(() => {
    q.failureCriteria = failureCriteria === '—' ? undefined : failureCriteria;
  });
}

/** @param {(fn: () => void) => void} onCommit @param {any[]} questions @param {boolean} categoryFilterActive @param {any} q @param {-1 | 1} direction */
export function moveQuestionInDraft(
  onCommit,
  questions,
  categoryFilterActive,
  q,
  direction
) {
  onCommit(() => {
    if (categoryFilterActive)
      moveQuestionWithinCategory(questions, q, direction);
    else moveQuestion(questions, q, direction);
  });
}

/** @param {(fn: () => void) => void} onCommit @param {any} q */
export function toggleQuestionDeprecated(onCommit, q) {
  onCommit(() => {
    q.deprecated = !q.deprecated;
  });
}

/** @param {(fn: () => void) => void} onCommit @param {any[]} questions @param {any} q */
export function duplicateQuestion(onCommit, questions, q) {
  onCommit(() => {
    const idx = questions.indexOf(q);
    const copy = structuredClone(q);
    copy.id = q.id + '-copy';
    questions.splice(idx + 1, 0, copy);
  });
}

/** @param {(fn: () => void) => void} onCommit @param {any[]} questions @param {any} q */
export function removeQuestionDraft(onCommit, questions, q) {
  const ok = /** @type {any} */ (globalThis).confirm?.(
    `Remove "${q.id}" from the draft? (Prefer "deprecate" to preserve history.)`
  );
  if (!ok) return;
  onCommit(() => {
    questions.splice(questions.indexOf(q), 1);
  });
}

customElements.define('cora-question-card', CORAQuestionCard);
