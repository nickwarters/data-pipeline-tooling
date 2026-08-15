// @ts-check
import { h } from '../../lib/html.js';
import { Outcome } from './outcome-view.js';
import { caseDetailFields } from './details-view.js';
import { buildSummaryModel } from '../../evaluators/summary-model.js';
import {
  REMEDIATION_DETAIL_LABELS,
  REMEDIATION_STATUS_LABELS,
  remediationRows,
} from '../../evaluators/remediation-status.js';
import { reachedReportable } from '../../services/section-access.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';
import { currentOutcome } from '../../evaluators/amended-outcome.js';
import { DEFAULT_SECTION_LABELS } from '../../lib/section-labels.js';
import { CaptureGroups } from '../../components/sections/cora-capture-groups.js';
import { generalAnswerKey } from '../../evaluators/general-questions.js';
import { GENERAL_QUESTIONS_TITLE } from './general-questions-view.js';
import { COPY as REMEDIATION_COPY } from './remediation-tracking-view.js';

/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').OutcomeResult} OutcomeResult */
/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../../services/section-access.js').Section} Section */

/**
 * @typedef {Object} SummaryProps
 * @property {((answers: Record<string, Answer>) => OutcomeResult) | null} computeOutcome
 * @property {Record<string, Answer>} answers
 * @property {boolean} allAnswered
 * @property {CaseRow | null} caseRow
 * @property {QuestionDefinition[]} catalogue
 * @property {Section[]} summarySections
 * @property {import('../../sharepoint-client.js').CaptureGroup[]} captureGroups
 * @property {import('../../sharepoint-client.js').CaseDetailField[]} detailFields
 * @property {import('../../sharepoint-client.js').OutcomeOption[]} outcomeOptions
 * @property {import('../../sharepoint-client.js').ResolvedSectionLabels} [sectionLabels] Resolved section display copy; defaults to the standard copy so the component stays usable standalone.
 * @property {import('../../sharepoint-client.js').GeneralQuestionField[]} [generalQuestions] The Case Type's General Questions, rolled up read-only. Display only — they reach no evaluator here either.
 * @property {import('../../evaluators/general-questions.js').GeneralQuestionsPlacement} [generalQuestionsPlacement] Which side of the configured Summary blocks the roll-up sits on. Already resolved by the caller via `resolveGeneralQuestionsPlacement()` — this view never sees the raw config value, so it cannot disagree with the Review tab. 'after' when absent, so the view stays usable standalone.
 * @property {'reviewer' | 'responsibleParty'} [audience] Which side is reading, from `remediationAudience()` — the same value the Remediation tab gets. It selects one thing only: whether the remediation roll-up shows each resolution's details / justification. Absent means `responsibleParty`, the narrower rendering, so a caller that does not say fails closed.
 */

/**
 * @param {SummaryProps} props
 * @returns {Node[]}
 */
export function summaryView(props) {
  const heading = h('h2', {}, labelsOf(props).summary.heading);

  // The Outcome snapshot is stamped at the reportable milestone, so
  // read the frozen value from reportable on — not only once Completed. Once
  // reportable, the block shows the **Current Outcome**: the case-level
  // Amended Outcome when Controls has amended it, otherwise the frozen snapshot.
  //
  // A voided Case that never got there is the third case: voiding stamps no
  // Outcome, so computing one live would put a result on a Case that was
  // deliberately never concluded. It shows no Outcome block at all.
  const frozen = props.caseRow ? reachedReportable(props.caseRow) : false;
  const current =
    frozen && props.caseRow ? currentOutcome(props.caseRow) : undefined;
  const neverConcluded = !frozen && props.caseRow?.status === CASE_STATUS.VOID;
  // The Amended Outcome record is the fact that an amendment happened; the
  // reporting columns are only a projection of it. When one exists, the frozen
  // snapshot is the value it displaced, and the Outcome block is told explicitly
  // so it stays a pure view with no Case-row dependency of its own.
  const displacedOutcome = props.caseRow?.amendedOutcome
    ? props.caseRow.outcomeAtCompletion
    : undefined;
  /** @type {Node[]} */
  const children = [heading];
  if (!neverConcluded) {
    const outcomeNodes = current
      ? Outcome({
          computeOutcome: () => ({ outcome: current }),
          answers: {},
          allAnswered: true,
          outcomeOptions: props.outcomeOptions,
          displacedOutcome,
        })
      : Outcome({
          computeOutcome: props.computeOutcome,
          answers: props.answers,
          allAnswered: props.allAnswered,
          outcomeOptions: props.outcomeOptions,
        });
    // A CSS hook for the `.cora-summary > .cora-outcome` contract, nothing more.
    // See the note at the top of section-panels.js for why it is a class rather
    // than a `cora-outcome` element.
    children.push(h('div', { className: 'cora-outcome' }, outcomeNodes));
  }

  if (props.caseRow) {
    children.push(renderKeyDates(props.caseRow));
    const general = renderGeneralQuestions(props);
    const before = props.generalQuestionsPlacement === 'before';
    if (general && before) children.push(general);
    for (const section of props.summarySections) {
      const block = renderSectionBlock(props, section, props.caseRow);
      if (block) children.push(block);
    }
    if (general && !before) children.push(general);
  }

  return children;
}

