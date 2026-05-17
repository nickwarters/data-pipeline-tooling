// @ts-check
import { CRElement } from './cr-element.js';
import { el } from '../question-bank/cr-bank-dom.js';
import { activeSlug, commit } from '../question-bank/question-bank-store.js';

export class CRQuestionCard extends CRElement {
  constructor() {
    super();
    /** @type {any} */ this.question = null;
    this.questionIndex = 0;
  }
  connectedCallback() { this._render(); }
  _render() {
    const q = this.question;
    if (!q) return;
    const i = this.questionIndex ?? 0;

    const num = el('div', { class: 'card-num' },
      el('div', { class: 'card-num-label' }, `№ ${String(i + 1).padStart(2, '0')}`),
      el('input', {
        class: 'id-input', value: q.id,
        onchange: (/** @type {any} */ e) => commit(() => { q.id = e.target.value.trim() || q.id; }),
      }),
    );

    const wording = /** @type {any} */ (document.createElement('cr-wording-editor'));
    wording.question = q;

    const grid = el('div', { class: 'field-grid' });
    grid.appendChild(this._field('Category', this._text(q.category || '', (/** @type {string} */ v) => commit(() => { q.category = v || undefined; }))));
    grid.appendChild(this._field('Response Type', this._select(['yes-no-na','single-choice','multi-choice'], q.responseType, (/** @type {string} */ v) => {
      commit(() => {
        q.responseType = v;
        if (v === 'yes-no-na') delete q.options;
        else if (!q.options) q.options = ['Option A', 'Option B'];
      });
    })));
    if (q.responseType === 'yes-no-na') {
      grid.appendChild(this._field('Failure Criteria', this._select(['—','Yes','No','N/A'], q.failureCriteria || '—', (/** @type {string} */ v) => {
        commit(() => { q.failureCriteria = v === '—' ? undefined : v; });
      })));
    }

    const body = el('div', { class: 'card-body' }, wording, grid);
    if (q.responseType !== 'yes-no-na') {
      const opts = /** @type {any} */ (document.createElement('cr-options-editor'));
      opts.question = q;
      body.appendChild(opts);
    }
    const sw = /** @type {any} */ (document.createElement('cr-showwhen-editor'));
    sw.question = q;
    body.appendChild(sw);

    const rem = /** @type {any} */ (document.createElement('cr-remediation-editor'));
    rem.question = q;
    body.appendChild(rem);

    const actions = el('div', { class: 'card-actions' },
      el('button', { class: 'icon-btn', title: q.deprecated ? 'Restore' : 'Mark deprecated',
        onclick: () => commit(() => { q.deprecated = !q.deprecated; }) },
        q.deprecated ? '↩' : '⌀'),
      el('button', { class: 'icon-btn', title: 'Duplicate',
        onclick: () => commit(types => {
          const b = types[activeSlug.get()];
          const idx = b.questions.indexOf(q);
          const copy = structuredClone(q);
          copy.id = q.id + '-copy';
          b.questions.splice(idx + 1, 0, copy);
        }) }, '⎘'),
      el('button', { class: 'icon-btn danger', title: 'Remove draft',
        onclick: () => {
          const ok = (/** @type {any} */ (globalThis)).confirm?.(`Remove "${q.id}" from the draft? (Prefer "deprecate" to preserve history.)`);
          if (!ok) return;
          commit(types => {
            const b = types[activeSlug.get()];
            b.questions.splice(b.questions.indexOf(q), 1);
          });
        } }, '×'),
    );

    const stripe = el('div', { class: 'card-stripe' });
    if (q.showWhen && !q.deprecated) stripe.style.cssText = 'background: var(--ochre);';

    this.className = 'card' + (q.deprecated ? ' deprecated' : '');
    this.replaceChildren(stripe, el('div', { class: 'card-head' }, num, body, actions));
  }
  /** @param {string} label @param {any} control */
  _field(label, control) {
    return el('div', { class: 'field' }, el('label', {}, label), control);
  }
  /** @param {string} value @param {(v: string) => void} onChange */
  _text(value, onChange) {
    const i = /** @type {any} */ (el('input', { class: 'field-input', value }));
    i.addEventListener('change', (/** @type {any} */ e) => onChange(e.target.value));
    return i;
  }
  /** @param {string[]} options @param {string} value @param {(v: string) => void} onChange */
  _select(options, value, onChange) {
    const s = /** @type {any} */ (el('select', { class: 'field-select' }));
    options.forEach(o => {
      const opt = /** @type {any} */ (el('option', { value: o }, o));
      if (o === value) opt.selected = true;
      s.appendChild(opt);
    });
    s.addEventListener('change', (/** @type {any} */ e) => onChange(e.target.value));
    return s;
  }
}

customElements.define('cr-question-card', CRQuestionCard);
