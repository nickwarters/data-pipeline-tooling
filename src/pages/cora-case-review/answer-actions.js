// @ts-check
// The Case Review page's Answer mutations, as pure functions.
//
// Each one takes the current Answers plus the guard the mutation is subject to,
// and returns the next Answers or `null`. `null` means "write nothing" — the
// guard refused, the Answer does not exist, or the edit changes nothing. The
// route sends every non-null result through the single Answer effect, so the
// store and the SaveQueue cannot fall out of step (#510).

import { evaluate } from '../../evaluators/applicability-evaluator.js';
import { materializeRemediationActions } from '../../evaluators/failure-evaluator.js';
import {
  captureValue,
  findCaptureField,
} from '../../evaluators/issue-capture.js';
import {
  answerRemediation,
  setRemediationStatus,
} from '../../evaluators/remediation-status.js';

/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {Record<string, Answer>} Answers */

/**
 * Record a response to one Question Definition or General Question.
 *
 * An answer key outside the catalogue (the `general:` namespace) is carried
 * through untouched: applicability governs Question Definitions only.
 *
 * @param {{
 *   answers: Answers,
 *   catalogue: QuestionDefinition[],
 *   questionId: string,
 *   value: string | string[],
 *   canEdit: boolean,
 * }} input
 * @returns {Answers | null}
 */
export function answerEdited({
  answers,
  catalogue,
  questionId,
  value,
  canEdit,
}) {
  if (!canEdit) return null;
  const byId = new Map(catalogue.map((q) => [q.id, q]));
  const question = byId.get(questionId);
  const base = { ...answers[questionId], value };
  const draft = {
    ...answers,
    [questionId]: question
      ? materializeRemediationActions(question, base)
      : base,
  };

  // Drop Answers to Question Definitions this edit made inapplicable.
  const stillApplicable = evaluate(catalogue, draft);
  /** @type {Answers} */
  const next = {};
  for (const [id, answer] of Object.entries(draft)) {
    if (!byId.has(id) || stillApplicable.has(id)) next[id] = answer;
  }
  return next;
}

/**
 * Capture one configured Issue Capture field on an existing Answer.
 *
 * No scroll workaround here (unlike the remediation-action edits): the Issues
 * list patches changed items in place on a capture change, so the control being
 * edited is never detached and focus/scroll survive natively (#308).
 *
 * @param {{
 *   answers: Answers,
 *   captureGroups: import('../../sharepoint-client.js').CaptureGroup[],
 *   questionId: string,
 *   fieldKey: string,
 *   value: string,
 *   canCapture: boolean,
 * }} input
 * @returns {Answers | null}
 */
export function issueCaptured({
  answers,
  captureGroups,
  questionId,
  fieldKey,
  value,
  canCapture,
}) {
  if (!canCapture) return null;
  const existing = answers[questionId];
  if (!existing) return null;
  const field = findCaptureField(captureGroups, fieldKey);
  if (!field) return null;
  return { ...answers, [questionId]: captureValue(existing, field, value) };
}

/**
 * Attribute a failed Answer to a Responsible Party, or clear the attribution.
 *
 * @param {{
 *   answers: Answers,
 *   questionId: string,
 *   attributedParty: { loginName: string, displayName: string } | null,
 *   canAttribute: boolean,
 * }} input
 * @returns {Answers | null}
 */
export function failureAttributed({
  answers,
  questionId,
  attributedParty,
  canAttribute,
}) {
  if (!canAttribute) return null;
  const existing = answers[questionId];
  if (!existing) return null;
  let next;
  if (attributedParty) {
    next = { ...existing, attributedParty };
  } else {
    const { attributedParty: _drop, ...rest } = existing;
    next = rest;
  }
  return { ...answers, [questionId]: next };
}

/**
 * Tick/untick a configured Remediation Action on a failed Answer. Selection is
 * stored as the reviewer-chosen subset on `answer.remediationActions`; only
 * these feed the per-action outcome scoring in `computeConfiguredOutcome`.
 *
 * @param {{
 *   answers: Answers,
 *   questionId: string,
 *   action: { id: string, text: string },
 *   selected: boolean,
 *   canSelectRemediation: boolean,
 * }} input
 * @returns {Answers | null}
 */
export function remediationActionToggled({
  answers,
  questionId,
  action,
  selected,
  canSelectRemediation,
}) {
  if (!canSelectRemediation) return null;
  const existing = answers[questionId];
  if (!existing) return null;

  const list = existing.remediationActions ?? [];
  let nextList;
  if (selected) {
    if (list.some((a) => a.id === action.id)) return null;
    nextList = [
      ...list,
      { id: action.id, text: action.text, completed: false },
    ];
  } else {
    if (!list.some((a) => a.id === action.id)) return null;
    nextList = list.filter((a) => a.id !== action.id);
  }

  let next;
  if (nextList.length) {
    next = { ...existing, remediationActions: nextList };
  } else {
    const { remediationActions: _drop, ...rest } = existing;
    next = rest;
  }
  return { ...answers, [questionId]: next };
}

/**
 * Capture a reviewer's free-form Remediation text on a failed Answer (#250),
 * stored as `answer.freeFormRemediation`. An empty value clears the field.
 *
 * @param {{
 *   answers: Answers,
 *   questionId: string,
 *   value: string,
 *   canSelectRemediation: boolean,
 * }} input
 * @returns {Answers | null}
 */
export function remediationFreeFormEdited({
  answers,
  questionId,
  value,
  canSelectRemediation,
}) {
  if (!canSelectRemediation) return null;
  const existing = answers[questionId];
  if (!existing) return null;

  let next;
  if (value) {
    next = { ...existing, freeFormRemediation: value };
  } else {
    const { freeFormRemediation: _drop, ...rest } = existing;
    next = rest;
  }
  return { ...answers, [questionId]: next };
}

/**
 * Record how one Question's remediation was resolved, from the Remediation tab
 * (#499): `complete`, or `partial` / `cancelled` with the details or
 * justification that resolution requires. An unknown Question, or one carrying
 * no remediation, is ignored.
 *
 * Incomplete text is stored rather than rejected — the Reviewer picks the
 * status first and types afterwards — and the *completion gate*
 * (`readyToClose`) is what refuses to close a Case whose rows are unresolved.
 *
 * @param {{
 *   answers: Answers,
 *   questionId: string,
 *   status: import('../../sharepoint-client.js').RemediationStatusValue | '',
 *   details?: string,
 *   canResolve: boolean,
 * }} input
 * @returns {Answers | null}
 */
export function remediationResolved({
  answers,
  questionId,
  status,
  details = '',
  canResolve,
}) {
  if (!canResolve) return null;
  const existing = answers[questionId];
  if (!existing) return null;
  // Only a Question carrying remediation is a row on the tab, so only one can
  // be resolved: this keeps the write path in step with what the view derives.
  if (answerRemediation(existing) === null) return null;
  const next = setRemediationStatus(existing, status, details);
  if (next === existing) return null;
  return { ...answers, [questionId]: next };
}