/**
 * The effective section display copy for a render: the resolved map threaded by
 * the page, or the defaults when the component is used standalone.
 * @param {SummaryProps} props
 * @returns {import('../../sharepoint-client.js').ResolvedSectionLabels}
 */
function labelsOf(props) {
  return props.sectionLabels ?? DEFAULT_SECTION_LABELS;
}

/**
 * @param {SummaryProps} props
 * @param {Section} section
 * @param {CaseRow} caseRow
 * @returns {HTMLElement | null}
 */
function renderSectionBlock(props, section, caseRow) {
  if (section === 'details') {
    return renderFieldBlock(
      'cora-summary-details',
      labelsOf(props).details.heading,
      caseDetailFields(caseRow, props.detailFields).map((f) => ({
        label: f.label,
        display: f.display,
      }))
    );
  }
  if (section === 'questions') {
    return renderCounts(props);
  }
  if (section === 'issues') {
    return renderIssues(props);
  }
  if (section === 'remediation') {
    return renderRemediationTracking(props);
  }
  if (section === 'notes') {
    return h(
      'section',
      { className: 'cora-summary-notes' },
      h('h3', {}, labelsOf(props).notes.heading),
      h('p', {}, caseRow.notes)
    );
  }
  return null;
}

/**
 * The **Issues** Summary block: failed Answers
 * with their configured Remediation Actions and captured Issue detail.
 * @param {SummaryProps} props
 * @returns {HTMLElement}
 */
function renderIssues(props) {
  const { remediationActionCount, failures } = buildSummaryModel(
    props.catalogue,
    props.answers
  );

  return h(
    'section',
    { className: 'cora-summary-remediation' },
    h('h3', {}, labelsOf(props).issues.heading),
    h('p', {}, `Remediation Actions: ${remediationActionCount}`),
    failures.length === 0
      ? h('p', {}, 'No failures.')
      : h('ul', {}, ...failures.map((failure) => renderFailure(props, failure)))
  );
}

/**
 * The **Remediation** tracking Summary block: the case-level
 * `remediationDueDate` plus one entry per *Question* carrying remediation, with
 * how the Reviewer resolved it.
 *
 * It reads `remediationRows` — the same rows the Remediation tab renders, so
 * the two tabs of one Case cannot contradict each other.
 *
 * The resolution's *details / justification* follows the **audience**, exactly
 * as the Remediation tab does: withheld from the `responsibleParty` side, whose
 * rendering strips the Reviewer's record-of-truth fields, and shown
 * to reviewer-side observers, whose `!canResolve` branch on the tab renders it.
 *
 * @param {SummaryProps} props
 * @returns {HTMLElement}
 */
function renderRemediationTracking(props) {
  const rows = remediationRows(props.catalogue, props.answers);
  const dueDate = props.caseRow?.remediationDueDate;
  // Absent audience means the narrower rendering: a caller that has not said who
  // is reading does not get to leak the Reviewer's fields.
  const reviewerSide = props.audience === 'reviewer';

  return h(
    'section',
    { className: 'cora-summary-remediation-tracking' },
    h('h3', {}, labelsOf(props).remediation.heading),
    h(
      'p',
      {},
      dueDate
        ? `Remediation due: ${dueDate}`
        : REMEDIATION_COPY.remediationDueNone
    ),
    rows.length === 0
      ? h('p', {}, REMEDIATION_COPY.noActionsSent)
      : h('ul', {}, ...rows.map((row) => renderTrackedRow(row, reviewerSide)))
  );
}

/**
 * @param {import('../../evaluators/remediation-status.js').RemediationRow} row
 * @param {boolean} reviewerSide Whether to show the resolution's details / justification.
 * @returns {HTMLElement}
 */
function renderTrackedRow(row, reviewerSide) {
  const { question } = row;
  const detailed =
    reviewerSide && row.status && row.status !== 'complete' && row.details;
  return h(
    'li',
    {},
    h(
      'p',
      {},
      question.questionGroup
        ? `${question.questionGroup}: ${question.text}`
        : question.text
    ),
    h(
      'ul',
      {},
      ...row.actions.map((action) => h('li', {}, action.text)),
      ...(row.freeForm ? [h('li', {}, row.freeForm)] : [])
    ),
    h(
      'p',
      {},
      row.status
        ? `Status: ${REMEDIATION_STATUS_LABELS[row.status]}`
        : REMEDIATION_COPY.awaitingReviewer
    ),
    detailed
      ? h(
          'p',
          { className: 'cora-summary-tracking-details' },
          `${REMEDIATION_DETAIL_LABELS[/** @type {'partial' | 'cancelled'} */ (row.status)]}: ${row.details}`
        )
      : null
  );
}

