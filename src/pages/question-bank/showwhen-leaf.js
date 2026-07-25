// @ts-check
import { h } from '../../lib/html.js';

/**
 * @param {{ question: any, leaf: any, path: number[], bankQuestions: any[], dispatch: (action: any) => void }} props
 */
export function ShowwhenLeaf(props) {
  const { question, leaf, path, dispatch } = props;
  if (!question || !leaf) return undefined;
  const others = props.bankQuestions.filter(
    (candidate) => candidate.id !== question.id
  );
  const change = (/** @type {any} */ patch) =>
    dispatch({
      type: 'question/showwhen-leaf-changed',
      questionId: question.id,
      path,
      patch,
    });
  return h(
    'div',
    { className: 'leaf' },
    h(
      'select',
      {
        'aria-label': 'Condition question',
        onchange: (/** @type {any} */ event) =>
          change({ qId: event.target.value }),
      },
      ...others.map((candidate) =>
        h(
          'option',
          { value: candidate.id, selected: candidate.id === leaf.qId },
          candidate.id + (candidate.deprecated ? ' (deprecated)' : '')
        )
      )
    ),
    h(
      'select',
      {
        className: 'leaf-op',
        'aria-label': 'Condition operator',
        onchange: (/** @type {any} */ event) =>
          change({ op: event.target.value }),
      },
      ...[
        ['equals', '='],
        ['in', 'is one of'],
        ['answered', 'has been answered'],
      ].map(([value, label]) =>
        h('option', { value, selected: value === leaf.op }, label)
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
          onchange: (/** @type {any} */ event) =>
            change({ value: event.target.value }),
        })
      : h(
          'span',
          { className: 'leaf-answered-hint' },
          '— any non-empty answer'
        ),
    h(
      'button',
      {
        className: 'leaf-x',
        'aria-label': 'Remove condition',
        onclick: () =>
          dispatch({
            type: 'question/showwhen-node-removed',
            questionId: question.id,
            path,
          }),
      },
      '×'
    )
  );
}
