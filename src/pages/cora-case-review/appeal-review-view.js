// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { openAppealOf } from './appeal-actions.js';
import { DEFAULT_SECTION_LABELS } from '../../lib/section-labels.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').Appeal} Appeal */
/** @typedef {import('../../sharepoint-client.js').OutcomeOption} OutcomeOption */
/** @typedef {import('../../sharepoint-client.js').CurrentUser} CurrentUser */

/**
 * The **Appeal Review** Section. Lets **Controls** resolve an open
 * Appeal on a Completed Case: either agree (outcome was wrong, author an Amended
 * Outcome linked to the Appeal id) or reject (record rationale only). Access is
 * resolved upstream (`section-access`): Controls gets
 * `edit` on a Completed Case with an open Appeal and `read-only` once every
 * Appeal is resolved; for every other role the Section is not rendered at all.
 * At most one Appeal may be open at a time.
 *
 * Agreeing emits one resolution intent so the route slice can persist the
 * resolved Appeal and linked `fromAppealId` amendment transactionally. Rejecting
 * emits the same intent without amendment fields. This view owns validation only.
 *
 * @typedef {object} AppealReviewProps
 * @property {CaseRow | null} caseRow
 * @property {'edit'|'read-only'|'hidden'} access
 * @property {CurrentUser | null} currentUser
 * @property {OutcomeOption[]} outcomeOptions
 * @property {(input: {appealId: string, verdict: 'agreed'|'rejected', rationale: string, outcome?: string, justification?: string}) => void} [onResolve]
 * @property {string} [heading] The Section's resolved heading; defaults to the
 *   standard copy so the view stays usable standalone.
 */

/**
 * @param {AppealReviewProps} props
 * @returns {Node[]}
 */
export function AppealReviewSection(props) {
  /** @type {Node[]} */
  const children = [
    h('h2', {}, props.heading ?? DEFAULT_SECTION_LABELS.appealReview.heading),
  ];

  const appeals = props.caseRow?.appeals ?? [];
  for (const appeal of appeals) {
    children.push(renderAppealSummary(appeal));
  }

  const open = openAppealOf(props.caseRow);

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
 * Read-only summary of one Appeal entry (shown to all viewers, all states).
 * @param {Appeal} appeal
 * @returns {HTMLElement}
 */
function renderAppealSummary(appeal) {
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
function renderResolveForm(props, appeal) {
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
        onclick: (/** @type {Event | undefined} */ event) => {
          const button = /** @type {HTMLElement | null} */ (
            event?.currentTarget ?? null
          );
          const form =
            button?.closest('.cora-appeal-review-form') ??
            /** @type {HTMLElement | null} */ (event?.target ?? null)?.closest(
              '.cora-appeal-review-form'
            );
          submitAppealResolution(
            props,
            appeal,
            /** @type {HTMLInputElement | null} */ (
              form?.querySelector('.cora-appeal-review-verdict-agreed')
            ) ?? agreeRadio,
            /** @type {HTMLInputElement | null} */ (
              form?.querySelector('.cora-appeal-review-verdict-rejected')
            ) ?? rejectRadio,
            /** @type {HTMLTextAreaElement | null} */ (
              form?.querySelector('.cora-appeal-review-rationale-input')
            ) ?? rationale,
            /** @type {HTMLSelectElement | null} */ (
              form?.querySelector('.cora-appeal-review-outcome-select')
            ) ?? outcomeSelect,
            /** @type {HTMLTextAreaElement | null} */ (
              form?.querySelector('.cora-appeal-review-amend-justification')
            ) ?? amendJustification,
            /** @type {HTMLElement | null} */ (
              form?.querySelector('.cora-appeal-review-error')
            ) ?? error
          );
        },
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
function submitAppealResolution(
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

  props.onResolve?.({
    appealId: appeal.id,
    verdict: /** @type {'agreed'|'rejected'} */ (verdict),
    rationale,
    ...(agreed
      ? {
          outcome: (outcomeEl.value ?? '').trim(),
          justification: (justificationEl.value ?? '').trim(),
        }
      : {}),
  });
}
