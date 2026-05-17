// @ts-check
import { CRElement } from './cr-element.js';
import { el, reactive } from './cr-bank-dom.js';
import { countLeaves, ensureTree, treeDepth } from './question-bank-tree.js';

export class CRShowwhenEditor extends CRElement {
  constructor() {
    super();
    /** @type {any} */
    this.question = null;
  }
  connectedCallback() { reactive(this, () => this._render()); }
  _render() {
    const q = this.question;
    if (!q) return;
    const tree = ensureTree(q);
    const count = countLeaves(tree);
    const depth = treeDepth(tree);
    const desc = count === 0 ? '' : `${count} condition${count === 1 ? '' : 's'}${depth > 1 ? ` · ${depth} levels deep` : ''}`;

    const wrap = el('div', { class: 'showwhen-block' },
      el('div', { class: 'showwhen-header' },
        el('span', {}, '◆ Show when'),
        el('span', { class: 'showwhen-desc' }, desc),
      ),
    );
    if (tree.children.length === 0) {
      wrap.appendChild(el('div', { class: 'showwhen-empty' },
        '// always shown — add a condition to gate this question'));
    }
    const grp = /** @type {any} */ (document.createElement('cr-showwhen-group'));
    grp.question = q;
    grp.group = tree;
    grp.isRoot = true;
    wrap.appendChild(grp);
    this.replaceChildren(wrap);
  }
}

customElements.define('cr-showwhen-editor', CRShowwhenEditor);
