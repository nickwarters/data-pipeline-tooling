// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import {
  commitTreeFor,
  ensureTree,
  removeNode,
} from '../../lib/showwhen-tree.js';

/**
 * An AND/OR group of showWhen conditions. The candidate questions and the
 * mutation sink arrive as props (`bankQuestions`, `onCommit`) and are
 * forwarded to child leaves and nested groups; this component has no store
 * dependency.
 *
 * @param {{ question: any, group: any, isRoot: boolean, bankQuestions: any[], onCommit: (fn: () => void) => void, setClassName: (className: string) => void }} props
 * @returns {Node[] | undefined}
 */
export function ShowwhenGroup(props) {
  const q = props.question,
    group = props.group,
    isRoot = !!props.isRoot,
    onCommit = props.onCommit;
  if (!q || !group) return undefined;
  const bankQuestions = props.bankQuestions ?? [];
  const others = bankQuestions.filter((/** @type {any} */ x) => x.id !== q.id);

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
      onclick: () => toggleShowwhenGroup(onCommit, q, group),
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
        onclick: () => addShowwhenCondition(onCommit, q, group, others),
      },
      '+ condition'
    ),
    h(
      'button',
      {
        className: 'mini-btn',
        onclick: () => addShowwhenGroup(onCommit, q, group),
      },
      '+ ' + (group.op === 'and' ? 'OR group' : 'AND group')
    ),
    !isRoot &&
      h(
        'button',
        {
          className: 'mini-btn danger',
          title: 'Remove this group',
          onclick: () => removeShowwhenGroup(onCommit, q, group),
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
            bankQuestions,
            onCommit,
          })
        );
      } else {
        childElements.push(
          h('cora-showwhen-group', {
            question: q,
            group: child,
            bankQuestions,
            onCommit,
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
    /**
     * The active bank's questions (candidates for new conditions), passed
     * down by the mounting site and forwarded to children.
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
    return ShowwhenGroup({
      question: this.question,
      group: this.group,
      isRoot: this.isRoot,
      bankQuestions: this.bankQuestions,
      onCommit: this.onCommit,
      setClassName: (className) => {
        this.className = className;
      },
    });
  }
}

/** @param {(fn: () => void) => void} onCommit @param {any} q @param {any} group */
export function toggleShowwhenGroup(onCommit, q, group) {
  onCommit(() => {
    group.op = group.op === 'and' ? 'or' : 'and';
    commitTreeFor(q);
  });
}

/** @param {(fn: () => void) => void} onCommit @param {any} q @param {any} group @param {any[]} others */
export function addShowwhenCondition(onCommit, q, group, others) {
  const target = others[0]?.id;
  if (!target) {
    /** @type {any} */ (globalThis).alert?.(
      'Add at least one other question first.'
    );
    return;
  }
  onCommit(() => {
    group.children.push({
      type: 'leaf',
      qId: target,
      op: 'equals',
      value: '',
    });
    commitTreeFor(q);
  });
}

/** @param {(fn: () => void) => void} onCommit @param {any} q @param {any} group */
export function addShowwhenGroup(onCommit, q, group) {
  onCommit(() => {
    group.children.push({
      type: 'group',
      op: group.op === 'and' ? 'or' : 'and',
      children: [],
    });
    commitTreeFor(q);
  });
}

/** @param {(fn: () => void) => void} onCommit @param {any} q @param {any} group */
export function removeShowwhenGroup(onCommit, q, group) {
  onCommit(() => {
    removeNode(ensureTree(q), group);
    commitTreeFor(q);
  });
}

customElements.define('cora-showwhen-group', CORAShowwhenGroup);
