// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import {
  currentOutcome,
  buildAmendmentFields,
} from '../../evaluators/amended-outcome.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').AmendedOutcome} AmendedOutcome */
/** @typedef {import('../../sharepoint-client.js').OutcomeOption} OutcomeOption */
/** @typedef {import('../../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../../services/save-queue.js').SaveQueue} SaveQueue */

/**
 * The **Amend Outcome** Section. Lets **Controls** author a case-level
 * **Amended Outcome** on a Completed Case: an explicit, hand-set verdict with a
 * mandatory justification. The write is additive — the frozen `outcomeAtCompletion`
 * is never touched — and is a single ETag-guarded PATCH (`SaveQueue.enqueueFields`,
 * the architecture decision) that carries the record *and* re-stamps the the architecture decision reporting columns
 * (`effectiveOutcome` / `outcomeOverridden` / `effectiveHadRemediation`) together
 * so a partial write cannot desync them.
 *
 * Access is resolved upstream (section-access, the architecture decision): `edit` only for Controls
 * on a Completed Case; `read-only` for the Assigned Reviewer, Case Type Owner and
 * Journey Owner (they can see an amendment happened); otherwise the Section is not
 * rendered at all. A re-amendment overwrites the single record.
 */
/**
 * @typedef {object} AmendOutcomeProps
 * @property {CaseRow | null} caseRow
 * @property {SaveQueue | null} saveQueue
 * @property {string} caseId
 * @property {'edit'|'read-only'|'hidden'} access
 * @property {CurrentUser | null} currentUser
 * @property {OutcomeOption[]} outcomeOptions
 * @property {() => string} now
 * @property {() => void} render
 */

/**
 * @param {AmendOutcomeProps} props
 * @returns {Node[]}
 */
export function AmendOutcomeSection(props) {
  /** @type {Node[]} */
  const children = [h('h2', {}, 'Amend Outcome')];

  children.push(renderCurrentOutcome(props));

  if (props.access === 'edit') {
    children.push(renderAmendForm(props));
  } else if (props.caseRow?.amendedOutcome) {
    children.push(renderAmendmentRecord(props.caseRow.amendedOutcome));
  } else {
    children.push(
      EmptyState('No amendment has been made.', {
        className: 'cora-amend-outcome-empty',
      })
    );
  }

  return children;
}

/**
 * The Current Outcome in force now (`amendedOutcome?.outcome ?? outcomeAtCompletion`),
 * or a placeholder before the Case is reportable and no snapshot exists.
 * @param {AmendOutcomeProps} props
 * @returns {HTMLElement}
 */
function renderCurrentOutcome(props) {
  const current = props.caseRow ? currentOutcome(props.caseRow) : undefined;
  return h(
    'p',
    { className: 'cora-amend-outcome-current' },
    `Current Outcome: ${current ? wordingFor(current, props.outcomeOptions) : '—'}`
  );
}

/**
 * The read-only view of an existing amendment (for non-editing observers).
 * @param {AmendedOutcome} amendment
 * @returns {HTMLElement}
 */
export function renderAmendmentRecord(amendment) {
  return h(
    'section',
    { className: 'cora-amend-outcome-record' },
    h(
      'p',
      { className: 'cora-amend-outcome-record-justification' },
      amendment.justification
    ),
    h(
      'p',
      { className: 'cora-amend-outcome-record-audit' },
      `Amended by ${amendment.amendedBy} on ${amendment.amendedAt}`
    )
  );
}

/**
 * The Controls-only amend form: an Outcome picker (pre-filled with the current
 * amended value when one exists) plus a mandatory justification.
 * @param {AmendOutcomeProps} props
 * @returns {HTMLElement}
 */
