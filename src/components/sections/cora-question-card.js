// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import {
  activeSlug,
  baselineBank,
  commit,
  currentBank,
  filters,
} from '../../question-bank/question-bank-store.js';
import {
  canMoveQuestion,
  canMoveQuestionWithinCategory,
  moveQuestion,
  moveQuestionWithinCategory,
} from '../../lib/question-order.js';

/**
 * @param {{ question: any, bankQuestions: any[], questionIndex: number, categoryFilterActive: boolean, setClassName: (className: string) => void }} props
 * @returns {Node[] | undefined}
 */
export function QuestionCard(props) {
  const q = props.question;
  if (!q) return;
  const i = props.questionIndex ?? 0;
  const bankQuestions = props.bankQuestions ?? [];
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
      onchange: (/** @type {any} */ e) => renameQuestion(q, e.target.value),
    })
  );

  const wording = h('cora-wording-editor', {
    question: q,
    baselineQuestion: (baselineBank.get()?.questions || []).find(
      (/** @type {any} */ candidate) => candidate.id === q.id
    ),
    onCommit: commit,
  });

  const grid = h(
    'div',
    { class: 'field-grid' },
    questionCardField(
      'Category',
      questionCardText(q.category || '', (/** @type {string} */ v) =>
        setQuestionCategory(q, v)
      )
    ),
    questionCardField(
      'Response Type',
      questionCardSelect(
        ['yes-no-na', 'single-choice', 'multi-choice', 'outcome'],
        q.responseType,
        (/** @type {string} */ v) => setQuestionResponseType(q, v)
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
          (/** @type {string} */ v) => setQuestionFailureCriteria(q, v)
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
      outcomeOptions: currentBank.get()?.outcomeOptions ?? [],
      onCommit: commit,
    }),
    h('cora-question-labels', { question: q }),
    h('cora-showwhen-editor', { question: q }),
    h('cora-remediation-editor', { question: q, onCommit: commit }),
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
        onclick: () => moveQuestionInDraft(q, -1),
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
        onclick: () => moveQuestionInDraft(q, 1),
      },
      '↓'
    ),
    h(
      'button',
      {
        class: 'icon-btn',
        title: q.deprecated ? 'Restore' : 'Mark deprecated',
        onclick: () => toggleQuestionDeprecated(q),
      },
      q.deprecated ? '↩' : '⌀'
    ),
    h(
      'button',
      {
        class: 'icon-btn',
        title: 'Duplicate',
        onclick: () => duplicateQuestion(q),
      },
      '⎘'
    ),
    h(
      'button',
      {
        class: 'icon-btn danger',
        title: 'Remove draft',
        onclick: () => removeQuestionDraft(q),
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
    /** @type {any[]} */ this.bankQuestions = [];
    this.questionIndex = 0;
  }

  render() {
    return QuestionCard({
      question: this.question,
      bankQuestions: this.bankQuestions,
      questionIndex: this.questionIndex,
      categoryFilterActive: Boolean(filters.get().category),
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

/** @param {any} q @param {string} id */
export function renameQuestion(q, id) {
  commit(() => {
    q.id = id.trim() || q.id;
  });
}

/** @param {any} q @param {string} category */
export function setQuestionCategory(q, category) {
  commit(() => {
    q.category = category || undefined;
  });
}

/** @param {any} q @param {string} responseType */
export function setQuestionResponseType(q, responseType) {
  commit(() => {
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

/** @param {any} q @param {string} failureCriteria */
export function setQuestionFailureCriteria(q, failureCriteria) {
  commit(() => {
    q.failureCriteria = failureCriteria === '—' ? undefined : failureCriteria;
  });
}

/** @param {any} q @param {-1 | 1} direction */
export function moveQuestionInDraft(q, direction) {
  commit((types) => {
    const b = types[activeSlug.get()];
    if (filters.get().category)
      moveQuestionWithinCategory(b.questions, q, direction);
    else moveQuestion(b.questions, q, direction);
  });
}

/** @param {any} q */
export function toggleQuestionDeprecated(q) {
  commit(() => {
    q.deprecated = !q.deprecated;
  });
}

/** @param {any} q */
export function duplicateQuestion(q) {
  commit((types) => {
    const b = types[activeSlug.get()];
    const idx = b.questions.indexOf(q);
    const copy = structuredClone(q);
    copy.id = q.id + '-copy';
    b.questions.splice(idx + 1, 0, copy);
  });
}

/** @param {any} q */
export function removeQuestionDraft(q) {
  const ok = /** @type {any} */ (globalThis).confirm?.(
    `Remove "${q.id}" from the draft? (Prefer "deprecate" to preserve history.)`
  );
  if (!ok) return;
  commit((types) => {
    const b = types[activeSlug.get()];
    b.questions.splice(b.questions.indexOf(q), 1);
  });
}

customElements.define('cora-question-card', CORAQuestionCard);
