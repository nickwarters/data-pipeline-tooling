// @ts-check
import { CRElement } from './cr-element.js';
import { el } from '../question-bank/cr-bank-dom.js';
import { commit, currentBank } from '../question-bank/question-bank-store.js';
import { commitTreeFor, ensureTree, removeNode } from '../question-bank/question-bank-tree.js';

export class CRShowwhenGroup extends CRElement {
  constructor() {
    super();
    /** @type {any} */ this.question = null;
    /** @type {any} */ this.group = null;
    this.isRoot = false;
  }
  connectedCallback() { this._render(); }
  _render() {
    const q = this.question, group = this.group, isRoot = !!this.isRoot;
    if (!q || !group) return;
    const others = currentBank.get().questions.filter((/** @type {any} */ x) => x.id !== q.id);

    const opLabel = group.op === 'and' ? 'ALL OF' : 'ANY OF';
    const opQual  = group.op === 'and' ? '(every condition must hold)' : '(at least one must hold)';

    const toggle = el('span', {
      class: `op-toggle op-${group.op}`,
      title: 'Click to switch between AND / OR',
      html: `<span class="label">${opLabel}</span><span class="arrow">⇅</span><span class="qual">${opQual}</span>`,
      onclick: () => commit(() => {
        group.op = group.op === 'and' ? 'or' : 'and';
        commitTreeFor(q);
      }),
    });

    const actions = el('div', { class: 'group-actions' },
      el('button', { class: 'mini-btn', onclick: () => {
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
      el('button', { class: 'mini-btn', onclick: () => commit(() => {
        group.children.push({ type: 'group', op: group.op === 'and' ? 'or' : 'and', children: [] });
        commitTreeFor(q);
      }) }, '+ ' + (group.op === 'and' ? 'OR group' : 'AND group')),
      !isRoot && el('button', { class: 'mini-btn danger', title: 'Remove this group',
        onclick: () => commit(() => {
          removeNode(ensureTree(q), group);
          commitTreeFor(q);
        }) }, '× group'),
    );

    const children = el('div', { class: 'group-children' });
    group.children.forEach((/** @type {any} */ child, /** @type {number} */ idx) => {
      if (idx > 0) {
        children.appendChild(el('div', { class: 'conjunction' },
          el('span', { class: 'glyph' }, group.op === 'and' ? 'AND' : 'OR')));
      }
      if (child.type === 'leaf') {
        const leaf = /** @type {any} */ (document.createElement('cr-showwhen-leaf'));
        leaf.question = q;
        leaf.parent = group;
        leaf.leaf = child;
        children.appendChild(leaf);
      } else {
        const sub = /** @type {any} */ (document.createElement('cr-showwhen-group'));
        sub.question = q;
        sub.group = child;
        children.appendChild(sub);
      }
    });

    this.className = `group op-${group.op}`;
    this.replaceChildren(el('div', { class: 'group-head' }, toggle, actions), children);
  }
}

customElements.define('cr-showwhen-group', CRShowwhenGroup);
