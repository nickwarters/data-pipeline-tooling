// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
// MAINT-16: this editor primitive still reads the bank-editor store singleton
// (`commit`/`currentBank`). Injecting that state via props is not mechanical —
// the whole editor tree is reactively bound to these signals — so the coupling
// is documented and left in place (see the component-layering-contract test).
import {
  commit,
  currentBank,
} from '../../question-bank/question-bank-store.js';
import { commitTreeFor } from '../../lib/showwhen-tree.js';

/**
 * @param {{ question: any, parent: any, leaf: any }} props
 * @returns {HTMLElement | undefined}
 */
export function ShowwhenLeaf(props) {
  const q = props.question,
    parent = props.parent,
    leaf = props.leaf;
  if (!q || !leaf) return;
  const others = currentBank
    .get()
    .questions.filter((/** @type {any} */ x) => x.id !== q.id);

  return h(
    'div',
    { class: 'leaf' },
    h(
      'select',
      {
        onchange: (/** @type {any} */ e) =>
          setShowwhenLeafQuestion(q, leaf, e.target.value),
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
        onchange: (/** @type {any} */ e) =>
          setShowwhenLeafOperator(q, leaf, e.target.value),
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
          style: 'min-width:120px;',
          placeholder: leaf.op === 'in' ? 'A, B, C' : 'Yes',
          value: Array.isArray(leaf.value)
            ? leaf.value.join(', ')
            : (leaf.value ?? ''),
          onchange: (/** @type {any} */ e) =>
            setShowwhenLeafValue(q, leaf, e.target.value),
        })
      : h('span', { class: 'leaf-answered-hint' }, '— any non-empty answer'),
    h(
      'span',
      {
        class: 'leaf-x',
        onclick: () => removeShowwhenLeaf(q, parent, leaf),
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
  }

  render() {
    return ShowwhenLeaf({
      question: this.question,
      parent: this.parent,
      leaf: this.leaf,
    });
  }
}

/** @param {any} q @param {any} leaf @param {string} qId */
export function setShowwhenLeafQuestion(q, leaf, qId) {
  commit(() => {
    leaf.qId = qId;
    commitTreeFor(q);
  });
}

/** @param {any} q @param {any} leaf @param {string} op */
export function setShowwhenLeafOperator(q, leaf, op) {
  commit(() => {
    leaf.op = op;
    if (leaf.op === 'answered') leaf.value = true;
    else if (leaf.op === 'in')
      leaf.value = Array.isArray(leaf.value) ? leaf.value : [];
    else leaf.value = typeof leaf.value === 'string' ? leaf.value : '';
    commitTreeFor(q);
  });
}

/** @param {any} q @param {any} leaf @param {string} value */
export function setShowwhenLeafValue(q, leaf, value) {
  commit(() => {
    if (leaf.op === 'in')
      leaf.value = value
        .split(',')
        .map((/** @type {string} */ s) => s.trim())
        .filter(Boolean);
    else leaf.value = value;
    commitTreeFor(q);
  });
}

/** @param {any} q @param {any} parent @param {any} leaf */
export function removeShowwhenLeaf(q, parent, leaf) {
  commit(() => {
    const i = parent.children.indexOf(leaf);
    if (i >= 0) parent.children.splice(i, 1);
    commitTreeFor(q);
  });
}

customElements.define('cora-showwhen-leaf', CORAShowwhenLeaf);
