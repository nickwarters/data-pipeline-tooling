// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import {
  countLeaves,
  parseShowWhen,
  treeDepth,
} from '../../lib/showwhen-tree.js';
import { ShowwhenGroup } from './showwhen-group.js';

/**
 * Pure showWhen editor. Empty conditional-mode reveal state belongs to the
 * route slice; the persisted tree remains the Question Definition's showWhen.
 * @param {{ question: any, conditional: boolean, bankQuestions: any[], dispatch: (action: any) => void }} props
 */
export function ShowwhenEditor(props) {
  const question = props.question;
  if (!question) return undefined;
  const tree = parseShowWhen(question.showWhen);
  const count = countLeaves(tree);
  const depth = treeDepth(tree);
  const desc = count
    ? `${count} condition${count === 1 ? '' : 's'}${depth > 1 ? ` · ${depth} levels deep` : ''}`
    : '';
  const header = h(
    'div',
    { className: 'showwhen-header' },
    h('span', {}, '◆ Show when'),
    props.conditional ? h('span', { className: 'showwhen-desc' }, desc) : null,
    h(
      'select',
      {
        className: 'showwhen-mode',
        value: props.conditional ? 'conditional' : 'always',
        'aria-label': 'Show when',
        'data-focus-key': `showwhen-mode-${question.id}`,
        onchange: (/** @type {any} */ event) =>
          props.dispatch({
            type: 'question/showwhen-mode-changed',
            questionId: question.id,
            mode:
              event.target.value === 'conditional' ? 'conditional' : 'always',
          }),
      },
      h('option', { value: 'always' }, 'Always'),
      h('option', { value: 'conditional' }, 'Conditional')
    )
  );
  if (!props.conditional) {
    return h('div', { className: 'showwhen-block' }, header);
  }
  return h(
    'div',
    { className: 'showwhen-block' },
    header,
    tree.children.length === 0
      ? EmptyState('// always shown — add a condition to gate this question', {
          tag: 'div',
          className: 'showwhen-empty',
        })
      : null,
    /** @type {HTMLElement} */ (
      ShowwhenGroup({
        question,
        group: tree,
        path: [],
        isRoot: true,
        bankQuestions: props.bankQuestions,
        dispatch: props.dispatch,
      })
    )
  );
}
