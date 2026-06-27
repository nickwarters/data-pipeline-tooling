// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';

/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').OutcomeResult} OutcomeResult */

export class CROutcome extends ReactiveElement {
  constructor() {
    super();
    /** @type {((answers: Record<string, Answer>) => OutcomeResult) | null} */
    this.computeOutcome = null;
    /** @type {Record<string, Answer>} */
    this.answers = {};
    /** @type {boolean} */
    this.allAnswered = false;
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
    const content = this.render();
    if (Array.isArray(content)) {
      this.replaceChildren(...content);
    } else if (
      content &&
      typeof content === 'object' &&
      'appendChild' in content
    ) {
      this.replaceChildren(content);
    } else {
      this.replaceChildren(); // empty
    }
  }

  render() {
    let className, textContent;
    if (!this.allAnswered || !this.computeOutcome) {
      className = 'cr-outcome-indeterminate';
      textContent = 'Awaiting answers…';
    } else {
      const result = this.computeOutcome(this.answers);
      className = `cr-outcome-${classSuffixFor(result.outcome)}`;
      textContent = result.wording ?? defaultWordingFor(result.outcome);
    }

    return [h('h2', {}, 'Outcome'), h('p', { className }, textContent)];
  }
}

customElements.define('cr-outcome', CROutcome);

/** @param {string} value */
function classSuffixFor(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** @param {string} outcome */
function defaultWordingFor(outcome) {
  if (outcome === 'pass') return 'Pass';
  if (outcome === 'refer') return 'Refer';
  if (outcome === 'fail') return 'Fail';
  return outcome;
}
