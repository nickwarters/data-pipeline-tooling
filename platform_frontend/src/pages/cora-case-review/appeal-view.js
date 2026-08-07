// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { DEFAULT_SECTION_LABELS } from '../../lib/section-labels.js';
import { isFailure } from '../../evaluators/failure-evaluator.js';
import { buildCaptureControl } from '../../lib/capture-engine.js';
import { openAppealOf } from '../../evaluators/appeal-state.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').Appeal} Appeal */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/**
 * The Appeal Section. Lets the Case Type's configured appeal raiser — the
 * Journey Owner or the Responsible Party Manager, never the Responsible Party —
 * raise a case-level **Appeal** objecting to a Completed Case's Current Outcome
 * (CONTEXT.md). The Appeal is additive: it appends to the Case row's `appeals[]`
 * JSON blob through a route-owned action and never touches the frozen Answers —
 * citing a disputed Answer aims the reviewer but sets no value. This view owns
 * form validation only; the route slice owns immutable state and persistence.
 *
 * Access is resolved upstream (section-access): `edit` for the configured raiser
 * on a Completed Case, `hidden` for every other role and every other status — so
 * in the app this Section renders only as the raiser's form. At most one Appeal
 * may be open at a time; once every Appeal is resolved a fresh one can be
 * raised, with full history kept.
 *
 * Appeal *resolution* is handled by the separate **Appeal Review** Section
 * (`cora-appeal-review`), where **Controls** agrees or rejects with a
 * rationale. Agreeing also authors a linked Amended Outcome.
 */
/**
 * @typedef {object} AppealProps
 * @property {CaseRow | null} caseRow
 * @property {'edit'|'read-only'|'hidden'} access
 * @property {QuestionDefinition[]} catalogue
 * @property {Record<string, Answer>} answers
 * @property {(input: {rationale: string, citedAnswerKeys: string[]}) => void} [onRaise]
 * @property {string} [heading] Section heading; defaults to the standard copy so the component stays usable standalone.
 */

/**
 * @param {AppealProps} props
 * @returns {Node[]}
 */
export function AppealSection(props) {
  const children = [];
  children.push(
    h('h2', {}, props.heading ?? DEFAULT_SECTION_LABELS.appealRequest.heading)
  );

  for (const appeal of appealsFrom(props)) {
    children.push(renderAppealItem(appeal));
  }

  const openAppeal = openAppealOf(props.caseRow);
  if (props.access === 'edit' && !openAppeal) {
    children.push(renderAppealForm(props));
  } else if (props.access === 'edit' && openAppeal) {
    children.push(
      h(
        'p',
        { className: 'cora-appeal-open-note' },
        'An Appeal is already open for this Case.'
      )
    );
  } else if (appealsFrom(props).length === 0) {
    children.push(renderAppealEmpty());
  }

  return children;
}

/** @param {AppealProps} props @returns {Appeal[]} */
function appealsFrom(props) {
  return props.caseRow?.appeals ?? [];
}

/** @returns {HTMLElement} */
function renderAppealEmpty() {
  return EmptyState('No Appeal has been raised.', {
    className: 'cora-appeal-empty',
  });
}

/**
 * @param {Appeal} appeal
 * @returns {HTMLElement}
 */
function renderAppealItem(appeal) {
  const children = [];
  children.push(
    h('p', { className: 'cora-appeal-state' }, `State: ${appeal.state}`)
  );
  children.push(
    h('p', { className: 'cora-appeal-item-rationale' }, appeal.rationale)
  );

  if (appeal.citedAnswerKeys?.length) {
    children.push(
      h(
        'p',
        { className: 'cora-appeal-item-cited' },
        `Disputed Answers: ${appeal.citedAnswerKeys.join(', ')}`
      )
    );
  }

  if (appeal.resolution) {
    children.push(
      h(
        'p',
        { className: 'cora-appeal-resolution' },
        `Resolution: ${appeal.resolution.verdict} — ${appeal.resolution.rationale}`
      )
    );
  }
  return h('section', { className: 'cora-appeal-item' }, children);
}

/**
 * @param {AppealProps} props
 * @returns {HTMLElement}
 */
function renderAppealForm(props) {
  const rationale = /** @type {HTMLTextAreaElement} */ (
    buildCaptureControl(
      { key: 'rationale', type: 'textarea', label: 'Appeal rationale' },
      '',
      () => {},
      'cora-appeal-rationale'
    )
  );
  rationale.setAttribute('aria-label', 'Appeal rationale');

  /** @type {HTMLInputElement[]} */
  const checkboxes = [];
  const citeWrappers = [];
  for (const q of props.catalogue.filter((q) =>
    isFailure(q, props.answers[q.id])
  )) {
    const box = /** @type {HTMLInputElement} */ (
      /** @type {unknown} */ (
        h('input', {
          type: 'checkbox',
          value: q.id,
          checked: false,
          className: 'cora-appeal-cite-input',
        })
      )
    );
    checkboxes.push(box);
    citeWrappers.push(
      h('label', { className: 'cora-appeal-cite' }, box, h('span', {}, q.text))
    );
  }

  const error = h(
    'p',
    { className: 'cora-appeal-error', hidden: true },
    'A rationale is required to raise an Appeal.'
  );

  // Introduce the disputed-Answer citations only when there are failed Answers
  // to offer — otherwise the heading would sit above an empty list.
  const citeIntro = citeWrappers.length
    ? [
        h(
          'h3',
          { className: 'cora-appeal-cite-heading' },
          'Disputed question results'
        ),
        h(
          'p',
          { className: 'cora-appeal-cite-intro' },
          'Select any question results you disagree with.'
        ),
      ]
    : [];

  return h(
    'section',
    { className: 'cora-appeal-form' },
    h('label', {}, 'Why are you appealing this outcome?'),
    rationale,
    ...citeIntro,
    ...citeWrappers,
    error,
    h(
      'button',
      {
        className: 'cora-appeal-submit',
        onclick: (/** @type {Event | undefined} */ event) => {
          const button = /** @type {HTMLElement | null} */ (
            event?.currentTarget ?? null
          );
          const form =
            button?.closest('.cora-appeal-form') ??
            /** @type {HTMLElement | null} */ (event?.target ?? null)?.closest(
              '.cora-appeal-form'
            );
          submitAppeal(
            props,
            /** @type {HTMLTextAreaElement | null} */ (
              form?.querySelector('.cora-appeal-rationale')
            ) ?? rationale,
            form
              ? /** @type {HTMLInputElement[]} */ (
                  Array.from(form.querySelectorAll('.cora-appeal-cite-input'))
                )
              : checkboxes,
            /** @type {HTMLElement | null} */ (
              form?.querySelector('.cora-appeal-error')
            ) ?? error
          );
        },
      },
      'Raise Appeal'
    )
  );
}

/**
 * @param {AppealProps} props
 * @param {{ value?: string }} rationaleEl
 * @param {Array<{ checked?: boolean, value?: string }>} checkboxes
 * @param {HTMLElement} errorEl
 */
function submitAppeal(props, rationaleEl, checkboxes, errorEl) {
  const rationale = (rationaleEl.value ?? '').trim();
  if (!rationale) {
    errorEl.hidden = false;
    return;
  }

  const citedAnswerKeys = checkboxes
    .filter((b) => b.checked)
    .map((b) => /** @type {string} */ (b.value));

  props.onRaise?.({ rationale, citedAnswerKeys });
}
