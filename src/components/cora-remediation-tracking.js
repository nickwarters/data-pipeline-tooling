// @ts-check
import { ShellElement } from '../lib/view.js';
import { h } from '../lib/html.js';
import { evaluate } from '../evaluators/applicability-evaluator.js';
import { isFailure } from '../evaluators/failure-evaluator.js';
import {
  actionFieldKeys,
  coerceRemediationActions,
} from '../evaluators/remediation-actions.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').CaptureGroup} CaptureGroup */
/** @typedef {import('../sharepoint-client.js').RemediationAction} RemediationAction */

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
 * @property {(questionId: string, fieldKey: string, actionId: string, status: 'pending' | 'complete' | 'cancelled', cancelReason: string) => void} dispatchStatus
 */

/**
 * The **Remediation tracking** tab (ADR-0024): lists every *sent* Remediation
 * Action across the Case's failed Answers and lets the Assigned Reviewer resolve
 * each — `complete`, or `cancelled` with a required reason. Read-only viewers see
 * each action's status and (when cancelled) its reason. Persistence is the page's
 * responsibility: a status change is re-dispatched as a bubbling `cora-action-status`
 * so the answers signal stays the single source of truth.
 *
 * @param {RemediationTrackingProps} props
 * @returns {Node[]}
 */
export function RemediationTracking(props) {
  const heading = h('h2', {}, 'Remediation');
  const rows = collectRows(props);

  if (rows.length === 0) {
    return [
      heading,
      h(
        'p',
        { class: 'cora-remediation-tracking-empty' },
        'No remediation actions sent.'
      ),
    ];
  }

  const list = h('ul', { class: 'cora-remediation-tracking-list' });
  for (const row of rows) list.appendChild(renderActionRow(props, row));
  return [heading, list];
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
  const li = h('li', { class: 'cora-remediation-tracking-item' });
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
      onchange: () =>
        props.dispatchStatus(
          question.id,
          fieldKey,
          action.id,
          'cancelled',
          reasonInput.value
        ),
    })
  );

  const select = /** @type {HTMLSelectElement} */ (
    h(
      'select',
      {
        class: 'cora-tracking-status-select',
        value: action.status,
        onchange: () => {
          const status = /** @type {'pending'|'complete'|'cancelled'} */ (
            select.value
          );
          reasonInput.hidden = status !== 'cancelled';
          props.dispatchStatus(
            question.id,
            fieldKey,
            action.id,
            status,
            reasonInput.value
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

export class CORARemediationTracking extends ShellElement {
  constructor() {
    super();
    /** @type {QuestionDefinition[]} */
    this.catalogue = [];
    /** @type {Record<string, Answer>} */
    this.answers = {};
    /** @type {CaptureGroup[]} */
    this.captureGroups = [];
    /** @type {boolean} Whether the viewer may resolve actions (Assigned Reviewer, Actions In Progress). */
    this.canResolve = false;
  }

  /**
   * @param {QuestionDefinition[]} catalogue
   * @param {Record<string, Answer>} answers
   */
  update(catalogue, answers) {
    this.catalogue = catalogue;
    this.answers = answers;
    this._render();
  }

  _render() {
    this.replaceChildren(...this.render());
  }

  render() {
    return RemediationTracking(this._props());
  }

  /** @returns {RemediationTrackingProps} */
  _props() {
    return {
      catalogue: this.catalogue,
      answers: this.answers,
      captureGroups: this.captureGroups,
      canResolve: this.canResolve,
      dispatchStatus: (questionId, fieldKey, actionId, status, cancelReason) =>
        this._dispatchStatus(
          questionId,
          fieldKey,
          actionId,
          status,
          cancelReason
        ),
    };
  }

  /**
   * @param {string} questionId
   * @param {string} fieldKey
   * @param {string} actionId
   * @param {'pending' | 'complete' | 'cancelled'} status
   * @param {string} cancelReason
   */
  _dispatchStatus(questionId, fieldKey, actionId, status, cancelReason) {
    this.dispatchEvent(
      new CustomEvent('cora-action-status', {
        detail: { questionId, fieldKey, actionId, status, cancelReason },
        bubbles: true,
      })
    );
  }
}

customElements.define('cora-remediation-tracking', CORARemediationTracking);
