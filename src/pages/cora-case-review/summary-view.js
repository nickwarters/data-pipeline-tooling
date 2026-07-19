// @ts-check
import { h } from '../../lib/html.js';
import { Outcome } from './outcome-view.js';
import { caseDetailFields } from './details-view.js';
import { buildSummaryModel } from '../../evaluators/summary-model.js';
import { isReportable } from '../../lib/case-machine.js';
import { currentOutcome } from '../../evaluators/amended-outcome.js';
import { DEFAULT_SECTION_HEADINGS } from '../../lib/section-labels.js';
import '../../components/sections/cora-capture-groups.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';

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
  const outcome = current
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

  /** @type {Node[]} */
  const children = [heading, ...outcome];

  if (props.caseRow) {
    children.push(renderKeyDates(props.caseRow));
    for (const section of props.summarySections) {
      const block = renderSectionBlock(props, section, props.caseRow);
      if (block) children.push(block);
    }
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
      { class: 'cora-summary-notes' },
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
    { class: 'cora-summary-remediation' },
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
    { class: 'cora-summary-remediation-tracking' },
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

  const cg =
    /** @type {import('../../components/sections/cora-capture-groups.js').CORACaptureGroups} */ (
      h('cora-capture-groups', {
        class: 'cora-summary-capture',
      })
    );
  cg.groups = props.captureGroups;
  cg.capture = capture;
  cg.canCapture = false;
  cg.update(props.captureGroups, capture, false);
  return cg;
}

/**
 * @param {SummaryProps} props
 * @returns {HTMLElement}
 */
function renderCounts(props) {
  const { groupCounts } = buildSummaryModel(props.catalogue, props.answers);
  return h(
    'section',
    { class: 'cora-summary-counts' },
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
    { class: className },
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
