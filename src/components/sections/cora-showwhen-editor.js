// @ts-check
import { ShellElement } from '../../lib/view.js';
import { signal } from '../../lib/signal.js';
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import {
  clearConditions,
  countLeaves,
  ensureTree,
  treeDepth,
} from '../../lib/showwhen-tree.js';

/**
 * @param {{ question: any, mode: 'always' | 'conditional', onModeChange: (mode: 'always' | 'conditional') => void, bankQuestions: any[], onCommit: (fn: () => void) => void }} props
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
    // Keep the mode control last so the description's auto margin leaves it
    // anchored to the header's right edge in both Always and Conditional modes.
    conditional ? h('span', { className: 'showwhen-desc' }, desc) : null,
    modeSelect
  );

  if (!conditional) {
    return h('div', { className: 'showwhen-block' }, header);
  }

  const empty =
    tree.children.length === 0
      ? EmptyState('// always shown — add a condition to gate this question', {
          tag: 'div',
          className: 'showwhen-empty',
        })
      : null;

  const grp = /** @type {any} */ (
    h('cora-showwhen-group', {
      question: q,
      group: tree,
      isRoot: true,
      bankQuestions: props.bankQuestions,
      onCommit: props.onCommit,
    })
  );

  return h('div', { className: 'showwhen-block' }, header, empty, grp);
}

export class CORAShowwhenEditor extends ShellElement {
  constructor() {
    super();
    /** @type {any} */
    this.question = null;
    /**
     * The active bank's questions, forwarded to the condition tree.
     * @type {any[]}
     */
    this.bankQuestions = [];
    /**
     * Mutation sink. Defaults to "just apply the mutation" so the component
     * works standalone; the bank editor injects the store's `commit()`.
     * @type {(fn: () => void) => void}
     */
    this.onCommit = (fn) => fn();
    /**
     * Transient reveal state for the "Conditional" editor. A question with
     * conditions is always shown; this only matters while a curator has opted
     * into Conditional but not yet added a condition (an empty group can't be
     * persisted). Deliberately not stored on the question — switching to
     * "Always" clears the conditions outright (recover via per-question reset),
     * so `showWhen` presence is the durable source of truth.
     * @type {import('../../lib/signal.js').Signal<boolean> | null}
     */
    this._reveal = null;
  }

  render() {
    const q = this.question;
    if (!q) return undefined;
    const hasConditions = countLeaves(ensureTree(q)) > 0;
    if (!this._reveal) this._reveal = signal(hasConditions);
    const reveal = this._reveal;
    // Read the signal unconditionally so the render effect always subscribes —
    // `||` would short-circuit past it whenever conditions already exist, and
    // then clearing them + reveal.set(false) could not trigger a re-render.
    const revealed = reveal.get();
    const conditional = hasConditions || revealed;

    return ShowwhenEditor({
      question: q,
      mode: conditional ? 'conditional' : 'always',
      bankQuestions: this.bankQuestions,
      onCommit: this.onCommit,
      onModeChange: (next) => {
        if (next === 'always') {
          this.onCommit(() => clearConditions(q));
          reveal.set(false);
        } else {
          reveal.set(true);
        }
      },
    });
  }
}

customElements.define('cora-showwhen-editor', CORAShowwhenEditor);
