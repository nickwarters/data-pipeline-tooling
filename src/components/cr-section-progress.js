// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';

/** @typedef {import('../evaluators/section-progress.js').SectionProgress} SectionProgress */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

export class CRSectionProgress extends ReactiveElement {
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
    this.replaceChildren(...this.render());
  }

  render() {
    const rows = this._sections.map(({ section, answered, total }) => {
      const className = answered === total && total > 0
        ? 'cr-section-progress-row complete'
        : 'cr-section-progress-row';

      return h('div', {
        className,
        onclick: () => {
          this.dispatchEvent(new CustomEvent('cr-section-jump', {
            detail: { section },
            bubbles: true,
          }));
        }
      },
        h('span', { className: 'cr-section-progress-label' }, section),
        h('span', { className: 'cr-section-progress-count' }, `${answered}/${total}`)
      );
    });

    const jumpBtn = h('button', {
      className: 'cr-jump-unanswered-btn',
      onclick: () => {
        this.dispatchEvent(new CustomEvent('cr-jump-unanswered', { bubbles: true }));
      }
    }, 'Jump to next unanswered');

    return [...rows, jumpBtn];
  }
}

customElements.define('cr-section-progress', CRSectionProgress);
