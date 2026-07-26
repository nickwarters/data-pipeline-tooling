// @ts-check
import { h } from '../../lib/html.js';
import { Outcome } from './outcome-view.js';
import { caseDetailFields } from './details-view.js';
import { buildSummaryModel } from '../../evaluators/summary-model.js';
import { isReportable } from '../../lib/case-machine.js';
import { currentOutcome } from '../../evaluators/amended-outcome.js';
import { DEFAULT_SECTION_HEADINGS } from '../../lib/section-labels.js';
import { CaptureGroups } from '../../components/sections/cora-capture-groups.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';
import { generalAnswerKey } from '../../evaluators/general-questions.js';
import { GENERAL_QUESTIONS_TITLE } from './general-questions-view.js';

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
 * @property {Required<import('../../sharepoint-client.js').SectionLabels>} [sectionHeadings] Resolved section headings; defaults to the standard copy so the component stays usable standalone.
 * @property {import('../../sharepoint-client.js').GeneralQuestionField[]} [generalQuestions] The Case Type's General Questions, rolled up read-only. Display only — they reach no evaluator here either.
 * @property {'before'|'after'} [generalQuestionsPlacement] Which side of the configured Summary blocks the roll-up sits on; matches the Review tab's placement ('after' when absent).
 */

/**
 * @param {SummaryProps} props
 * @returns {Node[]}
 */
export function summaryView(props) {
  const headings = props.sectionHeadings ?? DEFAULT_SECTION_HEADINGS;
  const heading = h('h2', {}, headings.summary);

  // The Outcome snapshot is stamped at the reportable milestone, so
  // read the frozen value from reportable on — not only once Completed. Once
  // reportable, the block shows the **Current Outcome**: the case-level
  // Amended Outcome when Controls has amended it, otherwise the frozen snapshot.
  const reportable = isReportable(props.caseRow?.status ?? '');
  const current =
    reportable && props.caseRow ? currentOutcome(props.caseRow) : undefined;
  const outcomeNodes = current
    ? Outcome({
        computeOutcome: () => ({ outcome: current }),
        answers: {},
        allAnswered: true,
        outcomeOptions: props.outcomeOptions,
      })
    : Outcome({
        computeOutcome: props.computeOutcome,
        answers: props.answers,
        allAnswered: props.allAnswered,
        outcomeOptions: props.outcomeOptions,
      });
  // A CSS hook for the `.cora-summary > .cora-outcome` contract, nothing more.
  // Was an unregistered `cora-outcome` element via raw `createElement` until
  // #514 retired that pattern — see the note at the top of section-panels.js.
  const outcome = h('div', { className: 'cora-outcome' }, outcomeNodes);

  /** @type {Node[]} */
  const children = [heading, outcome];

  if (props.caseRow) {
    children.push(renderKeyDates(props.caseRow));
    const general = renderGeneralQuestions(props);
    // `generalQuestionsPlacement` is also interpreted by the Review tab
    // (cora-case-review.js, where absent likewise means 'after') — keep the two
    // in step, or hoist a shared resolver if a third consumer appears.
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
 * The effective section headings for a render: the resolved map threaded by
 * the page, or the defaults when the component is used standalone.
 * @param {SummaryProps} props
 * @returns {Required<import('../../sharepoint-client.js').SectionLabels>}
 */
function headingsOf(props) {
  return props.sectionHeadings ?? DEFAULT_SECTION_HEADINGS;
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
      'Case Details',
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
      h('h3', {}, headingsOf(props).notes),
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
    props.answers,
    props.captureGroups
  );

  return h(
    'section',
    { className: 'cora-summary-remediation' },
    h('h3', {}, headingsOf(props).issues),
    h('p', {}, `Remediation Actions: ${remediationActionCount}`),
    failures.length === 0
      ? h('p', {}, 'No failures.')
      : h('ul', {}, ...failures.map((failure) => renderFailure(props, failure)))
  );
}

/**
 * The **Remediation** tracking Summary block: the case-level
 * `remediationDueDate` plus, per failed Answer, each *sent* Remediation Action's
 * `status` (and `cancelReason` when cancelled).
 * @param {SummaryProps} props
 * @returns {HTMLElement}
 */
function renderRemediationTracking(props) {
  const { failures } = buildSummaryModel(
    props.catalogue,
    props.answers,
    props.captureGroups
  );
  const withActions = failures.filter((f) => f.sentActions.length > 0);
  const dueDate = props.caseRow?.remediationDueDate;

  return h(
    'section',
    { className: 'cora-summary-remediation-tracking' },
    h('h3', {}, headingsOf(props).remediation),
    h('p', {}, `Remediation due: ${dueDate ? dueDate : '—'}`),
    withActions.length === 0
      ? h('p', {}, 'No remediation actions sent.')
      : h(
          'ul',
          {},
          ...withActions.map((failure) => renderTrackedFailure(failure))
        )
  );
}

/**
 * @param {import('../../evaluators/summary-model.js').SummaryFailure} failure
 * @returns {HTMLElement}
 */
function renderTrackedFailure(failure) {
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
    h(
      'ul',
      {},
      ...failure.sentActions.map((action) =>
        h(
          'li',
          {},
          action.status === 'cancelled' && action.cancelReason
            ? `${action.text} — ${action.status} (${action.cancelReason})`
            : `${action.text} — ${action.status}`
        )
      )
    )
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
      onToggle() {},
      onCapture() {},
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
    h('h3', {}, headingsOf(props).questions),
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
 * @param {Answer | undefined} answer
 * @returns {string}
 */
function answerText(answer) {
  const value = answer?.value;
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : '';
}

/**
 * @param {CaseRow} caseRow
 * @returns {HTMLElement}
 */
function renderKeyDates(caseRow) {
  const dates = [
    { label: 'Created', value: caseRow.created },
    { label: CASE_STATUS.COMPLETED, value: caseRow.completedAt },
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

/**
 * The read-only Summary Section. It rolls the whole Case up onto one
 * page; this tracer-bullet shell renders only the Outcome block. Outcome
 * derivation is hybrid: while the Case is In-progress the outcome is computed
 * live from the current Answers, but once the Case is reportable (Actions In
 * Progress or Completed) it reads the frozen `outcomeAtCompletion` snapshot
 * rather than recomputing.
 *
 * Summary is never editable — only `read-only` or `hidden` (see section-access).
 */
