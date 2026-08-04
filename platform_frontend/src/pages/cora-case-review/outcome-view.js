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
 * @property {string} [displacedOutcome] The verdict this one displaced, when an amendment put a different verdict in force. Display only.
 */

/**
 * Renders the Outcome verdict. Wording is always resolved from the Case Type's
 * configured `outcomeOptions` — there is no built-in Pass/Refer/Fail
 * fallback. A computed outcome with no matching option is surfaced as a
 * "not configured" state so the misconfiguration is visible rather than silently
 * papered over.
 *
 * The verdict an amendment displaced arrives as a prop rather than being read
 * from the Case row: this view stays pure, and the caller already knows which
 * value was displaced.
 *
 * @param {OutcomeProps} props
 * @returns {Node[]}
 */
export function Outcome({
  computeOutcome,
  answers,
  allAnswered,
  outcomeOptions,
  displacedOutcome,
}) {
  /** @type {string | null} */
  let className = null;
  let textContent;
  /** @type {Node | null} */
  let marker = null;
  if (!allAnswered || !computeOutcome) {
    className = 'cora-outcome-indeterminate';
    textContent = 'Awaiting answers…';
  } else {
    const result = computeOutcome(answers);
    const option = outcomeOptions.find((o) => o.id === result.outcome);
    if (option) {
      textContent = option.wording;
      if (displacedOutcome && displacedOutcome !== result.outcome) {
        // Outcome options are Case-Type-editable, so a displaced id can outlive
        // its option; the raw id beats "previously undefined".
        const displacedWording =
          outcomeOptions.find((o) => o.id === displacedOutcome)?.wording ??
          displacedOutcome;
        marker = h(
          'span',
          { className: 'cora-outcome-amended-from' },
          ` (previously ${displacedWording})`
        );
      }
    } else {
      className = 'cora-outcome-indeterminate';
      textContent = 'Outcome not configured';
    }
  }

  return [
    h('h2', {}, 'Outcome'),
    h('p', className ? { className } : {}, textContent, marker),
  ];
}