export function renderAmendForm(props) {
  const existing = props.caseRow?.amendedOutcome ?? null;

  const select = /** @type {HTMLSelectElement} */ (
    h(
      'select',
      {
        id: 'cora-amend-outcome-select',
        className: 'cora-amend-outcome-select',
        value: existing?.outcome ?? '',
      },
      h('option', { value: '' }, 'Select an outcome…'),
      ...props.outcomeOptions.map((option) =>
        h('option', { value: option.id }, option.wording)
      )
    )
  );
  select.setAttribute('aria-label', 'Amended outcome');

  const justification = /** @type {HTMLTextAreaElement} */ (
    h('textarea', {
      id: 'cora-amend-outcome-justification',
      className: 'cora-amend-outcome-justification',
      rows: 4,
      value: existing?.justification ?? '',
    })
  );
  justification.setAttribute('aria-label', 'Amendment justification');

  const error = h(
    'p',
    { className: 'cora-amend-outcome-error', hidden: true },
    'An outcome and a justification are both required to amend the Outcome.'
  );

  return h(
    'section',
    { className: 'cora-amend-outcome-form' },
    h(
      'div',
      { className: 'cora-amend-outcome-field' },
      h('label', { htmlFor: 'cora-amend-outcome-select' }, 'New Outcome'),
      select
    ),
    h(
      'div',
      { className: 'cora-amend-outcome-field' },
      h(
        'label',
        { htmlFor: 'cora-amend-outcome-justification' },
        'Why are you amending this outcome?'
      ),
      justification
    ),
    error,
    h(
      'button',
      {
        className: 'cora-amend-outcome-submit',
        onClick: () => amend(props, select, justification, error),
      },
      'Amend Outcome'
    )
  );
}

/**
 * Validate, build the transactional field set and enqueue the single ETag-guarded
 * write. Both an Outcome and a justification are required.
 * @param {AmendOutcomeProps} props
 * @param {{ value?: string }} selectEl
 * @param {{ value?: string }} justificationEl
 * @param {HTMLElement} errorEl
 */
export function amend(props, selectEl, justificationEl, errorEl) {
  const outcome = (selectEl.value ?? '').trim();
  const justification = (justificationEl.value ?? '').trim();
  if (!outcome || !justification) {
    errorEl.hidden = false;
    return;
  }

  /** @type {AmendedOutcome} */
  const amendment = {
    outcome,
    justification,
    amendedBy: props.currentUser?.id ?? '',
    amendedAt: props.now(),
  };

  if (props.caseRow) {
    const fields = buildAmendmentFields(props.caseRow, amendment);
    Object.assign(props.caseRow, fields);
    props.saveQueue?.enqueueFields(props.caseId, fields);
  }
  props.render();
}

/**
 * @param {string} value
 * @param {OutcomeOption[]} outcomeOptions
 * @returns {string}
 */
function wordingFor(value, outcomeOptions) {
  return outcomeOptions.find((o) => o.id === value)?.wording ?? value;
}

export class CORAAmendOutcome extends ShellElement {
  constructor() {
    super();
    /** @type {CaseRow | null} */
    this.caseRow = null;
    /** @type {SaveQueue | null} */
    this.saveQueue = null;
    /** @type {string} */
    this.caseId = '';
    /** @type {'edit'|'read-only'|'hidden'} */
    this.access = 'read-only';
    /** @type {CurrentUser | null} */
    this.currentUser = null;
    /**
     * The Case Type's Outcome options, offered as the hand-set verdict
     * choices. Empty when the Case Type declares none.
     * @type {OutcomeOption[]}
     */
    this.outcomeOptions = [];
  }

  render() {
    return AmendOutcomeSection(this._buildProps());
  }

  /**
   * ISO timestamp seam so tests can pin `amendedAt`.
   * @returns {string}
   */
  now() {
    return new Date().toISOString();
  }

  /** @returns {AmendOutcomeProps} */
  _buildProps() {
    return {
      caseRow: this.caseRow,
      saveQueue: this.saveQueue,
      caseId: this.caseId,
      access: this.access,
      currentUser: this.currentUser,
      outcomeOptions: this.outcomeOptions,
      now: () => this.now(),
      render: () => this._shellRenderNow?.(),
    };
  }
}

customElements.define('cora-amend-outcome', CORAAmendOutcome);