/**
 * @param {SummaryProps} props
 * @param {import('../../evaluators/summary-model.js').SummaryFailure} failure
 * @returns {HTMLElement}
 */
function renderFailure(props, failure) {
  return h(
    'li',
    {},
    h(
      'p',
      {},
      failure.questionGroup
        ? `${failure.questionGroup}: ${failure.text}`
        : failure.text
    ),
    h('p', {}, `Answer: ${failure.answer}`),
    failure.actions.length
      ? h('ul', {}, ...failure.actions.map((text) => h('li', {}, text)))
      : null,
    renderCapture(props, failure.id)
  );
}

/**
 * @param {SummaryProps} props
 * @param {string} questionId
 * @returns {HTMLElement | null}
 */
function renderCapture(props, questionId) {
  if (!props.captureGroups?.length) return null;
  const capture = props.answers[questionId]?.capture;
  if (!capture || Object.keys(capture).length === 0) return null;

  return h(
    'div',
    { className: 'cora-summary-capture' },
    ...CaptureGroups({
      groups: props.captureGroups,
      capture,
      canCapture: false,
      namePrefix: `summary-${questionId}-`,
      collapsed: new Map(),
      // Read-only, so no picker is ever built and nothing can search.
      peopleSearch: {},
      onToggle() {},
      onCapture() {},
      onPersonQuery() {},
    })
  );
}

/**
 * @param {SummaryProps} props
 * @returns {HTMLElement}
 */
function renderCounts(props) {
  const { groupCounts } = buildSummaryModel(props.catalogue, props.answers);
  return h(
    'section',
    { className: 'cora-summary-counts' },
    h('h3', {}, labelsOf(props).questions.heading),
    h(
      'ul',
      {},
      ...groupCounts.map(({ group, pass, fail }) =>
        h('li', {}, `${group}: ${pass} pass, ${fail} fail`)
      )
    )
  );
}

/**
 * The **General Questions** roll-up: what the Reviewer wrote on the Review tab,
 * read-only, for the Case Type Owner who only reads the Summary. Unanswered
 * fields are left out (as the read-only Issue Capture view does), so the block
 * disappears entirely when the Reviewer answered none.
 *
 * Reads `general:<key>` straight from the Answers blob rather than through
 * `buildSummaryModel`: General Questions stay outside the model, the Outcome and
 * completion gating, and this is a display block, not a change to either.
 *
 * @param {SummaryProps} props
 * @returns {HTMLElement | null}
 */
function renderGeneralQuestions(props) {
  const rows = (props.generalQuestions ?? [])
    .map((field) => ({
      label: field.label,
      display: answerText(props.answers[generalAnswerKey(field.key)]),
    }))
    .filter((row) => row.display !== '');
  if (rows.length === 0) return null;

  return renderFieldBlock(
    'cora-summary-general-questions',
    GENERAL_QUESTIONS_TITLE,
    rows
  );
}

/**
 * A General Question answer as display text, '' when unanswered.
 *
 * Every General Question type — `text`, `textarea`, `select`, `radio` (see
 * `GENERAL_QUESTION_TYPES`) — writes a string through `buildCaptureControl`, so
 * a non-string value reads as unanswered rather than being coerced.
 * @param {Answer | undefined} answer
 * @returns {string}
 */
function answerText(answer) {
  const value = answer?.value;
  return typeof value === 'string' ? value : '';
}

/**
 * @param {CaseRow} caseRow
 * @returns {HTMLElement}
 */
function renderKeyDates(caseRow) {
  const dates = [
    { label: 'Created', value: caseRow.created },
    { label: 'Completed on', value: caseRow.completedAt },
  ];
  return renderFieldBlock(
    'cora-summary-key-dates',
    'Key dates',
    dates.map((d) => ({ label: d.label, display: d.value ? d.value : '—' }))
  );
}

/**
 * @param {string} className
 * @param {string} title
 * @param {Array<{ label: string, display: string }>} rows
 * @returns {HTMLElement}
 */
function renderFieldBlock(className, title, rows) {
  return h(
    'section',
    { className },
    h('h3', {}, title),
    h(
      'dl',
      {},
      ...rows.flatMap(({ label, display }) => [
        h('dt', {}, label),
        h('dd', {}, display),
      ])
    )
  );
}
