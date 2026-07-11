// @ts-check
import { ShellElement } from '../../lib/view.js';
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
 * configured `outcomeOptions` — there is no built-in Pass/Refer/Fail
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

export class CORAOutcome extends ShellElement {
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

  render() {
    return Outcome({
      computeOutcome: this.computeOutcome,
      answers: this.answers,
      allAnswered: this.allAnswered,
      outcomeOptions: this.outcomeOptions,
    });
  }

  /**
   * Replace one or more props and render immediately. Callers typically
   * construct a fresh `cora-outcome` host and call this before it is ever
   * attached to the DOM (see `cora-summary.js`'s Outcome block), so this
   * falls back to `connectedCallback()` when the shell hasn't mounted yet.
   * @param {Partial<OutcomeProps>} props
   */
  update(props) {
    Object.assign(this, props);
    if (this._shellRenderNow) this._shellRenderNow();
    else this.connectedCallback();
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
