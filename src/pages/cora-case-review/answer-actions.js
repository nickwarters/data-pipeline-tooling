// @ts-check
// The Case Review page's Answer mutations, as pure functions.
//
// Each one takes the current Answers plus the guard the mutation is subject to,
// and returns the next Answers or `null`. `null` means "write nothing" — the
// guard refused, the Answer does not exist, or the edit changes nothing. The
// route sends every non-null result through the single Answer effect, so the
// store and the SaveQueue cannot fall out of step.

import { evaluate } from '../../evaluators/applicability-evaluator.js';
import { materializeRemediationActions } from '../../evaluators/failure-evaluator.js';
import { groupOutcomeTargets } from './group-outcome-view.js';
import { reviewerResponseOptions } from '../../lib/response-options.js';
import { applyCapture } from '../../evaluators/issue-capture.js';
import {
  answerRemediation,
  setRemediationStatus,
} from '../../evaluators/remediation-status.js';

/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {Record<string, Answer>} Answers */

/**
 * Apply one or more response writes to the Answers and settle applicability
 * once over the finished draft.
 *
 * Every write of a *response value* goes through here, so recording several
 * responses at once is the same operation as recording them one at a time —
 * a bulk path cannot acquire its own materialisation or pruning rules. The
 * other mutations here deliberately do not: they edit the remediation and
 * capture fields of an Answer whose response is unchanged, so re-evaluating
 * applicability over them would be pruning in response to nothing.
 * The prune is a single pass, not iterated to a fixpoint: an Answer whose
 * Question the same write made inapplicable is dropped, and a Question the
 * drop in turn reveals settles on the next render, exactly as a single edit
 * has always behaved.
 *
 * An answer key outside the catalogue (the `general:` namespace) is carried
 * through untouched: applicability governs Question Definitions only.
 *
 * @param {Answers} answers
 * @param {QuestionDefinition[]} catalogue
 * @param {Array<[string, string | string[]]>} writes
 * @returns {Answers}
 */
function writeAnswers(answers, catalogue, writes) {
  const byId = new Map(catalogue.map((q) => [q.id, q]));
  /** @type {Answers} */
  const draft = { ...answers };
  for (const [questionId, value] of writes) {
    const question = byId.get(questionId);
    const base = { ...answers[questionId], value };
    draft[questionId] = question
      ? materializeRemediationActions(question, base)
      : base;
  }

  // Drop Answers to Question Definitions this write made inapplicable.
  const stillApplicable = evaluate(catalogue, draft);
  /** @type {Answers} */
  const next = {};
  for (const [id, answer] of Object.entries(draft)) {
    if (!byId.has(id) || stillApplicable.has(id)) next[id] = answer;
  }
  return next;
}

/**
 * Record a response to one Question Definition or General Question.
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
  return writeAnswers(answers, catalogue, [[questionId, value]]);
}

/**
 * Record one **Group Outcome**: the same Outcome wording (or N/A) on every
 * Question Definition in a Question Group the Reviewer could have set it on
 * one at a time.
 *
 * The target set is frozen against the Answers as they arrive — applicability
 * is evaluated once, before anything is written — so a Question the write
 * itself reveals is left for the Reviewer to answer, and a Question it hides
 * is pruned by the shared write path. Nothing group-level is stored: a
 * Group Outcome is a shortcut for N ordinary Answer writes and leaves each of them
 * individually editable.
 *
 * The wording is validated against each target Question rather than against
 * the Case Type's Outcome vocabulary, because those two can legitimately
 * disagree: a reportable Case reads a catalogue frozen into its versioned
 * export while the live config moves on. The Question the Answer is written to
 * is the only authority on what that Answer may say.
 *
 * @param {{
 *   answers: Answers,
 *   catalogue: QuestionDefinition[],
 *   questionGroup: string,
 *   value: string,
 *   canEdit: boolean,
 * }} input
 * @returns {Answers | null}
 */
export function groupOutcomeSet({
  answers,
  catalogue,
  questionGroup,
  value,
  canEdit,
}) {
  if (!canEdit) return null;
  const applicable = evaluate(catalogue, answers);
  const targets = groupOutcomeTargets(catalogue, questionGroup).filter(
    (question) =>
      applicable.has(question.id) &&
      reviewerResponseOptions(question).includes(value)
  );
  if (!targets.length) return null;
  return writeAnswers(
    answers,
    catalogue,
    targets.map(
      (question) => /** @type {[string, string]} */ ([question.id, value])
    )
  );
}

/**
 * Capture one configured Issue Capture field on an existing Answer.
 *
 * No scroll workaround here (unlike the remediation-action edits): the Issues
 * list patches changed items in place on a capture change, so the control being
 * edited is never detached and focus/scroll survive natively.
 *
 * @param {{
 *   answers: Answers,
 *   captureGroups: import('../../sharepoint-client.js').CaptureGroup[],
 *   questionId: string,
 *   fieldKey: string,
 *   value: import('../../evaluators/issue-capture.js').CaptureValue | null,
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
  // Not a bare value write: a capture value can hide a sibling field, and the
  // sibling's stored value goes with it in the same write.
  const next = applyCapture(existing, captureGroups, fieldKey, value);
  if (!next) return null;
  return { ...answers, [questionId]: next };
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
    nextList = [...list, { id: action.id, text: action.text }];
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
 * Capture a reviewer's free-form Remediation text on a failed Answer,
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
 * Record the Reviewer's **Remediation Required** decision on a failed Answer.
 *
 * The decision comes first and the remediation follows, so `'no'` drops both
 * the ticked actions and the free-form text the Reviewer may have entered
 * before changing their mind. There is one definition of "this Case carries
 * remediation" and it reads the Answer: an action persisted under a control the
 * Reviewer can no longer see would show up in reporting as remediation nobody
 * intends to do, and would send the Case down the actions path to resolve it.
 *
 * There is no path back to *undecided*: a radio pair cannot be un-selected, so
 * `required` is `'yes'` or `'no'` and absence only ever means "not yet
 * answered". Re-selecting the current decision writes nothing.
 *
 * @param {{
 *   answers: Answers,
 *   questionId: string,
 *   required: 'yes' | 'no',
 *   canSelectRemediation: boolean,
 * }} input
 * @returns {Answers | null}
 */
export function remediationRequiredSet({
  answers,
  questionId,
  required,
  canSelectRemediation,
}) {
  if (!canSelectRemediation) return null;
  const existing = answers[questionId];
  if (!existing) return null;
  if (existing.remediationRequired === required) return null;

  let next;
  if (required === 'no') {
    const {
      remediationActions: _dropActions,
      freeFormRemediation: _dropFree,
      ...rest
    } = existing;
    next = { ...rest, remediationRequired: required };
  } else {
    next = { ...existing, remediationRequired: required };
  }
  return { ...answers, [questionId]: next };
}

/**
 * Record how one Question's remediation was resolved, from the Remediation tab:
 * `complete`, or `partial` / `cancelled` with the details or justification that
 * resolution requires. An unknown Question, or one carrying no remediation, is
 * ignored.
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
