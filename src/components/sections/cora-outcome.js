// @ts-check
import { h } from '../../lib/html.js';

/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').OutcomeResult} OutcomeResult */
/** @typedef {import('../../sharepoint-client.js').OutcomeOption} OutcomeOption */

/**
 * @typedef {Object} OutcomeProps
 * @property {((answers: Record<string, Answer>) => OutcomeResult) | null} computeOutcome
 * @property {Record<string, Answer>} answers
 * @property {boolean} allAnswered
 * @property {OutcomeOption[]} outcomeOptions
 */

/**
 * Renders the Outcome verdict. Wording is always resolved from the Case Type's
 * configured `outcomeOptions` (ADR-0004) — there is no built-in Pass/Refer/Fail
 * fallback. A computed outcome with no matching option is surfaced as a
 * "not configured" state so the misconfiguration is visible rather than silently
 * papered over.
 *
 * @param {OutcomeProps} props
 * @returns {Node[]}
 */
export function Outcome({
  computeOutcome,
  answers,
  allAnswered,
  outcomeOptions,
}) {
  let className, textContent;
  if (!allAnswered || !computeOutcome) {
    className = 'cora-outcome-indeterminate';
    textContent = 'Awaiting answers…';
  } else {
    const result = computeOutcome(answers);
    const option = outcomeOptions.find((o) => o.id === result.outcome);
    if (option) {
      className = `cora-outcome-${classSuffixFor(result.outcome)}`;
      textContent = option.wording;
    } else {
      className = 'cora-outcome-indeterminate';
      textContent = 'Outcome not configured';
    }
  }

  return [h('h2', {}, 'Outcome'), h('p', { className }, textContent)];
}

export class CORAOutcome extends HTMLElement {
  constructor() {
    super();
    /** @type {((answers: Record<string, Answer>) => OutcomeResult) | null} */
    this.computeOutcome = null;
    /** @type {Record<string, Answer>} */
    this.answers = {};
    /** @type {boolean} */
    this.allAnswered = false;
    /** @type {OutcomeOption[]} */
    this.outcomeOptions = [];
  }

  connectedCallback() {
    this._render();
  }

  /**
   * @param {(answers: Record<string, Answer>) => OutcomeResult} computeOutcome
   * @param {Record<string, Answer>} answers
   * @param {boolean} allAnswered
   * @param {OutcomeOption[]} [outcomeOptions]
   */
  update(computeOutcome, answers, allAnswered, outcomeOptions = []) {
    this.computeOutcome = computeOutcome;
    this.answers = answers;
    this.allAnswered = allAnswered;
    this.outcomeOptions = outcomeOptions;
    this._render();
  }

  _render() {
    this.replaceChildren(
      ...Outcome({
        computeOutcome: this.computeOutcome,
        answers: this.answers,
        allAnswered: this.allAnswered,
        outcomeOptions: this.outcomeOptions,
      })
    );
  }
}

customElements.define('cora-outcome', CORAOutcome);

/** @param {string} value */
function classSuffixFor(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
