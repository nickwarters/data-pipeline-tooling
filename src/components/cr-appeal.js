// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import { isFailure } from '../evaluators/failure-evaluator.js';
import { buildCaptureControl } from '../lib/capture-engine.js';
import './cr-override-editor.js';

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
 * appellant roles on a Completed Case, otherwise `read-only` (reviewers/owner) or
 * the Section is not rendered at all. At most one Appeal may be open at a time;
 * once every Appeal is resolved a fresh one can be raised, with full history kept.
 */
export class CRAppeal extends ReactiveElement {
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
    /**
     * Whether the viewer is a QA Reviewer who may *resolve* the open Appeal
     * (issue #134), as opposed to an appellant who *raises* one. Both hold `edit`
     * on a Completed Case, so this flag selects the resolution form over the raise
     * form.
     * @type {boolean}
     */
    this.canResolve = false;
    /**
     * Set to the Appeal id once the QA Reviewer *agrees* with it, which reveals
     * the corrective Override editor (stamped `source: 'appeal'`). Transient
     * authoring state, not persisted.
     * @type {string | null}
     */
    this._authoringAppealId = null;
    /** Whether the Case Type attributes failures to a person (ADR-0013). @type {boolean} */
    this.attributeFailures = false;
    /** The Case Type's configurable per-failure capture fields (ADR-0017). @type {import('../sharepoint-client.js').RemediationField[]} */
    this.remediationFields = [];
    /** Backs the embedded Override editor's people picker. @type {import('../sharepoint-client.js').SharePointClient | null} */
    this.client = null;
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
    /**
     * The Case Type's outcome function, forwarded to the corrective Override
     * editor so an Appeal-sourced Override re-stamps the effective-outcome
     * columns (ADR-0019).
     * @type {((answers: Record<string, Answer>) => import('../sharepoint-client.js').OutcomeResult) | null}
     */
    this.computeOutcome = null;
  }

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  /** @returns {Appeal[]} */
  _appeals() {
    return this.caseRow?.appeals ?? [];
  }

  /**
   * The single open Appeal, if any. An Appeal is open until `resolved`; CONTEXT.md
   * caps the Case at one open Appeal at a time.
   * @returns {Appeal | null}
   */
  _openAppeal() {
    return this._appeals().find((a) => a.state !== 'resolved') ?? null;
  }

  _render() {
    const content = this.render();
    if (content) {
      if (Array.isArray(content)) this.replaceChildren(...content);
      else this.replaceChildren(content);
    } else {
      this.replaceChildren();
    }
  }

  render() {
    const children = [];
    children.push(h('h2', {}, 'Appeal'));

    for (const appeal of this._appeals()) {
      children.push(this._renderAppeal(appeal));
    }

    const openAppeal = this._openAppeal();
    if (this.access === 'edit' && this.canResolve) {
      if (openAppeal) {
        children.push(this._renderResolveForm(openAppeal));
      } else if (this._appeals().length === 0) {
        children.push(this._renderEmpty());
      }
      if (this._authoringAppealId) {
        children.push(this._buildOverrideEditor());
      }
    } else if (this.access === 'edit' && !openAppeal) {
      children.push(this._renderForm());
    } else if (this.access === 'edit' && openAppeal) {
      children.push(h('p', { className: 'cr-appeal-open-note' }, 'An Appeal is already open for this Case.'));
    } else if (this._appeals().length === 0) {
      children.push(this._renderEmpty());
    }

    return children;
  }

  /** @returns {HTMLElement} */
  _renderEmpty() {
    return h('p', { className: 'cr-appeal-empty' }, 'No Appeal has been raised.');
  }

  /**
   * @param {Appeal} appeal
   * @returns {HTMLElement}
   */
  _renderAppeal(appeal) {
    const children = [];
    children.push(h('p', { className: 'cr-appeal-state' }, `State: ${appeal.state}`));
    children.push(h('p', { className: 'cr-appeal-item-rationale' }, appeal.rationale));

    if (appeal.citedAnswerKeys?.length) {
      children.push(h('p', { className: 'cr-appeal-item-cited' }, `Disputed Answers: ${appeal.citedAnswerKeys.join(', ')}`));
    }

    if (appeal.resolution) {
      children.push(h('p', { className: 'cr-appeal-resolution' }, `Resolution: ${appeal.resolution.verdict} — ${appeal.resolution.rationale}`));
    }
    return h('section', { className: 'cr-appeal-item' }, children);
  }

  /** @returns {HTMLElement} */
  _renderForm() {
    const rationale = /** @type {HTMLTextAreaElement} */ (buildCaptureControl(
      { key: 'rationale', type: 'textarea', label: 'Appeal rationale' },
      '',
      () => {},
      'cr-appeal-rationale'
    ));
    rationale.setAttribute('aria-label', 'Appeal rationale');
    
    /** @type {HTMLInputElement[]} */
    const checkboxes = [];
    const citeWrappers = [];
    for (const q of this.catalogue.filter((q) => isFailure(q, this.answers[q.id]))) {
      const box = /** @type {HTMLInputElement} */ (/** @type {unknown} */ (h('input', { type: 'checkbox', value: q.id, checked: false })));
      checkboxes.push(box);
      citeWrappers.push(h('label', { className: 'cr-appeal-cite' }, box, h('span', {}, q.text)));
    }

    const error = h('p', { className: 'cr-appeal-error', hidden: true }, 'A rationale is required to raise an Appeal.');

    return h('section', { className: 'cr-appeal-form' },
      h('label', {}, 'Why are you appealing this outcome?'),
      rationale,
      ...citeWrappers,
      error,
      h('button', {
        className: 'cr-appeal-submit',
        onClick: () => this._raise(rationale, checkboxes, error)
      }, 'Raise Appeal')
    );
  }

  /**
   * Validate, build the `raised` Appeal, and persist it additively via the
   * SaveQueue (field-level PATCH of `appeals`, ETag-guarded by the queue).
   *
   * @param {{ value?: string }} rationaleEl
   * @param {Array<{ checked?: boolean, value?: string }>} checkboxes
   * @param {HTMLElement} errorEl
   */
  _raise(rationaleEl, checkboxes, errorEl) {
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
      id: this.newAppealId(),
      appellant: this.currentUser?.id ?? '',
      at: new Date().toISOString(),
      rationale,
      state: 'raised',
    };
    if (citedAnswerKeys.length) appeal.citedAnswerKeys = citedAnswerKeys;

    const next = [...this._appeals(), appeal];
    // Keep the local row in step so a re-render reflects the new open Appeal
    // without a refetch.
    if (this.caseRow) this.caseRow.appeals = next;
    this.saveQueue?.enqueue(this.caseId, 'appeals', next);
    this._render();
  }

  /**
   * The QA Reviewer's resolution form for the single open Appeal (issue #134): a
   * required resolver rationale plus the two verdicts. **Reject** records the
   * rationale and changes nothing; **Agree** records it and reveals the corrective
   * Override editor. The appellant's requested value is never auto-adopted —
   * agreement is the QA Reviewer's correction as they see fit (ADR-0018).
   *
   * @param {Appeal} appeal
   * @returns {HTMLElement}
   */
  _renderResolveForm(appeal) {
    const rationale = /** @type {HTMLTextAreaElement} */ (buildCaptureControl(
      { key: 'rationale', type: 'textarea', label: 'Resolution rationale' },
      '',
      () => {},
      'cr-appeal-resolution-rationale'
    ));
    rationale.setAttribute('aria-label', 'Resolution rationale');
    const error = h('p', { className: 'cr-appeal-resolution-error', hidden: true }, 'A rationale is required to resolve an Appeal.');

    return h('section', { className: 'cr-appeal-resolve' },
      h('label', {}, 'How are you resolving this Appeal?'),
      rationale,
      error,
      h('button', {
        className: 'cr-appeal-reject',
        onClick: () => this._resolve(appeal, 'rejected', rationale, error)
      }, 'Reject Appeal'),
      h('button', {
        className: 'cr-appeal-agree',
        onClick: () => this._resolve(appeal, 'agreed', rationale, error)
      }, 'Agree with Appeal')
    );
  }

  /**
   * Validate the resolver rationale, stamp the verdict onto the Appeal, and
   * persist `appeals` additively (ETag-guarded by the SaveQueue, ADR-0008). The
   * frozen original Case is never touched: a **Reject** leaves the Current Outcome
   * unchanged, and an **Agree** authorises a separate corrective Override rather
   * than mutating anything here.
   *
   * @param {Appeal} appeal
   * @param {'agreed' | 'rejected'} verdict
   * @param {{ value?: string }} rationaleEl
   * @param {HTMLElement} errorEl
   */
  _resolve(appeal, verdict, rationaleEl, errorEl) {
    const rationale = (rationaleEl.value ?? '').trim();
    if (!rationale) {
      errorEl.hidden = false;
      return;
    }

    appeal.state = 'resolved';
    appeal.resolution = {
      verdict,
      rationale,
      resolver: this.currentUser?.id ?? '',
      at: new Date().toISOString(),
    };

    const next = [...this._appeals()];
    if (this.caseRow) this.caseRow.appeals = next;
    this.saveQueue?.enqueue(this.caseId, 'appeals', next);

    // An agreed Appeal links to the Override(s) it produces via `sourceAppealId`;
    // reveal the editor stamped accordingly.
    this._authoringAppealId = verdict === 'agreed' ? appeal.id : null;
    this._render();
  }

  /**
   * The reusable Answer Override editor (slice #133) configured to author the
   * corrective Override(s) for an agreed Appeal: `source: 'appeal'` plus the
   * `sourceAppealId` back-link. Writes target the original row's `overrides[]`.
   * @returns {HTMLElement}
   */
  _buildOverrideEditor() {
    const editor = h('cr-override-editor');
    const ed = /** @type {any} */ (editor);
    ed.caseRow = this.caseRow;
    ed.saveQueue = this.saveQueue;
    ed.caseId = this.caseId;
    ed.access = 'override';
    ed.currentUser = this.currentUser;
    ed.catalogue = this.catalogue;
    ed.attributeFailures = this.attributeFailures;
    ed.remediationFields = this.remediationFields;
    ed.computeOutcome = this.computeOutcome;
    ed.client = this.client;
    ed.source = 'appeal';
    ed.sourceAppealId = this._authoringAppealId;
    return editor;
  }

  /**
   * A locally-unique Appeal id. Overridable seam; the default is sufficient since
   * Appeals are appended one at a time per Case.
   * @returns {string}
   */
  newAppealId() {
    return `appeal-${Date.now()}`;
  }
}

customElements.define('cr-appeal', CRAppeal);
