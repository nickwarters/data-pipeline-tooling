// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import { commit, currentBank } from '../question-bank/question-bank-store.js';
import { commitTreeFor, ensureTree, removeNode } from '../question-bank/question-bank-tree.js';

export class CRShowwhenGroup extends ReactiveElement {
  constructor() {
    super();
    /** @type {any} */ this.question = null;
    /** @type {any} */ this.group = null;
    this.isRoot = false;
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
    const q = this.question, group = this.group, isRoot = !!this.isRoot;
    if (!q || !group) return undefined;
    const others = currentBank.get().questions.filter((/** @type {any} */ x) => x.id !== q.id);

    const opLabel = group.op === 'and' ? 'ALL OF' : 'ANY OF';
    const opQual  = group.op === 'and' ? '(every condition must hold)' : '(at least one must hold)';

    const toggle = h('span', {
      className: `op-toggle op-${group.op}`,
      title: 'Click to switch between AND / OR',
      onclick: () => commit(() => {
        group.op = group.op === 'and' ? 'or' : 'and';
        commitTreeFor(q);
      }),
    }, 
      h('span', { className: 'label' }, opLabel),
      h('span', { className: 'arrow' }, '⇅'),
      h('span', { className: 'qual' }, opQual)
    );

    const actions = h('div', { className: 'group-actions' },
      h('button', { className: 'mini-btn', onclick: () => {
        const target = others[0]?.id;
        if (!target) {
          (/** @type {any} */ (globalThis)).alert?.('Add at least one other question first.');
          return;
        }
        commit(() => {
          group.children.push({ type: 'leaf', qId: target, op: 'equals', value: '' });
          commitTreeFor(q);
        });
      } }, '+ condition'),
      h('button', { className: 'mini-btn', onclick: () => commit(() => {
        group.children.push({ type: 'group', op: group.op === 'and' ? 'or' : 'and', children: [] });
        commitTreeFor(q);
      }) }, '+ ' + (group.op === 'and' ? 'OR group' : 'AND group')),
      !isRoot && h('button', { className: 'mini-btn danger', title: 'Remove this group',
        onclick: () => commit(() => {
          removeNode(ensureTree(q), group);
          commitTreeFor(q);
        }) }, '× group')
    );

    const childElements = [];
    group.children.forEach((/** @type {any} */ child, /** @type {number} */ idx) => {
      if (idx > 0) {
        childElements.push(h('div', { className: 'conjunction' },
          h('span', { className: 'glyph' }, group.op === 'and' ? 'AND' : 'OR')));
      }
      if (child.type === 'leaf') {
        childElements.push(h('cr-showwhen-leaf', {
          question: q,
          parent: group,
          leaf: child
        }));
      } else {
        childElements.push(h('cr-showwhen-group', {
          question: q,
          group: child
        }));
      }
    });

    const childrenContainer = h('div', { className: 'group-children' }, childElements);

    this.className = `group op-${group.op}`;
    return [
      h('div', { className: 'group-head' }, toggle, actions),
      childrenContainer
    ];
  }
}

customElements.define('cr-showwhen-group', CRShowwhenGroup);
