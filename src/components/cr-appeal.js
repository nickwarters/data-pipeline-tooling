// @ts-check
import { ShellElement } from '../lib/view.js';
import { h } from '../lib/html.js';
import { isFailure } from '../evaluators/failure-evaluator.js';
import { buildCaptureControl } from '../lib/capture-engine.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').Appeal} Appeal */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */

/**
 * The Appeal Section (issue #132). Lets the Responsible Party or their Manager
 * raise a case-level **Appeal** objecting to a Completed Case's Current Outcome
 * (CONTEXT.md). The Appeal is additive: it appends to the Case row's `appeals[]`
 * JSON blob via the SaveQueue (ADR-0007, ADR-0008) and never touches the frozen
 * Answers — citing a disputed Answer aims the reviewer but sets no value.
 *
 * Access is resolved upstream (section-access, ADR-0011): `edit` only for the
 * appellant roles on a Completed Case, otherwise `read-only` (reviewers/owner/
 * Controls) or the Section is not rendered at all. At most one Appeal may be open
 * at a time; once every Appeal is resolved a fresh one can be raised, with full
 * history kept.
 *
 * Appeal *resolution* is parked (ADR-0026 retires the QA Reviewer + Answer
 * Override machinery this Section used to resolve through). Under ADR-0027 the
 * resolver becomes Controls via a dedicated Appeal Review tab; that flow — and
 * the corrective Amend Outcome it drives — is rebuilt in a later slice. For now
 * this Section only raises and displays Appeals read-only.
 */
/**
 * @typedef {object} AppealProps
 * @property {CaseRow | null} caseRow
 * @property {SaveQueue | null} saveQueue
 * @property {string} caseId
 * @property {'edit'|'read-only'|'hidden'} access
 * @property {CurrentUser | null} currentUser
 * @property {QuestionDefinition[]} catalogue
 * @property {Record<string, Answer>} answers
 * @property {() => string} newAppealId
 * @property {() => void} render
 */

/**
 * @param {AppealProps} props
 * @returns {Node[]}
 */
export function AppealSection(props) {
  const children = [];
  children.push(h('h2', {}, 'Appeal'));

  for (const appeal of appealsFrom(props)) {
    children.push(renderAppealItem(appeal));
  }

  const openAppeal = openAppealFrom(props);
  if (props.access === 'edit' && !openAppeal) {
    children.push(renderAppealForm(props));
  } else if (props.access === 'edit' && openAppeal) {
    children.push(
      h(
        'p',
        { className: 'cr-appeal-open-note' },
        'An Appeal is already open for this Case.'
      )
    );
  } else if (appealsFrom(props).length === 0) {
    children.push(renderAppealEmpty());
  }

  return children;
}

/** @param {AppealProps} props @returns {Appeal[]} */
export function appealsFrom(props) {
  return props.caseRow?.appeals ?? [];
}

/** @param {AppealProps} props @returns {Appeal | null} */
export function openAppealFrom(props) {
  return appealsFrom(props).find((a) => a.state !== 'resolved') ?? null;
}

/** @returns {HTMLElement} */
export function renderAppealEmpty() {
  return h('p', { className: 'cr-appeal-empty' }, 'No Appeal has been raised.');
}

/**
 * @param {Appeal} appeal
 * @returns {HTMLElement}
 */
export function renderAppealItem(appeal) {
  const children = [];
  children.push(
    h('p', { className: 'cr-appeal-state' }, `State: ${appeal.state}`)
  );
  children.push(
    h('p', { className: 'cr-appeal-item-rationale' }, appeal.rationale)
  );

  if (appeal.citedAnswerKeys?.length) {
    children.push(
      h(
        'p',
        { className: 'cr-appeal-item-cited' },
        `Disputed Answers: ${appeal.citedAnswerKeys.join(', ')}`
      )
    );
  }

  if (appeal.resolution) {
    children.push(
      h(
        'p',
        { className: 'cr-appeal-resolution' },
        `Resolution: ${appeal.resolution.verdict} — ${appeal.resolution.rationale}`
      )
    );
  }
  return h('section', { className: 'cr-appeal-item' }, children);
}

/**
 * @param {AppealProps} props
 * @returns {HTMLElement}
 */
export function renderAppealForm(props) {
  const rationale = /** @type {HTMLTextAreaElement} */ (
    buildCaptureControl(
      { key: 'rationale', type: 'textarea', label: 'Appeal rationale' },
      '',
      () => {},
      'cr-appeal-rationale'
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
        h('input', { type: 'checkbox', value: q.id, checked: false })
      )
    );
    checkboxes.push(box);
    citeWrappers.push(
      h('label', { className: 'cr-appeal-cite' }, box, h('span', {}, q.text))
    );
  }

  const error = h(
    'p',
    { className: 'cr-appeal-error', hidden: true },
    'A rationale is required to raise an Appeal.'
  );

  return h(
    'section',
    { className: 'cr-appeal-form' },
    h('label', {}, 'Why are you appealing this outcome?'),
    rationale,
    ...citeWrappers,
    error,
    h(
      'button',
      {
        className: 'cr-appeal-submit',
        onClick: () => raiseAppeal(props, rationale, checkboxes, error),
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
export function raiseAppeal(props, rationaleEl, checkboxes, errorEl) {
  const rationale = (rationaleEl.value ?? '').trim();
  if (!rationale) {
    errorEl.hidden = false;
    return;
  }

  const citedAnswerKeys = checkboxes
    .filter((b) => b.checked)
    .map((b) => /** @type {string} */ (b.value));

  /** @type {Appeal} */
  const appeal = {
    id: props.newAppealId(),
    appellant: props.currentUser?.id ?? '',
    at: new Date().toISOString(),
    rationale,
    state: 'raised',
  };
  if (citedAnswerKeys.length) appeal.citedAnswerKeys = citedAnswerKeys;

  const next = [...appealsFrom(props), appeal];
  if (props.caseRow) props.caseRow.appeals = next;
  props.saveQueue?.enqueue(props.caseId, 'appeals', next);
  props.render();
}

export class CRAppeal extends ShellElement {
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
     * The Case Type's non-deprecated Question catalogue plus the current Answers,
     * used to offer the disputed *failed* Answers as optional citations.
     * @type {QuestionDefinition[]}
     */
    this.catalogue = [];
    /** @type {Record<string, Answer>} */
    this.answers = {};
  }

  _render() {
    this.replaceChildren(...this.render());
  }

  render() {
    return AppealSection(this._props());
  }

  /**
   * A locally-unique Appeal id. Overridable seam; the default is sufficient since
   * Appeals are appended one at a time per Case.
   * @returns {string}
   */
  newAppealId() {
    return `appeal-${Date.now()}`;
  }

  /** @returns {AppealProps} */
  _props() {
    return {
      caseRow: this.caseRow,
      saveQueue: this.saveQueue,
      caseId: this.caseId,
      access: this.access,
      currentUser: this.currentUser,
      catalogue: this.catalogue,
      answers: this.answers,
      newAppealId: () => this.newAppealId(),
      render: () => this._render(),
    };
  }
}

customElements.define('cr-appeal', CRAppeal);
