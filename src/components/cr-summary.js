// @ts-check
import { CRElement } from './cr-element.js';
import './cr-outcome.js';

/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').OutcomeResult} OutcomeResult */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * The read-only Summary Section (ADR-0016). It rolls the whole Case up onto one
 * page; this tracer-bullet shell renders only the Outcome block. Outcome
 * derivation is hybrid: while the Case is In-progress the verdict is computed
 * live from the current Answers, but once the Case is Completed it reads the
 * frozen `outcomeAtCompletion` snapshot (ADR-0012) rather than recomputing.
 *
 * Summary is never editable — only `read-only` or `hidden` (see section-access).
 */
export class CRSummary extends CRElement {
  constructor() {
    super();
    /** @type {((answers: Record<string, Answer>) => OutcomeResult) | null} */
    this.computeOutcome = null;
    /** @type {Record<string, Answer>} */
    this.answers = {};
    /** @type {boolean} */
    this.allAnswered = false;
    /** @type {CaseRow | null} */
    this.caseRow = null;
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
    heading.textContent = 'Summary';

    const outcomeEl = /** @type {import('./cr-outcome.js').CROutcome} */ (
      document.createElement('cr-outcome')
    );

    const frozen = this.caseRow?.status === 'Completed' ? this.caseRow.outcomeAtCompletion : null;
    if (frozen) {
      // Read the frozen snapshot for a Completed Case (ADR-0012): the verdict is
      // whatever the system concluded at completion, not a recomputation.
      /** @type {OutcomeResult} */
      const result = { verdict: /** @type {OutcomeResult['verdict']} */ (frozen) };
      outcomeEl.update(() => result, {}, true);
    } else if (this.computeOutcome) {
      // Live derivation from the current Answers while In-progress (ADR-0016).
      outcomeEl.update(this.computeOutcome, this.answers, this.allAnswered);
    } else {
      // Nothing to derive yet — render the Outcome block in its indeterminate
      // state until update() supplies the live state.
      outcomeEl.update(() => /** @type {OutcomeResult} */ ({ verdict: 'pass' }), {}, false);
    }

    this.replaceChildren(
      /** @type {any} */ (heading),
      /** @type {any} */ (outcomeEl)
    );
  }
}

customElements.define('cr-summary', CRSummary);
