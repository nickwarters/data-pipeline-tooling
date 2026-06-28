// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import {
  countLeaves,
  ensureTree,
  treeDepth,
} from '../question-bank/question-bank-tree.js';

// TODO(simplify-ui): Convert this class-backed custom element to the simpler
// function-component model. The target shape is a plain function returning h()
// nodes, wrapped in reactive() only when local signals need to re-render; keep
// custom elements only for route or browser-integration shells.
export class CRShowwhenEditor extends ReactiveElement {
  constructor() {
    super();
    /** @type {any} */
    this.question = null;
  }

  _render() {
    const content = this.render();
    if (content !== undefined) {
      if (Array.isArray(content)) {
        this.replaceChildren(...content);
      } else {
        this.replaceChildren(content);
      }
    }
  }

  render() {
    const q = this.question;
    if (!q) return undefined;
    const tree = ensureTree(q);
    const count = countLeaves(tree);
    const depth = treeDepth(tree);
    const desc =
      count === 0
        ? ''
        : `${count} condition${count === 1 ? '' : 's'}${depth > 1 ? ` · ${depth} levels deep` : ''}`;

    const empty =
      tree.children.length === 0
        ? h(
            'div',
            { className: 'showwhen-empty' },
            '// always shown — add a condition to gate this question'
          )
        : null;

    const grp = /** @type {any} */ (
      h('cr-showwhen-group', {
        question: q,
        group: tree,
        isRoot: true,
      })
    );

    return h(
      'div',
      { className: 'showwhen-block' },
      h(
        'div',
        { className: 'showwhen-header' },
        h('span', {}, '◆ Show when'),
        h('span', { className: 'showwhen-desc' }, desc)
      ),
      empty,
      grp
    );
  }
}

customElements.define('cr-showwhen-editor', CRShowwhenEditor);
