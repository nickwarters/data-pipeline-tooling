// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { DEFAULT_SECTION_LABELS } from '../../lib/section-labels.js';
import { isRemediationOverdue } from '../../evaluators/overdue-evaluator.js';
import {
  REMEDIATION_STATUSES,
  REMEDIATION_STATUS_LABELS,
  REMEDIATION_DETAIL_LABELS,
  isRemediationResolved,
  remediationRows,
} from '../../evaluators/remediation-status.js';

/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').RemediationStatusValue} RemediationStatusValue */
/** @typedef {import('../../evaluators/remediation-status.js').RemediationRow} RemediationRow */

/**
 * @typedef {object} RemediationTrackingProps
 * @property {QuestionDefinition[]} catalogue
 * @property {Record<string, Answer>} answers
 * @property {'reviewer' | 'responsibleParty'} audience Which rendering the viewer gets — see `remediationAudience`.
 * @property {boolean} canResolve Whether this viewer records resolutions (the Assigned Reviewer, in `edit` mode).
 * @property {import('../../sharepoint-client.js').CaseRow | null} [caseRow]
 * @property {(questionId: string, status: RemediationStatusValue | '', details: string) => void} [dispatchStatus]
 * @property {() => void} [dispatchOpenConversation] Opens the Conversation overlay for the responsible-party audience.
 * @property {boolean} [conversationAvailable] Whether this viewer can see the Conversation at all.
 * @property {string} [heading] Section heading; defaults to the standard copy so the component stays usable standalone.
 * @property {RemediationStatusValue[]} [statuses] The resolutions this Case Type offers; defaults to the framework vocabulary so the component stays usable standalone.
 */

/**
 * The **Remediation** tab: what still has to be put right on this Case — one row
 * per *Question* that carries remediation — and how each was resolved.
 * Questions that failed without any remediation attached do not appear:
 * attaching Remediation Actions is optional.
 *
 * Two renderings of the same breakdown, chosen by `audience`:
 *
 * - `reviewer` — the reviewing side (Assigned Reviewer, other Reviewers, a
 *   Reviewer Manager, the Case Type Owner, Controls). The **Assigned Reviewer**
 *   additionally resolves each row to `complete` / `partial` / `cancelled`,
 *   supplying the details or justification the latter two require. Until every
 *   row is resolved the Case cannot be closed, so the panel says so.
 * - `responsibleParty` — the Responsible Party doing the work, their Manager and
 *   the Journey Owner. The same breakdown with none of the Reviewer's fields:
 *   the **Conversation** is their interface, so the panel points them at it to
 *   discuss the remediation with the Reviewer and to report it done.
 *
 * Pure: resolutions go to `dispatchStatus`, which the page turns into an Answer
 * write on the normal auto-save path.
 *
 * @param {RemediationTrackingProps} props
 * @returns {Node[]}
 */
export function RemediationTracking(props) {
  const heading = h(
    'h2',
    {},
    props.heading ?? DEFAULT_SECTION_LABELS.remediation.heading
  );
  const rows = remediationRows(props.catalogue, props.answers);
  // This tab tracks the remediation clock, not the review one.
  const caseRow = props.caseRow ?? null;
  const dueDate = caseRow?.remediationDueDate ?? null;
  const overdue = caseRow !== null && isRemediationOverdue(caseRow, dueDate);
  const sla = h(
    'p',
    { className: 'cora-remediation-due-date' },
    `Remediation due: ${dueDate ?? '—'}`
  );
  const overdueBadge = overdue
    ? h('p', { className: 'cora-badge cora-badge-overdue' }, 'Overdue')
    : null;

  /** @type {Node[]} */
  const head = [heading, sla, ...(overdueBadge ? [overdueBadge] : [])];

  if (rows.length === 0) {
    return [
      ...head,
      EmptyState('No remediation actions sent.', {
        className: 'cora-remediation-tracking-empty',
      }),
    ];
  }

  const list = h('ul', { className: 'cora-remediation-tracking-list' });
  for (const row of rows) list.appendChild(renderQuestionRow(props, row));

  /** @type {Node[]} */
  const tail = [];
  if (props.audience === 'responsibleParty') {
    tail.push(conversationPrompt(props));
  } else if (
    props.canResolve &&
    rows.some((row) => !isRemediationResolved(row))
  ) {
    tail.push(
      h(
        'p',
        { className: 'cora-remediation-gate' },
        'Record an outcome for every remediation above — with the details or justification required — before this Case can be completed.'
      )
    );
  }

  return [...head, list, ...tail];
}

/**
 * One Question's row: the Question, the remediation attached to it, and either
 * the resolution controls or a read-only resolution line.
 *
 * @param {RemediationTrackingProps} props
 * @param {RemediationRow} row
 * @returns {HTMLElement}
 */
