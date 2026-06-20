// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import { baselineBank, commit } from '../question-bank/question-bank-store.js';
import { escapeHtml } from '../question-bank/question-bank-compile.js';

export class CRWordingEditor extends ReactiveElement {
  constructor() {
    super();
    /** @type {any} */
    this.question = null;
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
    const base = (baselineBank.get()?.questions || []).find((/** @type {any} */ b) => b.id === q.id);

    const wrap = h('div', { class: 'wording' });
    wrap.appendChild(h('span', { class: 'edit-mark' }, 'click to edit'));

    const txt = /** @type {any} */ (h('textarea', {
      class: 'q-text' + (q.deprecated ? ' deprecated-text' : ''),
      rows: '1', 'aria-label': 'Question wording', spellcheck: 'true',
      'data-focus-key': `wording:${q.id}`
    }));
    txt.value = q.text;
    const autoresize = () => { try { txt.style.height = 'auto'; txt.style.height = (txt.scrollHeight + 2) + 'px'; } catch {} };
    txt.addEventListener('focus', () => { wrap.className = 'wording focused'; });
    txt.addEventListener('blur',  () => { wrap.className = 'wording'; });
    txt.addEventListener('input', (/** @type {any} */ e) => { autoresize(); commit(() => { q.text = e.target.value; }); });
    const raf = (/** @type {any} */ (globalThis)).requestAnimationFrame;
    if (typeof raf === 'function') raf(autoresize);
    wrap.appendChild(txt);

    const status = h('span');
    if (!base) status.innerHTML = '<span class="changed">● New draft</span>';
    else if (base.text !== q.text) status.innerHTML = `<span class="changed">● Edited · was "${escapeHtml(base.text.slice(0,60))}${base.text.length>60?'…':''}"</span>`;
    else status.textContent = '○ Unchanged';

    const len = q.text.length;
    const cc = h('span', { class: 'charcount' + (len > 180 ? ' warn' : '') }, `${len} chars`);

    wrap.appendChild(h('div', { class: 'wording-foot' }, status, cc));
    return wrap;
  }
}

customElements.define('cr-wording-editor', CRWordingEditor);
