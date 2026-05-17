// @ts-check
import { CRElement } from './cr-element.js';
import { el } from './cr-bank-dom.js';
import { commit, currentBank } from './question-bank-store.js';
import { commitTreeFor } from './question-bank-tree.js';

export class CRShowwhenLeaf extends CRElement {
  constructor() {
    super();
    /** @type {any} */ this.question = null;
    /** @type {any} */ this.parent = null;
    /** @type {any} */ this.leaf = null;
  }
  connectedCallback() { this._render(); }
  _render() {
    const q = this.question, parent = this.parent, leaf = this.leaf;
    if (!q || !leaf) return;
    const others = currentBank.get().questions.filter((/** @type {any} */ x) => x.id !== q.id);

    const sel = /** @type {any} */ (el('select'));
    others.forEach((/** @type {any} */ o) => {
      const opt = /** @type {any} */ (el('option', { value: o.id }, o.id + (o.deprecated ? ' (deprecated)' : '')));
      if (o.id === leaf.qId) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', (/** @type {any} */ e) =>
      commit(() => { leaf.qId = e.target.value; commitTreeFor(q); }));

    const op = /** @type {any} */ (el('select', { class: 'leaf-op' }));
    for (const [k, lbl] of [['equals','='], ['in','is one of'], ['answered','has been answered']]) {
      const opt = /** @type {any} */ (el('option', { value: k }, lbl));
      if (k === leaf.op) opt.selected = true;
      op.appendChild(opt);
    }
    op.addEventListener('change', (/** @type {any} */ e) => commit(() => {
      leaf.op = e.target.value;
      if (leaf.op === 'answered') leaf.value = true;
      else if (leaf.op === 'in') leaf.value = Array.isArray(leaf.value) ? leaf.value : [];
      else leaf.value = typeof leaf.value === 'string' ? leaf.value : '';
      commitTreeFor(q);
    }));

    const row = el('div', { class: 'leaf' }, sel, op);

    if (leaf.op !== 'answered') {
      const val = /** @type {any} */ (el('input', {
        style: 'min-width:120px;',
        placeholder: leaf.op === 'in' ? 'A, B, C' : 'Yes',
        value: Array.isArray(leaf.value) ? leaf.value.join(', ') : (leaf.value ?? ''),
      }));
      val.addEventListener('change', (/** @type {any} */ e) => commit(() => {
        if (leaf.op === 'in') leaf.value = e.target.value.split(',').map((/** @type {string} */ s) => s.trim()).filter(Boolean);
        else leaf.value = e.target.value;
        commitTreeFor(q);
      }));
      row.appendChild(val);
    } else {
      row.appendChild(el('span', { class: 'leaf-answered-hint' }, '— any non-empty answer'));
    }

    row.appendChild(el('span', { class: 'leaf-x',
      onclick: () => commit(() => {
        const i = parent.children.indexOf(leaf);
        if (i >= 0) parent.children.splice(i, 1);
        commitTreeFor(q);
      }) }, '×'));

    this.replaceChildren(row);
  }
}

customElements.define('cr-showwhen-leaf', CRShowwhenLeaf);