function renderQuestionRow(props, row) {
  const li = h('li', {
    className: 'cora-remediation-tracking-item',
    key: row.question.id,
  });
  li.appendChild(
    h('p', { className: 'cora-tracking-question' }, row.question.text)
  );

  if (row.actions.length > 0) {
    const actions = h('ul', { className: 'cora-tracking-actions' });
    for (const action of row.actions) {
      actions.appendChild(
        h(
          'li',
          { className: 'cora-tracking-action', key: action.id },
          action.text
        )
      );
    }
    li.appendChild(actions);
  }
  if (row.freeForm) {
    li.appendChild(h('p', { className: 'cora-tracking-action' }, row.freeForm));
  }

  // The responsible-party audience never sees the Reviewer's fields — neither
  // the controls nor the details/justification text behind them.
  if (props.audience === 'responsibleParty') {
    li.appendChild(renderStatusLine(row));
    return li;
  }
  if (!props.canResolve) {
    li.appendChild(renderStatusLine(row));
    if (row.status && row.status !== 'complete' && row.details) {
      li.appendChild(
        h(
          'p',
          { className: 'cora-tracking-details' },
          `${REMEDIATION_DETAIL_LABELS[row.status]}: ${row.details}`
        )
      );
    }
    return li;
  }

  li.appendChild(renderStatusControls(props, row));
  return li;
}

/**
 * The read-only resolution line. An unresolved row reads as awaiting the
 * Reviewer rather than exposing a raw status value.
 *
 * @param {RemediationRow} row
 * @returns {HTMLElement}
 */
function renderStatusLine(row) {
  return h(
    'p',
    { className: 'cora-tracking-status' },
    row.status
      ? `Status: ${REMEDIATION_STATUS_LABELS[row.status]}`
      : 'Status: Awaiting the Reviewer'
  );
}

/**
 * The Assigned Reviewer's controls: the resolution select plus, for the two
 * resolutions that require it, the details / justification box. The box is
 * always rendered (hidden when not needed) so `render()` keeps the same node —
 * and with it focus and caret — while the Reviewer types.
 *
 * @param {RemediationTrackingProps} props
 * @param {RemediationRow} row
 * @returns {HTMLElement}
 */
function renderStatusControls(props, row) {
  const dispatch = props.dispatchStatus ?? (() => {});
  const needsDetails =
    row.status === 'partial' || row.status === 'cancelled' ? row.status : null;
  const detailsLabel = needsDetails
    ? REMEDIATION_DETAIL_LABELS[needsDetails]
    : 'Details';
  // A row may already store a resolution this Case Type has stopped offering; a
  // browser drops a `<select>` value with no matching `<option>`, so keep the
  // stored one on offer or the row reads as unresolved with no way back.
  const offered = props.statuses?.length
    ? props.statuses
    : REMEDIATION_STATUSES;
  const statuses = REMEDIATION_STATUSES.filter(
    (status) => offered.includes(status) || status === row.status
  );

  const details = /** @type {HTMLTextAreaElement} */ (
    h('textarea', {
      className: 'cora-tracking-details-input',
      value: row.details,
      hidden: !needsDetails,
      'aria-label': `${detailsLabel} for "${row.question.text}"`,
      placeholder: needsDetails ? `${detailsLabel} (required)` : '',
      oninput: (/** @type {Event} */ event) =>
        dispatch(
          row.question.id,
          /** @type {RemediationStatusValue | ''} */ (row.status ?? ''),
          /** @type {HTMLTextAreaElement} */ (event.target).value
        ),
    })
  );

  const select = /** @type {HTMLSelectElement} */ (
    h(
      'select',
      {
        className: 'cora-tracking-status-select',
        value: row.status ?? '',
        'aria-label': `Remediation outcome for "${row.question.text}"`,
        onchange: (/** @type {Event} */ event) =>
          dispatch(
            row.question.id,
            /** @type {RemediationStatusValue | ''} */ (
              /** @type {HTMLSelectElement} */ (event.target).value
            ),
            row.details
          ),
      },
      h('option', { value: '' }, 'Not yet resolved'),
      ...statuses.map((status) =>
        h('option', { value: status }, REMEDIATION_STATUS_LABELS[status])
      )
    )
  );

  const wrapper = h(
    'div',
    { className: 'cora-tracking-controls' },
    select,
    details
  );
  if (needsDetails && !isRemediationResolved(row)) {
    wrapper.appendChild(
      h(
        'p',
        { className: 'cora-tracking-details-required' },
        `${detailsLabel} is required.`
      )
    );
  }
  return wrapper;
}

/**
 * The responsible-party audience's call to action. The Conversation is already
 * their interface for talking to the Reviewer, so the panel routes them there
 * rather than growing a second messaging surface. A viewer who cannot see the
 * Conversation at all gets the equivalent guidance in words.
 *
 * @param {RemediationTrackingProps} props
 * @returns {HTMLElement}
 */
function conversationPrompt(props) {
  const section = h('div', {
    className: 'cora-remediation-conversation-prompt',
  });
  section.appendChild(
    h(
      'p',
      {},
      'Discuss this remediation with the Reviewer — and tell them once it is complete — in the Conversation.'
    )
  );
  section.appendChild(
    props.conversationAvailable
      ? h(
          'button',
          {
            type: 'button',
            className: 'cora-btn cora-remediation-conversation-btn',
            onclick: () => props.dispatchOpenConversation?.(),
          },
          'Open conversation'
        )
      : h(
          'p',
          { className: 'cora-remediation-conversation-unavailable' },
          'The Conversation is not open to you on this Case; speak to the Responsible Party or the Reviewer directly.'
        )
  );
  return section;
}
