// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('../evaluators/section-progress.js').SectionProgress} SectionProgress */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

export class CRSectionProgress extends CRElement {
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
    const rows = this._sections.map(({ section, answered, total }) => {
      const row = document.createElement('div');
      row.className = answered === total && total > 0
        ? 'cr-section-progress-row complete'
        : 'cr-section-progress-row';

      const label = document.createElement('span');
      label.className = 'cr-section-progress-label';
      label.textContent = section;

      const count = document.createElement('span');
      count.className = 'cr-section-progress-count';
      count.textContent = `${answered}/${total}`;

      row.append(label, count);
      row.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('cr-section-jump', {
          detail: { section },
          bubbles: true,
        }));
      });

      return row;
    });

    const jumpBtn = document.createElement('button');
    jumpBtn.className = 'cr-jump-unanswered-btn';
    jumpBtn.textContent = 'Jump to next unanswered';
    jumpBtn.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('cr-jump-unanswered', { bubbles: true }));
    });

    this.replaceChildren(...rows, jumpBtn);
  }
}

customElements.define('cr-section-progress', CRSectionProgress);
