// @ts-check
import { CRElement } from './cr-element.js';
import { isFailure } from '../evaluators/failure-evaluator.js';
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
export class CRAppeal extends CRElement {
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
    this._render();
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
    const heading = document.createElement('h2');
    heading.textContent = 'Appeal';

    /** @type {Node[]} */
    const children = [/** @type {any} */ (heading)];

    // History first — every Appeal already on the Case, readable by any role that
    // can see the Section at all.
    for (const appeal of this._appeals()) {
      children.push(/** @type {any} */ (this._renderAppeal(appeal)));
    }

    const openAppeal = this._openAppeal();
    if (this.access === 'edit' && this.canResolve) {
      // QA Reviewer (issue #134): resolve the single open Appeal. With an agreed
      // verdict the corrective Override editor is revealed below the form.
      if (openAppeal) {
        children.push(/** @type {any} */ (this._renderResolveForm(openAppeal)));
      } else if (this._appeals().length === 0) {
        children.push(/** @type {any} */ (this._renderEmpty()));
      }
      if (this._authoringAppealId) {
        children.push(/** @type {any} */ (this._buildOverrideEditor()));
      }
    } else if (this.access === 'edit' && !openAppeal) {
      // Appellant on a Completed Case with no open Appeal — offer the raise form.
      children.push(/** @type {any} */ (this._renderForm()));
    } else if (this.access === 'edit' && openAppeal) {
      // An Appeal is already in flight; block a second one until it resolves.
      const note = document.createElement('p');
      note.className = 'cr-appeal-open-note';
      note.textContent = 'An Appeal is already open for this Case.';
      children.push(/** @type {any} */ (note));
    } else if (this._appeals().length === 0) {
      // Read-only viewers see a placeholder when there is nothing to show.
      children.push(/** @type {any} */ (this._renderEmpty()));
    }

    this.replaceChildren(...children);
  }

  /** @returns {HTMLElement} */
  _renderEmpty() {
    const empty = document.createElement('p');
    empty.className = 'cr-appeal-empty';
    empty.textContent = 'No Appeal has been raised.';
    return empty;
  }

  /**
   * @param {Appeal} appeal
   * @returns {HTMLElement}
   */
  _renderAppeal(appeal) {
    const card = document.createElement('section');
    card.className = 'cr-appeal-item';

    const state = document.createElement('p');
    state.className = 'cr-appeal-state';
    state.textContent = `State: ${appeal.state}`;
    card.appendChild(state);

    const rationale = document.createElement('p');
    rationale.className = 'cr-appeal-item-rationale';
    // textContent, never innerHTML (framework hard rule).
    rationale.textContent = appeal.rationale;
    card.appendChild(rationale);

    if (appeal.citedAnswerKeys?.length) {
      const cited = document.createElement('p');
      cited.className = 'cr-appeal-item-cited';
      cited.textContent = `Disputed Answers: ${appeal.citedAnswerKeys.join(', ')}`;
      card.appendChild(cited);
    }

    // Once resolved, show the QA Reviewer's verdict and rationale (issue #134).
    if (appeal.resolution) {
      const resolution = document.createElement('p');
      resolution.className = 'cr-appeal-resolution';
      resolution.textContent = `Resolution: ${appeal.resolution.verdict} — ${appeal.resolution.rationale}`;
      card.appendChild(resolution);
    }
    return card;
  }

  /** @returns {HTMLElement} */
  _renderForm() {
    const form = document.createElement('section');
    form.className = 'cr-appeal-form';

    const label = document.createElement('label');
    label.textContent = 'Why are you appealing this outcome?';
    form.appendChild(label);

    const rationale = /** @type {HTMLTextAreaElement} */ (/** @type {unknown} */ (document.createElement('textarea')));
    /** @type {any} */ (rationale).className = 'cr-appeal-rationale';
    /** @type {any} */ (rationale).setAttribute('aria-label', 'Appeal rationale');
    form.appendChild(/** @type {any} */ (rationale));

    // Optional citations: the disputed *failed* Answers. Checking one records its
    // Answer key on the Appeal; it never changes the Answer's value.
    /** @type {any[]} */
    const checkboxes = [];
    for (const q of this.catalogue.filter((q) => isFailure(q, this.answers[q.id]))) {
      const wrapper = document.createElement('label');
      wrapper.className = 'cr-appeal-cite';

      const box = document.createElement('input');
      box.setAttribute('type', 'checkbox');
      /** @type {any} */ (box).value = q.id;
      /** @type {any} */ (box).checked = false;

      const text = document.createElement('span');
      text.textContent = q.text;

      wrapper.appendChild(box);
      wrapper.appendChild(text);
      form.appendChild(wrapper);
      checkboxes.push(box);
    }

    const error = document.createElement('p');
    error.className = 'cr-appeal-error';
    error.hidden = true;
    error.textContent = 'A rationale is required to raise an Appeal.';
    form.appendChild(error);

    const submit = document.createElement('button');
    submit.className = 'cr-appeal-submit';
    submit.textContent = 'Raise Appeal';
    submit.addEventListener('click', () => this._raise(rationale, checkboxes, error));
    form.appendChild(submit);

    return form;
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
    const form = document.createElement('section');
    form.className = 'cr-appeal-resolve';

    const label = document.createElement('label');
    label.textContent = 'How are you resolving this Appeal?';
    form.appendChild(label);

    const rationale = /** @type {any} */ (document.createElement('textarea'));
    rationale.className = 'cr-appeal-resolution-rationale';
    rationale.setAttribute('aria-label', 'Resolution rationale');
    form.appendChild(rationale);

    const error = document.createElement('p');
    error.className = 'cr-appeal-resolution-error';
    error.hidden = true;
    error.textContent = 'A rationale is required to resolve an Appeal.';
    form.appendChild(error);

    const reject = document.createElement('button');
    reject.className = 'cr-appeal-reject';
    reject.textContent = 'Reject Appeal';
    reject.addEventListener('click', () => this._resolve(appeal, 'rejected', rationale, error));
    form.appendChild(reject);

    const agree = document.createElement('button');
    agree.className = 'cr-appeal-agree';
    agree.textContent = 'Agree with Appeal';
    agree.addEventListener('click', () => this._resolve(appeal, 'agreed', rationale, error));
    form.appendChild(agree);

    return form;
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
    const editor = /** @type {any} */ (document.createElement('cr-override-editor'));
    editor.caseRow = this.caseRow;
    editor.saveQueue = this.saveQueue;
    editor.caseId = this.caseId;
    editor.access = 'override';
    editor.currentUser = this.currentUser;
    editor.catalogue = this.catalogue;
    editor.attributeFailures = this.attributeFailures;
    editor.remediationFields = this.remediationFields;
    editor.computeOutcome = this.computeOutcome;
    editor.client = this.client;
    editor.source = 'appeal';
    editor.sourceAppealId = this._authoringAppealId;
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
