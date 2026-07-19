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

/** @param {string} value */
function classSuffixFor(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
