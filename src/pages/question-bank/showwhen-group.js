// @ts-check
import { h } from '../../lib/html.js';
import { ShowwhenLeaf } from './showwhen-leaf.js';

/**
 * @param {{ question: any, group: any, path: number[], isRoot?: boolean, bankQuestions: any[], dispatch: (action: any) => void }} props
 */
export function ShowwhenGroup(props) {
  const { question, group, path, bankQuestions, dispatch } = props;
  if (!question || !group) return undefined;
  const others = bankQuestions.filter(
    (candidate) => candidate.id !== question.id
  );
  /** @type {HTMLElement[]} */
  const children = [];
  group.children.forEach(
    (/** @type {any} */ child, /** @type {number} */ index) => {
      if (index) {
        children.push(
          h(
            'div',
            { class: 'conjunction' },
            h('span', { class: 'glyph' }, group.op === 'and' ? 'AND' : 'OR')
          )
        );
      }
      const childPath = [...path, index];
      children.push(
        /** @type {HTMLElement} */ (
          child.type === 'leaf'
            ? ShowwhenLeaf({
                question,
                leaf: child,
                path: childPath,
                bankQuestions,
                dispatch,
              })
            : ShowwhenGroup({
                question,
                group: child,
                path: childPath,
                bankQuestions,
                dispatch,
              })
        )
      );
    }
  );

  return h(
    'div',
    { class: `group op-${group.op}` },
    h(
      'div',
      { class: 'group-head' },
      h(
        'button',
        {
          class: `op-toggle op-${group.op}`,
          title: 'Click to switch between AND / OR',
          onClick: () =>
            dispatch({
              type: 'question/showwhen-group-toggled',
              questionId: question.id,
              path,
            }),
        },
        h('span', { class: 'label' }, group.op === 'and' ? 'ALL OF' : 'ANY OF'),
        h('span', { class: 'arrow' }, '⇅'),
        h(
          'span',
          { class: 'qual' },
          group.op === 'and'
            ? '(every condition must hold)'
            : '(at least one must hold)'
        )
      ),
      h(
        'div',
        { class: 'group-actions' },
        h(
          'button',
          {
            class: 'mini-btn',
            onClick: () => {
              const target = others[0]?.id;
              if (!target) {
                /** @type {any} */ (globalThis).alert?.(
                  'Add at least one other question first.'
                );
                return;
              }
              dispatch({
                type: 'question/showwhen-condition-added',
                questionId: question.id,
                path,
                target,
              });
            },
          },
          '+ condition'
        ),
        h(
          'button',
          {
            class: 'mini-btn',
            onClick: () =>
              dispatch({
                type: 'question/showwhen-group-added',
                questionId: question.id,
                path,
              }),
          },
          '+ ' + (group.op === 'and' ? 'OR group' : 'AND group')
        ),
        !props.isRoot
          ? h(
              'button',
              {
                class: 'mini-btn danger',
                title: 'Remove this group',
                onClick: () =>
                  dispatch({
                    type: 'question/showwhen-node-removed',
                    questionId: question.id,
                    path,
                  }),
              },
              '× group'
            )
          : null
      )
    ),
    h('div', { class: 'group-children' }, ...children)
  );
}
