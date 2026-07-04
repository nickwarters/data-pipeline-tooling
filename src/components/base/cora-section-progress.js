// @ts-check
import { h } from '../../lib/html.js';

/** @typedef {import('../../evaluators/section-progress.js').SectionProgress} SectionProgress */
/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/**
 * @typedef {Object} SectionProgressProps
 * @property {SectionProgress[]} sections
 * @property {QuestionDefinition[]} unansweredQuestions
 * @property {(section: string) => void} onSectionJump
 * @property {() => void} onJumpUnanswered
 */

/**
 * @param {SectionProgressProps} props
 * @returns {Node[]}
 */
export function SectionProgress({ sections, onSectionJump, onJumpUnanswered }) {
  const rows = sections.map(({ section, answered, total }) => {
    const className =
      answered === total && total > 0
        ? 'cora-section-progress-row complete'
        : 'cora-section-progress-row';

    return h(
      'div',
      {
        className,
        onclick: () => onSectionJump(section),
      },
      h('span', { className: 'cora-section-progress-label' }, section),
      h(
        'span',
        { className: 'cora-section-progress-count' },
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

export class CORASectionProgress extends HTMLElement {
  constructor() {
    super();
    /** @type {SectionProgress[]} */
    this._sections = [];
    /** @type {QuestionDefinition[]} */
    this._unansweredQuestions = [];
  }

  /**
   * @param {SectionProgress[]} sections
   * @param {QuestionDefinition[]} unansweredQuestions - applicable questions without an answer, in order
   */
  update(sections, unansweredQuestions) {
    this._sections = sections;
    this._unansweredQuestions = unansweredQuestions;
    this._render();
  }

  _render() {
    this.replaceChildren(
      ...SectionProgress({
        sections: this._sections,
        unansweredQuestions: this._unansweredQuestions,
        onSectionJump: (section) => {
          this.dispatchEvent(
            new CustomEvent('cora-section-jump', {
              detail: { section },
              bubbles: true,
            })
          );
        },
        onJumpUnanswered: () => {
          this.dispatchEvent(
            new CustomEvent('cora-jump-unanswered', { bubbles: true })
          );
        },
      })
    );
  }
}

customElements.define('cora-section-progress', CORASectionProgress);
