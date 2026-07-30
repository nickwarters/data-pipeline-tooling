// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { currentOutcome } from '../../evaluators/amended-outcome.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').AmendedOutcome} AmendedOutcome */
/** @typedef {import('../../sharepoint-client.js').OutcomeOption} OutcomeOption */
/** @typedef {import('../../sharepoint-client.js').CurrentUser} CurrentUser */

/**
 * The **Amend Outcome** Section. Lets **Controls** author a case-level
 * **Amended Outcome** on a reportable Case: an explicit, hand-set verdict with a
 * mandatory justification. The write is additive — the frozen `outcomeAtCompletion`
 * is never touched. It emits one intent that the route slice persists as a
 * single ETag-guarded PATCH carrying the record and re-stamping the reporting columns
 * (`effectiveOutcome` / `outcomeOverridden` / `effectiveHadRemediation`) together
 * so a partial write cannot desync them.
 *
 * Access is resolved upstream in section-access: `edit` for Controls once the Case
 * is reportable, `hidden` for every other role at every status. Other roles read
 * the resulting **Current Outcome** in the **Summary** Section instead — the
 * amended verdict is visible to them, the tab that produced it is not.
 * A re-amendment overwrites the single record.
 */
/**
 * @typedef {object} AmendOutcomeProps
 * @property {CaseRow | null} caseRow
 * @property {'edit'|'read-only'|'hidden'} access
 * @property {CurrentUser | null} currentUser
 * @property {OutcomeOption[]} outcomeOptions
 * @property {(input: {outcome: string, justification: string}) => void} [onAmend]
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
function renderAmendmentRecord(amendment) {
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
function renderAmendForm(props) {
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
        onclick: (/** @type {Event | undefined} */ event) => {
          const button = /** @type {HTMLElement | null} */ (
            event?.currentTarget ?? null
          );
          const form =
            button?.closest('.cora-amend-outcome-form') ??
            /** @type {HTMLElement | null} */ (event?.target ?? null)?.closest(
              '.cora-amend-outcome-form'
            );
          amend(
            props,
            /** @type {HTMLSelectElement | null} */ (
              form?.querySelector('.cora-amend-outcome-select')
            ) ?? select,
            /** @type {HTMLTextAreaElement | null} */ (
              form?.querySelector('.cora-amend-outcome-justification')
            ) ?? justification,
            /** @type {HTMLElement | null} */ (
              form?.querySelector('.cora-amend-outcome-error')
            ) ?? error
          );
        },
      },
      'Amend Outcome'
    )
  );
}

/**
 * Validate and emit a single amendment intent. Both an Outcome and a
 * justification are required.
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

  props.onAmend?.({ outcome, justification });
}

/**
 * @param {string} value
 * @param {OutcomeOption[]} outcomeOptions
 * @returns {string}
 */
function wordingFor(value, outcomeOptions) {
  return outcomeOptions.find((o) => o.id === value)?.wording ?? value;
}
