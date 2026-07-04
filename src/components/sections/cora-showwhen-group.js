// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import {
  commit,
  currentBank,
} from '../../question-bank/question-bank-store.js';
import {
  commitTreeFor,
  ensureTree,
  removeNode,
} from '../../question-bank/question-bank-tree.js';

/**
 * @param {{ question: any, group: any, isRoot: boolean, setClassName: (className: string) => void }} props
 * @returns {Node[] | undefined}
 */
export function ShowwhenGroup(props) {
  const q = props.question,
    group = props.group,
    isRoot = !!props.isRoot;
  if (!q || !group) return undefined;
  const others = currentBank
    .get()
    .questions.filter((/** @type {any} */ x) => x.id !== q.id);

  const opLabel = group.op === 'and' ? 'ALL OF' : 'ANY OF';
  const opQual =
    group.op === 'and'
      ? '(every condition must hold)'
      : '(at least one must hold)';

  const toggle = h(
    'span',
    {
      className: `op-toggle op-${group.op}`,
      title: 'Click to switch between AND / OR',
      onclick: () => toggleShowwhenGroup(q, group),
    },
    h('span', { className: 'label' }, opLabel),
    h('span', { className: 'arrow' }, '⇅'),
    h('span', { className: 'qual' }, opQual)
  );

  const actions = h(
    'div',
    { className: 'group-actions' },
    h(
      'button',
      {
        className: 'mini-btn',
        onclick: () => addShowwhenCondition(q, group, others),
      },
      '+ condition'
    ),
    h(
      'button',
      {
        className: 'mini-btn',
        onclick: () => addShowwhenGroup(q, group),
      },
      '+ ' + (group.op === 'and' ? 'OR group' : 'AND group')
    ),
    !isRoot &&
      h(
        'button',
        {
          className: 'mini-btn danger',
          title: 'Remove this group',
          onclick: () => removeShowwhenGroup(q, group),
        },
        '× group'
      )
  );

  /** @type {HTMLElement[]} */
  const childElements = [];
  group.children.forEach(
    (/** @type {any} */ child, /** @type {number} */ idx) => {
      if (idx > 0) {
        childElements.push(
          h(
            'div',
            { className: 'conjunction' },
            h('span', { className: 'glyph' }, group.op === 'and' ? 'AND' : 'OR')
          )
        );
      }
      if (child.type === 'leaf') {
        childElements.push(
          h('cora-showwhen-leaf', {
            question: q,
            parent: group,
            leaf: child,
          })
        );
      } else {
        childElements.push(
          h('cora-showwhen-group', {
            question: q,
            group: child,
          })
        );
      }
    }
  );

  const childrenContainer = h(
    'div',
    { className: 'group-children' },
    childElements
  );

  props.setClassName(`group op-${group.op}`);
  return [
    h('div', { className: 'group-head' }, toggle, actions),
    childrenContainer,
  ];
}

export class CORAShowwhenGroup extends ShellElement {
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
    return ShowwhenGroup({
      question: this.question,
      group: this.group,
      isRoot: this.isRoot,
      setClassName: (className) => {
        this.className = className;
      },
    });
  }
}

/** @param {any} q @param {any} group */
export function toggleShowwhenGroup(q, group) {
  commit(() => {
    group.op = group.op === 'and' ? 'or' : 'and';
    commitTreeFor(q);
  });
}

/** @param {any} q @param {any} group @param {any[]} others */
export function addShowwhenCondition(q, group, others) {
  const target = others[0]?.id;
  if (!target) {
    /** @type {any} */ (globalThis).alert?.(
      'Add at least one other question first.'
    );
    return;
  }
  commit(() => {
    group.children.push({
      type: 'leaf',
      qId: target,
      op: 'equals',
      value: '',
    });
    commitTreeFor(q);
  });
}

/** @param {any} q @param {any} group */
export function addShowwhenGroup(q, group) {
  commit(() => {
    group.children.push({
      type: 'group',
      op: group.op === 'and' ? 'or' : 'and',
      children: [],
    });
    commitTreeFor(q);
  });
}

/** @param {any} q @param {any} group */
export function removeShowwhenGroup(q, group) {
  commit(() => {
    removeNode(ensureTree(q), group);
    commitTreeFor(q);
  });
}

customElements.define('cora-showwhen-group', CORAShowwhenGroup);
