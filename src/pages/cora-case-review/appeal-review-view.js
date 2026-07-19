// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { buildAmendmentFields } from '../../evaluators/amended-outcome.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').Appeal} Appeal */
/** @typedef {import('../../sharepoint-client.js').AmendedOutcome} AmendedOutcome */
/** @typedef {import('../../sharepoint-client.js').OutcomeOption} OutcomeOption */
/** @typedef {import('../../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../../services/save-queue.js').SaveQueue} SaveQueue */

/**
 * The **Appeal Review** Section. Lets **Controls** resolve an open
 * Appeal on a Completed Case: either agree (outcome was wrong, author an Amended
 * Outcome linked to the Appeal id) or reject (record rationale only). Access is
 * resolved upstream (`section-access`, the architecture decision): `edit` only for Controls on a
 * Completed Case with an open Appeal; `read-only` for other observers; otherwise
 * the Section is not rendered at all. At most one Appeal may be open at a time.
 *
 * Agreeing triggers a transactional write: the Appeal is resolved *and* an Amended
 * Outcome carrying `fromAppealId` is authored in the same
 * `SaveQueue.enqueueFields` call. Rejecting writes only the updated `appeals[]`.
 *
 * @typedef {object} AppealReviewProps
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
 * @param {AppealReviewProps} props
 * @returns {Node[]}
 */
export function AppealReviewSection(props) {
  /** @type {Node[]} */
  const children = [h('h2', {}, 'Appeal Review')];

  const appeals = props.caseRow?.appeals ?? [];
  for (const appeal of appeals) {
    children.push(renderAppealSummary(appeal));
  }

  const open = openAppealFrom(props);

  if (props.access === 'edit' && open) {
    children.push(renderResolveForm(props, open));
  } else if (appeals.length === 0) {
    children.push(
      EmptyState('No Appeal has been raised for this Case.', {
        className: 'cora-appeal-review-empty',
      })
    );
  }

  return children;
}

/**
 * @param {AppealReviewProps} props
 * @returns {Appeal | null}
 */
export function openAppealFrom(props) {
  return (
    (props.caseRow?.appeals ?? []).find((a) => a.state !== 'resolved') ?? null
  );
}

/**
 * Read-only summary of one Appeal entry (shown to all viewers, all states).
 * @param {Appeal} appeal
 * @returns {HTMLElement}
 */
export function renderAppealSummary(appeal) {
  const children = [
    h('p', { className: 'cora-appeal-review-state' }, `State: ${appeal.state}`),
    h(
      'p',
      { className: 'cora-appeal-review-rationale' },
      `Appellant's rationale: ${appeal.rationale}`
    ),
  ];
  if (appeal.resolution) {
    children.push(
      h(
        'p',
        { className: 'cora-appeal-review-resolution' },
        `Resolution: ${appeal.resolution.verdict} — ${appeal.resolution.rationale}`
      )
    );
  }
  return h('section', { className: 'cora-appeal-review-item' }, ...children);
}

/**
 * The Controls-only resolve form: verdict (agree/reject), rationale, and — when
 * agreeing — an Outcome picker and justification for the linked Amended Outcome.
 * @param {AppealReviewProps} props
 * @param {Appeal} appeal
 * @returns {HTMLElement}
 */
