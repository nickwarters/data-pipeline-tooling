// @ts-check
import { ShellElement } from '../lib/view.js';
import { h } from '../lib/html.js';
import {
  countLeaves,
  ensureTree,
  treeDepth,
} from '../question-bank/question-bank-tree.js';

/**
 * @param {{ question: any }} props
 * @returns {HTMLElement | undefined}
 */
export function ShowwhenEditor(props) {
  const q = props.question;
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

export class CRShowwhenEditor extends ShellElement {
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
    return ShowwhenEditor({ question: this.question });
  }
}

customElements.define('cr-showwhen-editor', CRShowwhenEditor);
