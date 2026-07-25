// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { normaliseConfiguredActions } from '../../evaluators/configured-outcome.js';

/** @param {any} question */
export function nextRemediationActionId(question) {
  const ids = new Set(
    normaliseConfiguredActions(
      question.remediationActions ?? [],
      question.id
    ).map((action) => action.id)
  );
  let index = ids.size;
  let id = `${question.id}-ra-${index}`;
  while (ids.has(id)) id = `${question.id}-ra-${++index}`;
  return id;
}

/**
 * Pure Remediation Action editor.
 * @param {{ question: any, dispatch: (action: any) => void }} props
 */
export function RemediationActionsEditor({ question, dispatch }) {
  if (!question) return undefined;
  const actions = normaliseConfiguredActions(
    question.remediationActions ?? [],
    question.id
  );
  const freeForm = Boolean(question.allowFreeFormRemediation);
  const wrap = h(
    'div',
    { className: 'rem-block' },
    h(
      'h4',
      {},
      'Remediation Actions ',
      h(
        'span',
        { className: 'rem-count' },
        `(${actions.length}${freeForm ? ' + free-form' : ''})`
      )
    ),
    h(
      'div',
      { className: 'rem-free-row' },
      h(
        'div',
        {},
        h(
          'div',
          { className: 'rem-free-title' },
          'Allow free-form remediation'
        ),
        h(
          'div',
          { className: 'rem-free-help' },
          'Reviewers can write their own remediation alongside any canned actions.'
        )
      ),
      h('button', {
        className: 'toggle' + (freeForm ? ' on' : ''),
        role: 'switch',
        'aria-checked': String(freeForm),
        'aria-label': 'Allow free-form remediation',
        onclick: () =>
          dispatch({
            type: 'question/free-form-remediation-toggled',
            questionId: question.id,
          }),
      })
    )
  );

  if (freeForm) {
    wrap.appendChild(
      h(
        'div',
        { className: 'rem-free-preview' },
        h(
          'div',
          { className: 'rem-free-preview-eyebrow' },
          'Reviewer will see'
        ),
        h(
          'div',
          { className: 'rem-free-preview-body' },
          '"Describe a remediation in your own words…"'
        )
      )
    );
  }

  actions.forEach((action, index) => {
    wrap.appendChild(
      h(
        'div',
        { className: 'rem-item' },
        h('input', {
          value: action.text,
          'aria-label': `Remediation action ${index + 1}`,
          onchange: (/** @type {any} */ event) =>
            dispatch({
              type: 'question/remediation-action-changed',
              questionId: question.id,
              index,
              text: event.target.value,
            }),
        }),
        h(
          'button',
          {
            className: 'x',
            'aria-label': `Remove remediation action ${index + 1}`,
            onclick: () =>
              dispatch({
                type: 'question/remediation-action-removed',
                questionId: question.id,
                index,
              }),
          },
          '×'
        )
      )
    );
  });

  if (!actions.length && !freeForm) {
    wrap.appendChild(
      EmptyState('// no remediations — reviewers will see none on failure', {
        tag: 'div',
        className: 'rem-empty',
      })
    );
  }
  wrap.appendChild(
    h(
      'button',
      {
        className: 'tag-add rem-add',
        onclick: () =>
          dispatch({
            type: 'question/remediation-action-added',
            questionId: question.id,
            action: {
              id: nextRemediationActionId(question),
              text: 'New action',
            },
          }),
      },
      '+ canned action'
    )
  );
  return wrap;
}
