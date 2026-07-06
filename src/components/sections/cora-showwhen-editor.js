// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import { commit } from '../../question-bank/question-bank-store.js';
import {
  countLeaves,
  effectiveShowWhenMode,
  ensureTree,
  treeDepth,
} from '../../question-bank/question-bank-tree.js';

/**
 * @param {{ question: any, mode: 'always' | 'conditional', onModeChange: (mode: 'always' | 'conditional') => void }} props
 * @returns {HTMLElement | undefined}
 */
export function ShowwhenEditor(props) {
  const q = props.question;
  if (!q) return undefined;
  const conditional = props.mode === 'conditional';
  const tree = ensureTree(q);
  const count = countLeaves(tree);
  const depth = treeDepth(tree);
  const desc =
    count === 0
      ? ''
      : `${count} condition${count === 1 ? '' : 's'}${depth > 1 ? ` · ${depth} levels deep` : ''}`;

  const modeSelect = /** @type {any} */ (
    h(
      'select',
      {
        className: 'showwhen-mode',
        value: props.mode,
        'aria-label': 'Show when',
        'data-focus-key': `showwhen-mode-${q.id}`,
        onChange: (/** @type {any} */ e) => {
          const v = e.target.value === 'conditional' ? 'conditional' : 'always';
          props.onModeChange(v);
        },
      },
      h('option', { value: 'always' }, 'Always'),
      h('option', { value: 'conditional' }, 'Conditional')
    )
  );

  const header = h(
    'div',
    { className: 'showwhen-header' },
    h('span', {}, '◆ Show when'),
    modeSelect,
    conditional ? h('span', { className: 'showwhen-desc' }, desc) : null
  );

  if (!conditional) {
    return h('div', { className: 'showwhen-block' }, header);
  }

  const empty =
    tree.children.length === 0
      ? h(
          'div',
          { className: 'showwhen-empty' },
          '// always shown — add a condition to gate this question'
        )
      : null;

  const grp = /** @type {any} */ (
    h('cora-showwhen-group', {
      question: q,
      group: tree,
      isRoot: true,
    })
  );

  return h('div', { className: 'showwhen-block' }, header, empty, grp);
}

export class CORAShowwhenEditor extends ShellElement {
  constructor() {
    super();
    /** @type {any} */
    this.question = null;
  }

  render() {
    const q = this.question;
    if (!q) return undefined;
    return ShowwhenEditor({
      question: q,
      mode: effectiveShowWhenMode(q),
      onModeChange: (next) => setShowWhenMode(q, next),
    });
  }
}

/**
 * Persist the curator's Show-When mode choice. The mode is only recorded when
 * it *deviates* from the derived default (conditions present ⇒ conditional,
 * absent ⇒ always), so the common cases stay flag-free and the diff stays
 * quiet. Crucially, switching to `always` records the intent without touching
 * the question's `showWhen`, so the conditions are retained under the hood and
 * recoverable until Send-for-Review bakes them out.
 *
 * @param {any} q
 * @param {'always' | 'conditional'} next
 */
function setShowWhenMode(q, next) {
  commit(() => {
    const derived = countLeaves(ensureTree(q)) > 0 ? 'conditional' : 'always';
    if (next === derived) delete q.showWhenMode;
    else q.showWhenMode = next;
  });
}

customElements.define('cora-showwhen-editor', CORAShowwhenEditor);
