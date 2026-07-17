// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import { commitTreeFor } from '../../lib/showwhen-tree.js';

/**
 * A single showWhen condition row. The candidate questions and the mutation
 * sink arrive as props (`bankQuestions`, `onCommit`); this component has no
 * store dependency.
 *
 * @param {{ question: any, parent: any, leaf: any, bankQuestions: any[], onCommit: (fn: () => void) => void }} props
 * @returns {HTMLElement | undefined}
 */
export function ShowwhenLeaf(props) {
  const q = props.question,
    parent = props.parent,
    leaf = props.leaf,
    onCommit = props.onCommit;
  if (!q || !leaf) return;
  const others = (props.bankQuestions ?? []).filter(
    (/** @type {any} */ x) => x.id !== q.id
  );

  return h(
    'div',
    { class: 'leaf' },
    h(
      'select',
      {
        'aria-label': 'Condition question',
        onchange: (/** @type {any} */ e) =>
          setShowwhenLeafQuestion(onCommit, q, leaf, e.target.value),
      },
      ...others.map((/** @type {any} */ o) =>
        h(
          'option',
          { value: o.id, selected: o.id === leaf.qId },
          o.id + (o.deprecated ? ' (deprecated)' : '')
        )
      )
    ),
    h(
      'select',
      {
        class: 'leaf-op',
        'aria-label': 'Condition operator',
        onchange: (/** @type {any} */ e) =>
          setShowwhenLeafOperator(onCommit, q, leaf, e.target.value),
      },
      ...[
        ['equals', '='],
        ['in', 'is one of'],
        ['answered', 'has been answered'],
      ].map(([k, lbl]) =>
        h('option', { value: k, selected: k === leaf.op }, lbl)
      )
    ),
    leaf.op !== 'answered'
      ? h('input', {
          'aria-label': 'Condition value',
          style: 'min-width:120px;',
          placeholder: leaf.op === 'in' ? 'A, B, C' : 'Yes',
          value: Array.isArray(leaf.value)
            ? leaf.value.join(', ')
            : (leaf.value ?? ''),
          onchange: (/** @type {any} */ e) =>
            setShowwhenLeafValue(onCommit, q, leaf, e.target.value),
        })
      : h('span', { class: 'leaf-answered-hint' }, '— any non-empty answer'),
    h(
      'span',
      {
        class: 'leaf-x',
        onclick: () => removeShowwhenLeaf(onCommit, q, parent, leaf),
      },
      '×'
    )
  );
}

export class CORAShowwhenLeaf extends ShellElement {
  constructor() {
    super();
    /** @type {any} */ this.question = null;
    /** @type {any} */ this.parent = null;
    /** @type {any} */ this.leaf = null;
    /**
     * The active bank's questions (candidates for the condition's subject),
     * passed down by the mounting site.
     * @type {any[]}
     */
    this.bankQuestions = [];
    /**
     * Mutation sink. Defaults to "just apply the mutation" so the component
     * works standalone; the bank editor injects the store's `commit()`.
     * @type {(fn: () => void) => void}
     */
    this.onCommit = (fn) => fn();
  }

  render() {
    return ShowwhenLeaf({
      question: this.question,
      parent: this.parent,
      leaf: this.leaf,
      bankQuestions: this.bankQuestions,
      onCommit: this.onCommit,
    });
  }
}

/** @param {(fn: () => void) => void} onCommit @param {any} q @param {any} leaf @param {string} qId */
export function setShowwhenLeafQuestion(onCommit, q, leaf, qId) {
  onCommit(() => {
    leaf.qId = qId;
    commitTreeFor(q);
  });
}

/** @param {(fn: () => void) => void} onCommit @param {any} q @param {any} leaf @param {string} op */
export function setShowwhenLeafOperator(onCommit, q, leaf, op) {
  onCommit(() => {
    leaf.op = op;
    if (leaf.op === 'answered') leaf.value = true;
    else if (leaf.op === 'in')
      leaf.value = Array.isArray(leaf.value) ? leaf.value : [];
    else leaf.value = typeof leaf.value === 'string' ? leaf.value : '';
    commitTreeFor(q);
  });
}

/** @param {(fn: () => void) => void} onCommit @param {any} q @param {any} leaf @param {string} value */
export function setShowwhenLeafValue(onCommit, q, leaf, value) {
  onCommit(() => {
    if (leaf.op === 'in')
      leaf.value = value
        .split(',')
        .map((/** @type {string} */ s) => s.trim())
        .filter(Boolean);
    else leaf.value = value;
    commitTreeFor(q);
  });
}

/** @param {(fn: () => void) => void} onCommit @param {any} q @param {any} parent @param {any} leaf */
export function removeShowwhenLeaf(onCommit, q, parent, leaf) {
  onCommit(() => {
    const i = parent.children.indexOf(leaf);
    if (i >= 0) parent.children.splice(i, 1);
    commitTreeFor(q);
  });
}

customElements.define('cora-showwhen-leaf', CORAShowwhenLeaf);
