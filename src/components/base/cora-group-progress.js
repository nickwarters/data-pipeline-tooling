// @ts-check
import { h } from '../../lib/html.js';

/** @typedef {import('../../evaluators/question-group-progress.js').QuestionGroupProgress} QuestionGroupProgress */
/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/**
 * @typedef {Object} GroupProgressProps
 * @property {QuestionGroupProgress[]} groups
 * @property {QuestionDefinition[]} unansweredQuestions
 * @property {(group: string) => void} onGroupJump
 * @property {() => void} onJumpUnanswered
 */

/**
 * Per-Question-Group answered/total progress strip. (Renamed from
 * `cora-section-progress` — "section" is reserved for the role-gated tab
 * areas, see #390.)
 *
 * @param {GroupProgressProps} props
 * @returns {Node[]}
 */
export function GroupProgress({ groups, onGroupJump, onJumpUnanswered }) {
  const rows = groups.map(({ group, answered, total }) => {
    const className =
      answered === total && total > 0
        ? 'cora-group-progress-row complete'
        : 'cora-group-progress-row';

    return h(
      'div',
      {
        className,
        onclick: () => onGroupJump(group),
      },
      h('span', { className: 'cora-group-progress-label' }, group),
      h(
        'span',
        { className: 'cora-group-progress-count' },
        `${answered}/${total}`
      )
    );
  });

  const jumpBtn = h(
    'button',
    {
      className: 'cora-jump-unanswered-btn',
      onclick: onJumpUnanswered,
    },
    'Jump to next unanswered'
  );

  return [...rows, jumpBtn];
}