export function renderResolveForm(props, appeal) {
  const agreeRadio = /** @type {HTMLInputElement} */ (
    /** @type {unknown} */ (
      h('input', {
        type: 'radio',
        name: 'cora-appeal-review-verdict',
        value: 'agreed',
        className: 'cora-appeal-review-verdict-agreed',
      })
    )
  );
  const rejectRadio = /** @type {HTMLInputElement} */ (
    /** @type {unknown} */ (
      h('input', {
        type: 'radio',
        name: 'cora-appeal-review-verdict',
        value: 'rejected',
        className: 'cora-appeal-review-verdict-rejected',
      })
    )
  );

  const rationale = /** @type {HTMLTextAreaElement} */ (
    h('textarea', { className: 'cora-appeal-review-rationale-input' })
  );
  rationale.setAttribute('aria-label', 'Resolution rationale');

  const outcomeSelect = /** @type {HTMLSelectElement} */ (
    h(
      'select',
      { className: 'cora-appeal-review-outcome-select' },
      h('option', { value: '' }, 'Select an outcome…'),
      ...props.outcomeOptions.map((o) =>
        h('option', { value: o.id }, o.wording)
      )
    )
  );
  outcomeSelect.setAttribute('aria-label', 'Amended outcome');

  const amendJustification = /** @type {HTMLTextAreaElement} */ (
    h('textarea', { className: 'cora-appeal-review-amend-justification' })
  );
  amendJustification.setAttribute('aria-label', 'Amendment justification');

  const error = h(
    'p',
    { className: 'cora-appeal-review-error', hidden: true },
    'A verdict and a rationale are required. If agreeing, an outcome and justification are also required.'
  );

  return h(
    'section',
    { className: 'cora-appeal-review-form' },
    h(
      'label',
      { className: 'cora-appeal-review-agree-label' },
      agreeRadio,
      h('span', {}, 'Agree')
    ),
    h(
      'label',
      { className: 'cora-appeal-review-reject-label' },
      rejectRadio,
      h('span', {}, 'Reject')
    ),
    h('label', {}, 'Resolution rationale'),
    rationale,
    h('label', {}, 'New Outcome (required when agreeing)'),
    outcomeSelect,
    h('label', {}, 'Amendment justification (required when agreeing)'),
    amendJustification,
    error,
    h(
      'button',
      {
        className: 'cora-appeal-review-submit',
        onClick: () =>
          resolveAppeal(
            props,
            appeal,
            agreeRadio,
            rejectRadio,
            rationale,
            outcomeSelect,
            amendJustification,
            error
          ),
      },
      'Resolve Appeal'
    )
  );
}

/**
 * Validate and commit the resolution. On agree, also authors a linked Amended
 * Outcome in the same transactional field write.
 * @param {AppealReviewProps} props
 * @param {Appeal} appeal
 * @param {{ checked?: boolean }} agreeRadio
 * @param {{ checked?: boolean }} rejectRadio
 * @param {{ value?: string }} rationaleEl
 * @param {{ value?: string }} outcomeEl
 * @param {{ value?: string }} justificationEl
 * @param {HTMLElement} errorEl
 */
export function resolveAppeal(
  props,
  appeal,
  agreeRadio,
  rejectRadio,
  rationaleEl,
  outcomeEl,
  justificationEl,
  errorEl
) {
  const agreed = !!agreeRadio.checked;
  const rejected = !!rejectRadio.checked;
  const verdict = agreed ? 'agreed' : rejected ? 'rejected' : null;
  const rationale = (rationaleEl.value ?? '').trim();

  if (!verdict || !rationale) {
    errorEl.hidden = false;
    return;
  }

  if (agreed) {
    const outcome = (outcomeEl.value ?? '').trim();
    const justification = (justificationEl.value ?? '').trim();
    if (!outcome || !justification) {
      errorEl.hidden = false;
      return;
    }
  }

  /** @type {Appeal['resolution']} */
  const resolution = {
    verdict: /** @type {'agreed'|'rejected'} */ (verdict),
    rationale,
    resolver: props.currentUser?.id ?? '',
    at: props.now(),
  };

  const updatedAppeal = {
    ...appeal,
    state: /** @type {'resolved'} */ ('resolved'),
    resolution,
  };
  const allAppeals = (props.caseRow?.appeals ?? []).map((a) =>
    a.id === appeal.id ? updatedAppeal : a
  );

  if (props.caseRow) props.caseRow.appeals = allAppeals;

  if (agreed) {
    const outcome = (outcomeEl.value ?? '').trim();
    const justification = (justificationEl.value ?? '').trim();
    /** @type {AmendedOutcome} */
    const amendment = {
      outcome,
      justification,
      amendedBy: props.currentUser?.id ?? '',
      amendedAt: props.now(),
      fromAppealId: appeal.id,
    };
    if (props.caseRow) {
      const fields = buildAmendmentFields(props.caseRow, amendment);
      Object.assign(props.caseRow, fields);
      props.caseRow.appeals = allAppeals;
      props.saveQueue?.enqueueFields(props.caseId, {
        appeals: allAppeals,
        ...fields,
      });
    } else {
      props.saveQueue?.enqueueFields(props.caseId, { appeals: allAppeals });
    }
  } else {
    props.saveQueue?.enqueue(props.caseId, 'appeals', allAppeals);
  }

  props.render();
}
