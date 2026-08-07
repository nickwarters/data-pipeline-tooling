// @ts-check
/**
 * What remediation **one** Answer carries — the only remediation question that
 * can be answered from the Answers blob alone, with no applicability graph and
 * no failure rules.
 *
 * It lives in this leaf module because the Responsible Party dashboard
 * (`pages/responsible-party/view.js`) reads it per Answer across Cases of every
 * Case Type, holding no catalogue for any of them.
 * `evaluators/remediation-status.js` re-exports it, so that module remains the
 * one seam callers name.
 *
 * The dashboard is now the *only* reason. The split once also kept the
 * applicability and failure evaluators off `services/section-access.js`'s import
 * graph; that constraint lapsed when the Remediation cells became
 * catalogue-aware and `section-access.js` moved to `remediation-status.js`,
 * which pulls both. The cost was measured and accepted: `failure-evaluator.js`
 * imports nothing and `applicability-evaluator.js` imports only
 * `lib/response-options.js`, so it is three small leaf modules and no cycles —
 * three extra module fetches on a boot path with no bundler, against a gate that
 * is now correct. Do not reinstate the old split on `section-access.js`'s
 * account; it no longer has one.
 *
 * There is deliberately **no** `hasRemediation(answers)` here. "Does this Case
 * carry remediation?" is a catalogue-aware question — remediation on a Question
 * that has left the catalogue is orphaned, not outstanding — and answering it
 * from the blob gave a strict superset of the Remediation tab's rows, which is
 * how a Case could be sent down the actions path carrying work nobody could ever
 * resolve. See `hasTrackableRemediation`.
 */

/** @typedef {import('../sharepoint-client.js').Answer} Answer */

/**
 * The remediation attached to one Answer, or `null` when it carries none.
 * Whitespace-only free-form text does not count as remediation.
 *
 * @param {Answer | undefined} answer
 * @returns {{ actions: Array<{ id: string, text: string }>, freeForm: string } | null}
 */
export function answerRemediation(answer) {
  const actions = (answer?.remediationActions ?? []).map((action) => ({
    id: action.id,
    text: action.text,
  }));
  const freeForm = (answer?.freeFormRemediation ?? '').trim();
  if (actions.length === 0 && freeForm === '') return null;
  return { actions, freeForm };
}
