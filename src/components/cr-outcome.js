// @ts-check
import { h } from '../lib/html.js';

/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').OutcomeResult} OutcomeResult */

/**
 * @typedef {Object} OutcomeProps
 * @property {((answers: Record<string, Answer>) => OutcomeResult) | null} computeOutcome
 * @property {Record<string, Answer>} answers
 * @property {boolean} allAnswered
 */

/**
 * @param {OutcomeProps} props
 * @returns {Node[]}
 */
export function Outcome({ computeOutcome, answers, allAnswered }) {
  let className, textContent;
  if (!allAnswered || !computeOutcome) {
    className = 'cr-outcome-indeterminate';
    textContent = 'Awaiting answers…';
  } else {
    const result = computeOutcome(answers);
    className = `cr-outcome-${classSuffixFor(result.outcome)}`;
    textContent = result.wording ?? defaultWordingFor(result.outcome);
  }

  return [h('h2', {}, 'Outcome'), h('p', { className }, textContent)];
}

export class CROutcome extends HTMLElement {
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
    this.replaceChildren(
      ...Outcome({
        computeOutcome: this.computeOutcome,
        answers: this.answers,
        allAnswered: this.allAnswered,
      })
    );
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
