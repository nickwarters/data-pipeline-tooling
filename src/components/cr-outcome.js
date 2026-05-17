// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').OutcomeResult} OutcomeResult */

export class CROutcome extends CRElement {
  constructor() {
    super();
    /** @type {((answers: Record<string, Answer>) => OutcomeResult) | null} */
    this.computeOutcome = null;
    /** @type {Record<string, Answer>} */
    this.answers = {};
    /** @type {boolean} */
    this.allAnswered = false;
  }

  connectedCallback() {
    this._render();
  }

  /**
   * @param {(answers: Record<string, Answer>) => OutcomeResult} computeOutcome
   * @param {Record<string, Answer>} answers
   * @param {boolean} allAnswered
   */
  update(computeOutcome, answers, allAnswered) {
    this.computeOutcome = computeOutcome;
    this.answers = answers;
    this.allAnswered = allAnswered;
    this._render();
  }

  _render() {
    const heading = document.createElement('h2');
    heading.textContent = 'Outcome';

    const verdict = document.createElement('p');

    if (!this.allAnswered || !this.computeOutcome) {
      verdict.className = 'cr-outcome-indeterminate';
      verdict.textContent = 'Awaiting answers…';
    } else {
      const result = this.computeOutcome(this.answers);
      if (result.verdict === 'pass') {
        verdict.className = 'cr-outcome-pass';
        verdict.textContent = 'Pass';
      } else {
        verdict.className = 'cr-outcome-fail';
        verdict.textContent = 'Fail';
      }
    }

    this.replaceChildren(heading, verdict);
  }
}

customElements.define('cr-outcome', CROutcome);
