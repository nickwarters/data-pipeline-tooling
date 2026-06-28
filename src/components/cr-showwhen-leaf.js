// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import { commit, currentBank } from '../question-bank/question-bank-store.js';
import { commitTreeFor } from '../question-bank/question-bank-tree.js';

// TODO(simplify-ui): Convert this class-backed custom element to the simpler
// function-component model. The target shape is a plain function returning h()
// nodes, wrapped in reactive() only when local signals need to re-render; keep
// custom elements only for route or browser-integration shells.
export class CRShowwhenLeaf extends ReactiveElement {
  constructor() {
    super();
    /** @type {any} */ this.question = null;
    /** @type {any} */ this.parent = null;
    /** @type {any} */ this.leaf = null;
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
    const q = this.question,
      parent = this.parent,
      leaf = this.leaf;
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
            commit(() => {
              leaf.qId = e.target.value;
              commitTreeFor(q);
            }),
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
            commit(() => {
              leaf.op = e.target.value;
              if (leaf.op === 'answered') leaf.value = true;
              else if (leaf.op === 'in')
                leaf.value = Array.isArray(leaf.value) ? leaf.value : [];
              else
                leaf.value = typeof leaf.value === 'string' ? leaf.value : '';
              commitTreeFor(q);
            }),
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
              commit(() => {
                if (leaf.op === 'in')
                  leaf.value = e.target.value
                    .split(',')
                    .map((/** @type {string} */ s) => s.trim())
                    .filter(Boolean);
                else leaf.value = e.target.value;
                commitTreeFor(q);
              }),
          })
        : h('span', { class: 'leaf-answered-hint' }, '— any non-empty answer'),
      h(
        'span',
        {
          class: 'leaf-x',
          onclick: () =>
            commit(() => {
              const i = parent.children.indexOf(leaf);
              if (i >= 0) parent.children.splice(i, 1);
              commitTreeFor(q);
            }),
        },
        '×'
      )
    );
  }
}

customElements.define('cr-showwhen-leaf', CRShowwhenLeaf);
