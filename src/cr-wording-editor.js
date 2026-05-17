// @ts-check
import { CRElement } from './cr-element.js';
import { el, reactive } from './cr-bank-dom.js';
import { baselineBank, commit } from './question-bank-store.js';
import { escapeHtml } from './question-bank-compile.js';

export class CRWordingEditor extends CRElement {
  constructor() {
    super();
    /** @type {any} */
    this.question = null;
  }
  connectedCallback() { reactive(this, () => this._render()); }
  _render() {
    const q = this.question;
    if (!q) return;
    const base = (baselineBank.get()?.questions || []).find((/** @type {any} */ b) => b.id === q.id);

    const wrap = el('div', { class: 'wording' });
    wrap.appendChild(el('span', { class: 'edit-mark' }, 'click to edit'));

    const txt = /** @type {any} */ (el('textarea', {
      class: 'q-text' + (q.deprecated ? ' deprecated-text' : ''),
      rows: '1', 'aria-label': 'Question wording', spellcheck: 'true',
      'data-focus-key': `wording:${q.id}`,
    }));
    txt.value = q.text;
    const autoresize = () => { try { txt.style.height = 'auto'; txt.style.height = (txt.scrollHeight + 2) + 'px'; } catch {} };
    txt.addEventListener('focus', () => { wrap.className = 'wording focused'; });
    txt.addEventListener('blur',  () => { wrap.className = 'wording'; });
    txt.addEventListener('input', (/** @type {any} */ e) => { autoresize(); commit(() => { q.text = e.target.value; }); });
    const raf = (/** @type {any} */ (globalThis)).requestAnimationFrame;
    if (typeof raf === 'function') raf(autoresize);
    wrap.appendChild(txt);

    const status = el('span');
    if (!base) status.innerHTML = '<span class="changed">● New draft</span>';
    else if (base.text !== q.text) status.innerHTML = `<span class="changed">● Edited · was "${escapeHtml(base.text.slice(0,60))}${base.text.length>60?'…':''}"</span>`;
    else status.textContent = '○ Unchanged';

    const len = q.text.length;
    const cc = el('span', { class: 'charcount' + (len > 180 ? ' warn' : '') }, `${len} chars`);

    wrap.appendChild(el('div', { class: 'wording-foot' }, status, cc));
    this.replaceChildren(wrap);
  }
}

customElements.define('cr-wording-editor', CRWordingEditor);
