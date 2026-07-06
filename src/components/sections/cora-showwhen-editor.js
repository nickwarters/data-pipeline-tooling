// @ts-check
import { ShellElement } from '../../lib/view.js';
import { signal } from '../../lib/signal.js';
import { h } from '../../lib/html.js';
import {
  countLeaves,
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
    /** @type {import('../../lib/signal.js').Signal<'always' | 'conditional'> | null} */
    this._mode = null;
  }

  /**
   * Local view state for whether the condition editor is revealed. Defaults to
   * `conditional` when the question already carries a `showWhen`, so existing
   * gating stays visible; otherwise `always`, keeping the editor decluttered
   * until a Reviewer opts into conditions. Purely presentational — switching to
   * `always` never discards the question's conditions.
   *
   * @returns {import('../../lib/signal.js').Signal<'always' | 'conditional'>}
   */
  _modeSignal() {
    if (!this._mode) {
      const tree = ensureTree(this.question);
      this._mode = signal(tree.children.length > 0 ? 'conditional' : 'always');
    }
    return this._mode;
  }

  render() {
    if (!this.question) return undefined;
    const mode = this._modeSignal();
    return ShowwhenEditor({
      question: this.question,
      mode: mode.get(),
      onModeChange: (next) => mode.set(next),
    });
  }
}

customElements.define('cora-showwhen-editor', CORAShowwhenEditor);
