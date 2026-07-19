// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { DEFAULT_SECTION_HEADINGS } from '../../lib/section-labels.js';
import { evaluate } from '../../evaluators/applicability-evaluator.js';
import { isFailure } from '../../evaluators/failure-evaluator.js';
import { isOverdue } from '../../evaluators/overdue-evaluator.js';
import {
  actionFieldKeys,
  coerceRemediationActions,
} from '../../evaluators/remediation-actions.js';

/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').CaptureGroup} CaptureGroup */
/** @typedef {import('../../sharepoint-client.js').RemediationAction} RemediationAction */

/**
 * @typedef {object} TrackingRow
 * @property {QuestionDefinition} question
 * @property {string} fieldKey
 * @property {RemediationAction} action
 */

/**
 * @typedef {object} RemediationTrackingProps
 * @property {QuestionDefinition[]} catalogue
 * @property {Record<string, Answer>} answers
 * @property {CaptureGroup[]} captureGroups
 * @property {boolean} canResolve
 * @property {import('../../sharepoint-client.js').CaseRow | null} [caseRow]
 * @property {(questionId: string, fieldKey: string, actionId: string, status: 'pending' | 'complete' | 'cancelled', cancelReason: string) => void} dispatchStatus
 * @property {string} [heading] Section heading; defaults to the standard copy so the component stays usable standalone.
 */

/**
 * The **Remediation tracking** tab: lists every *sent* Remediation
 * Action across the Case's failed Answers and lets the Assigned Reviewer resolve
 * each — `complete`, or `cancelled` with a required reason. Read-only viewers see
 * each action's status and (when cancelled) its reason. Persistence is the page's
 * responsibility: a status change calls the `dispatchStatus` callback so the
 * answers signal stays the single source of truth.
 *
 * @param {RemediationTrackingProps} props
 * @returns {Node[]}
 */
export function RemediationTracking(props) {
  const heading = h(
    'h2',
    {},
    props.heading ?? DEFAULT_SECTION_HEADINGS.remediation
  );
  const rows = collectRows(props);
  const dueDate = props.caseRow?.remediationDueDate ?? null;
  const overdue =
    !!dueDate &&
    isOverdue(
      {
        .../** @type {import('../../sharepoint-client.js').CaseRow} */ (
          props.caseRow
        ),
        dueDate,
      },
      undefined
    );
  const sla = h(
    'p',
    { className: 'cora-remediation-due-date' },
    `Remediation due: ${dueDate ?? '—'}`
  );
  const overdueBadge = overdue
    ? h('p', { className: 'cora-badge cora-badge-overdue' }, 'Overdue')
    : null;

  if (rows.length === 0) {
    return [
      heading,
      sla,
      ...(overdueBadge ? [overdueBadge] : []),
      EmptyState('No remediation actions sent.', {
        className: 'cora-remediation-tracking-empty',
      }),
    ];
  }

  const list = h('ul', { class: 'cora-remediation-tracking-list' });
  for (const row of rows) list.appendChild(renderActionRow(props, row));
  return [heading, sla, ...(overdueBadge ? [overdueBadge] : []), list];
}

/**
 * @param {RemediationTrackingProps} props
 * @returns {TrackingRow[]}
 */
export function collectRows(props) {
  const keys = actionFieldKeys(props.captureGroups);
  if (keys.length === 0) return [];
  const applicable = evaluate(props.catalogue, props.answers);
  /** @type {TrackingRow[]} */
  const rows = [];
  for (const question of props.catalogue) {
    if (!applicable.has(question.id)) continue;
    const answer = props.answers[question.id];
    if (!isFailure(question, answer)) continue;
    for (const fieldKey of keys) {
      const raw = answer?.capture?.[fieldKey];
      if (!Array.isArray(raw)) continue;
      for (const action of coerceRemediationActions(raw, fieldKey)) {
        rows.push({ question, fieldKey, action });
      }
    }
  }
  return rows;
}

/**
 * @param {RemediationTrackingProps} props
 * @param {TrackingRow} row
 * @returns {HTMLElement}
 */
export function renderActionRow(props, row) {
  const { question, fieldKey, action } = row;
  const li = h('li', {
    class: 'cora-remediation-tracking-item',
    key: `${question.id}:${fieldKey}:${action.id}`,
  });
  li.appendChild(h('p', { class: 'cora-tracking-question' }, question.text));
  li.appendChild(h('p', { class: 'cora-tracking-action' }, action.text));

  if (!props.canResolve) {
    li.appendChild(
      h('p', { class: 'cora-tracking-status' }, `Status: ${action.status}`)
    );
    if (action.status === 'cancelled' && action.cancelReason) {
      li.appendChild(
        h(
          'p',
          { class: 'cora-tracking-cancel-reason' },
          `Reason: ${action.cancelReason}`
        )
      );
    }
    return li;
  }

  const reasonInput = /** @type {HTMLInputElement} */ (
    h('input', {
      class: 'cora-tracking-cancel-input',
      type: 'text',
      value: action.cancelReason ?? '',
      placeholder: 'Cancellation reason',
      hidden: action.status !== 'cancelled',
      onchange: (/** @type {Event} */ event) =>
        props.dispatchStatus(
          question.id,
          fieldKey,
          action.id,
          'cancelled',
          /** @type {HTMLInputElement} */ (event.target).value
        ),
    })
  );

  const select = /** @type {HTMLSelectElement} */ (
    h(
      'select',
      {
        class: 'cora-tracking-status-select',
        value: action.status,
        onchange: (/** @type {Event} */ event) => {
          const currentSelect = /** @type {HTMLSelectElement} */ (event.target);
          const row = /** @type {HTMLElement} */ (currentSelect.parentNode);
          const currentReasonInput = /** @type {HTMLInputElement} */ (
            row.querySelector('.cora-tracking-cancel-input')
          );
          const status = /** @type {'pending'|'complete'|'cancelled'} */ (
            currentSelect.value
          );
          currentReasonInput.hidden = status !== 'cancelled';
          props.dispatchStatus(
            question.id,
            fieldKey,
            action.id,
            status,
            currentReasonInput.value
          );
        },
      },
      h('option', { value: 'pending' }, 'Pending'),
      h('option', { value: 'complete' }, 'Complete'),
      h('option', { value: 'cancelled' }, 'Cancelled')
    )
  );

  li.appendChild(select);
  li.appendChild(reasonInput);
  return li;
}
