// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import {
  activeSlug,
  commit,
  filters,
} from '../question-bank/question-bank-store.js';
import {
  canMoveQuestion,
  canMoveQuestionWithinCategory,
  moveQuestion,
  moveQuestionWithinCategory,
} from '../question-bank/question-bank-order.js';

export class CRQuestionCard extends ReactiveElement {
  constructor() {
    super();
    /** @type {any} */ this.question = null;
    /** @type {any[]} */ this.bankQuestions = [];
    this.questionIndex = 0;
  }

  _render() {
    const content = this.render();
    if (content !== undefined) {
      if (Array.isArray(content)) this.replaceChildren(...content);
      else this.replaceChildren(content);
    } else {
      this.replaceChildren();
    }
  }

  render() {
    const q = this.question;
    if (!q) return;
    const i = this.questionIndex ?? 0;
    const bankQuestions =
      /** @type {any[]} */ (this.bankQuestions) ?? /** @type {any[]} */ ([]);
    const categoryFilterActive = Boolean(filters.get().category);
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
          commit(() => {
            q.id = e.target.value.trim() || q.id;
          }),
      })
    );

    const wording = h('cr-wording-editor', { question: q });

    const grid = h(
      'div',
      { class: 'field-grid' },
      this._field(
        'Category',
        this._text(q.category || '', (/** @type {string} */ v) =>
          commit(() => {
            q.category = v || undefined;
          })
        )
      ),
      this._field(
        'Response Type',
        this._select(
          ['yes-no-na', 'single-choice', 'multi-choice'],
          q.responseType,
          (/** @type {string} */ v) => {
            commit(() => {
              q.responseType = v;
              if (v === 'yes-no-na') delete q.options;
              else if (!q.options) q.options = ['Option A', 'Option B'];
            });
          }
        )
      )
    );
    if (q.responseType === 'yes-no-na') {
      grid.appendChild(
        this._field(
          'Failure Criteria',
          this._select(
            ['—', 'Yes', 'No', 'N/A'],
            q.failureCriteria || '—',
            (/** @type {string} */ v) => {
              commit(() => {
                q.failureCriteria = v === '—' ? undefined : v;
              });
            }
          )
        )
      );
    }

    const bodyChildren = [wording, grid];
    if (q.responseType !== 'yes-no-na') {
      bodyChildren.push(h('cr-options-editor', { question: q }));
    }
    bodyChildren.push(
      h('cr-question-labels', { question: q }),
      h('cr-showwhen-editor', { question: q }),
      h('cr-remediation-editor', { question: q })
    );

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
            commit((types) => {
              const b = types[activeSlug.get()];
              if (filters.get().category)
                moveQuestionWithinCategory(b.questions, q, -1);
              else moveQuestion(b.questions, q, -1);
            }),
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
            commit((types) => {
              const b = types[activeSlug.get()];
              if (filters.get().category)
                moveQuestionWithinCategory(b.questions, q, 1);
              else moveQuestion(b.questions, q, 1);
            }),
        },
        '↓'
      ),
      h(
        'button',
        {
          class: 'icon-btn',
          title: q.deprecated ? 'Restore' : 'Mark deprecated',
          onclick: () =>
            commit(() => {
              q.deprecated = !q.deprecated;
            }),
        },
        q.deprecated ? '↩' : '⌀'
      ),
      h(
        'button',
        {
          class: 'icon-btn',
          title: 'Duplicate',
          onclick: () =>
            commit((types) => {
              const b = types[activeSlug.get()];
              const idx = b.questions.indexOf(q);
              const copy = structuredClone(q);
              copy.id = q.id + '-copy';
              b.questions.splice(idx + 1, 0, copy);
            }),
        },
        '⎘'
      ),
      h(
        'button',
        {
          class: 'icon-btn danger',
          title: 'Remove draft',
          onclick: () => {
            const ok = /** @type {any} */ (globalThis).confirm?.(
              `Remove "${q.id}" from the draft? (Prefer "deprecate" to preserve history.)`
            );
            if (!ok) return;
            commit((types) => {
              const b = types[activeSlug.get()];
              b.questions.splice(b.questions.indexOf(q), 1);
            });
          },
        },
        '×'
      )
    );

    const stripe = h('div', { class: 'card-stripe' });
    if (q.showWhen && !q.deprecated)
      stripe.style.cssText = 'background: var(--ochre);';

    this.className = 'card' + (q.deprecated ? ' deprecated' : '');
    return [stripe, h('div', { class: 'card-head' }, num, body, actions)];
  }
  /** @param {string} label @param {any} control */
  _field(label, control) {
    return h('div', { class: 'field' }, h('label', {}, label), control);
  }
  /** @param {string} value @param {(v: string) => void} onChange */
  _text(value, onChange) {
    const i = /** @type {any} */ (h('input', { class: 'field-input', value }));
    i.addEventListener('change', (/** @type {any} */ e) =>
      onChange(e.target.value)
    );
    return i;
  }
  /** @param {string[]} options @param {string} value @param {(v: string) => void} onChange */
  _select(options, value, onChange) {
    const s = /** @type {any} */ (h('select', { class: 'field-select' }));
    options.forEach((o) => {
      const opt = /** @type {any} */ (h('option', { value: o }, o));
      if (o === value) opt.selected = true;
      s.appendChild(opt);
    });
    s.addEventListener('change', (/** @type {any} */ e) =>
      onChange(e.target.value)
    );
    return s;
  }
}

customElements.define('cr-question-card', CRQuestionCard);
