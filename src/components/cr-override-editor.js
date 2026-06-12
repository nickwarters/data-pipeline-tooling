// @ts-check
import { CRElement } from './cr-element.js';
import { isFailure, materializeRemediationActions } from '../evaluators/failure-evaluator.js';
import { classifyTransition, validateOverride, buildOverride } from '../evaluators/override-author.js';
import { effectiveAnswers } from '../evaluators/effective-answers.js';
import './cr-attribute-menu.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Override} Override */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').RemediationField} RemediationField */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../evaluators/override-author.js').OverrideDraft} OverrideDraft */
/** @typedef {{ loginName: string, displayName: string }} Party */

/**
 * The reusable **Answer Override** authoring element (issue #133, ADR-0018). A
 * **QA Reviewer** corrects a frozen Answer on a Completed Case: pick the Answer,
 * set the replacement value, and — when the value's failure status changes —
 * supply the complete replacement set of Remediation Actions (the question's
 * canned set), Attributed Party, and Remediation Details (replace, never merge).
 * Reasoning is mandatory.
 *
 * Authoring is gated upstream by section-access (the `override` Mode, resolved
 * for `qaReviewer` only on a Completed Case); this element renders the form only
 * when `access === 'override'`. A pass→fail correction re-applies the Case's
 * completion gate before it can be saved. The Override appends to the original
 * row's `overrides[]` blob via the SaveQueue (ETag-guarded, ADR-0008); the frozen
 * Answers are never touched, and the Current Outcome re-derives from the Effective
 * Answers (slice #131).
 *
 * The same element mounts on the original Case page and — as a convenience — on a
 * QA Check; `source` / `sourceCaseId` / `sourceAppealId` stamp provenance, but the
 * write always targets `caseId` (the original row).
 */
export class CROverrideEditor extends CRElement {
  constructor() {
    super();
    /** @type {CaseRow | null} */
    this.caseRow = null;
    /** @type {SaveQueue | null} */
    this.saveQueue = null;
    /** The original row id — the write target even from a QA Check surface. @type {string} */
    this.caseId = '';
    /** @type {'override' | 'read-only' | 'hidden'} */
    this.access = 'read-only';
    /** @type {CurrentUser | null} */
    this.currentUser = null;
    /** @type {QuestionDefinition[]} */
    this.catalogue = [];
    /** Whether the Case Type attributes failures to a person (ADR-0013). @type {boolean} */
    this.attributeFailures = false;
    /** The Case Type's configurable per-failure capture fields (ADR-0017). @type {RemediationField[]} */
    this.remediationFields = [];
    /** Backs the embedded people picker for the Attributed Party. @type {SharePointClient | null} */
    this.client = null;
    /**
     * The original Case Type's outcome function, re-run over the Effective Answers
     * to re-stamp the effective-outcome columns on every Override write (ADR-0019).
     * @type {((answers: Record<string, Answer>) => import('../sharepoint-client.js').OutcomeResult) | null}
     */
    this.computeOutcome = null;
    /** @type {'qa' | 'appeal'} */
    this.source = 'qa';
    /** Set when authored during a formal QA Check. @type {string | undefined} */
    this.sourceCaseId = undefined;
    /** Set when the Override resolves an Appeal. @type {string | undefined} */
    this.sourceAppealId = undefined;
    /**
     * The in-progress correction. `answerKey` empty until a Question is chosen.
     * @type {{ answerKey: string, value: string | string[], reasoning: string, attributedParty: Party | null, remediationDetails: Record<string, string> }}
     */
    this._draft = this._emptyDraft();
  }

  connectedCallback() {
    this._render();
  }

  /** @returns {{ answerKey: string, value: string | string[], reasoning: string, attributedParty: Party | null, remediationDetails: Record<string, string> }} */
  _emptyDraft() {
    return { answerKey: '', value: '', reasoning: '', attributedParty: null, remediationDetails: {} };
  }

  /** @returns {Override[]} */
  _overrides() {
    return this.caseRow?.overrides ?? [];
  }

  /** The non-deprecated Questions a correction can target. @returns {QuestionDefinition[]} */
  _targets() {
    return this.catalogue.filter((q) => !q.deprecated);
  }

  /** The Question the draft currently targets, if any. @returns {QuestionDefinition | null} */
  _question() {
    return this.catalogue.find((q) => q.id === this._draft.answerKey) ?? null;
  }

  /** Whether the current user is the original Assigned Reviewer (self-review). @returns {boolean} */
  _isSelfReview() {
    return !!this.currentUser && this.currentUser.id === this.caseRow?.assignedReviewer;
  }

  _render() {
    const heading = document.createElement('h2');
    heading.textContent = 'Answer Overrides';

    /** @type {Node[]} */
    const children = [/** @type {any} */ (heading)];

    for (const o of this._overrides()) {
      children.push(/** @type {any} */ (this._renderHistory(o)));
    }

    if (this.access === 'override') {
      if (this._isSelfReview()) {
        const warn = document.createElement('p');
        warn.className = 'cr-override-self-review';
        warn.textContent =
          'You were the Assigned Reviewer on this Case. An Override must be authored by a different QA Reviewer.';
        children.push(/** @type {any} */ (warn));
      } else {
        children.push(/** @type {any} */ (this._renderForm()));
      }
    } else if (this._overrides().length === 0) {
      const empty = document.createElement('p');
      empty.className = 'cr-override-empty';
      empty.textContent = 'No Answer Overrides.';
      children.push(/** @type {any} */ (empty));
    }

    this.replaceChildren(...children);
  }

  /**
   * @param {Override} o
   * @returns {HTMLElement}
   */
  _renderHistory(o) {
    const card = document.createElement('section');
    card.className = 'cr-override-item';

    const question = this.catalogue.find((q) => q.id === o.answerKey);
    const label = document.createElement('p');
    label.className = 'cr-override-item-question';
    label.textContent = question ? question.text : o.answerKey;
    card.appendChild(label);

    const value = document.createElement('p');
    value.className = 'cr-override-item-value';
    value.textContent = `Corrected to: ${formatValue(o.value)}`;
    card.appendChild(value);

    const reasoning = document.createElement('p');
    reasoning.className = 'cr-override-item-reasoning';
    reasoning.textContent = o.reasoning;
    card.appendChild(reasoning);

    return card;
  }

  /** @returns {HTMLElement} */
  _renderForm() {
    const form = document.createElement('section');
    form.className = 'cr-override-form';

    // Question picker.
    const qLabel = document.createElement('label');
    qLabel.textContent = 'Which Answer is being corrected?';
    form.appendChild(qLabel);

    const qSelect = /** @type {any} */ (document.createElement('select'));
    qSelect.className = 'cr-override-question';
    qSelect.appendChild(buildOption('', '— choose a Question —'));
    for (const q of this._targets()) {
      qSelect.appendChild(buildOption(q.id, q.text));
    }
    qSelect.value = this._draft.answerKey;
    qSelect.addEventListener('change', (/** @type {any} */ e) => this._onQuestion(e.target.value));
    form.appendChild(qSelect);

    const question = this._question();
    if (question) {
      this._renderValueControl(form, question);

      // The failure sub-form only appears when the replacement value is itself a
      // failure (pass→fail or fail→fail): that is when a complete replacement set
      // of attribution / details is required.
      if (isFailure(question, { value: this._draft.value })) {
        this._renderFailureBlock(form, question);
      }
    }

    // Reasoning — always required.
    const rLabel = document.createElement('label');
    rLabel.textContent = 'Reasoning';
    form.appendChild(rLabel);

    const reasoning = /** @type {any} */ (document.createElement('textarea'));
    reasoning.className = 'cr-override-reasoning';
    reasoning.setAttribute('aria-label', 'Override reasoning');
    reasoning.value = this._draft.reasoning;
    reasoning.addEventListener('input', (/** @type {any} */ e) => { this._draft.reasoning = e.target.value; });
    form.appendChild(reasoning);

    const error = document.createElement('ul');
    error.className = 'cr-override-error';
    error.hidden = true;
    form.appendChild(error);

    const submit = document.createElement('button');
    submit.className = 'cr-override-submit';
    submit.textContent = 'Save Override';
    submit.addEventListener('click', () => this._submit(error));
    form.appendChild(submit);

    return form;
  }

  /**
   * @param {HTMLElement} form
   * @param {QuestionDefinition} question
   */
  _renderValueControl(form, question) {
    const label = document.createElement('label');
    label.textContent = 'Replacement value';
    form.appendChild(label);

    const select = /** @type {any} */ (document.createElement('select'));
    select.className = 'cr-override-value-control';
    for (const opt of optionsFor(question)) {
      select.appendChild(buildOption(opt, opt));
    }
    select.value = /** @type {string} */ (this._draft.value);
    select.addEventListener('change', (/** @type {any} */ e) => this._onValue(e.target.value));
    form.appendChild(select);
  }

  /**
   * The pass→fail / fail→fail capture surface: Attributed Party (when the Case
   * Type attributes failures) and the configurable Remediation Details.
   * @param {HTMLElement} form
   * @param {QuestionDefinition} question
   */
  _renderFailureBlock(form, question) {
    const block = document.createElement('div');
    block.className = 'cr-override-failure';

    if (this.attributeFailures) {
      const menu = /** @type {any} */ (document.createElement('cr-attribute-menu'));
      menu.className = 'cr-override-attribute';
      menu.client = this.client;
      menu.attributedParty = this._draft.attributedParty;
      menu.responsibleParty = this.caseRow?.responsibleParty
        ? { loginName: this.caseRow.responsibleParty, displayName: this.caseRow.responsibleParty }
        : null;
      menu.addEventListener('cr-attribute-change', (/** @type {any} */ ev) => {
        this._draft.attributedParty = ev.detail.attributedParty;
        this._render();
      });
      block.appendChild(menu);
    }

    for (const field of this.remediationFields) {
      const wrap = document.createElement('div');
      wrap.className = 'cr-override-detail-field';

      const label = document.createElement('label');
      label.textContent = field.required ? `${field.label} (required)` : field.label;
      wrap.appendChild(label);

      const control = this._buildDetailControl(field);
      control.className = `cr-override-detail-${field.key}`;
      control.addEventListener('change', (/** @type {any} */ e) => this._onDetail(field.key, e.target.value));
      wrap.appendChild(control);
      block.appendChild(wrap);
    }

    form.appendChild(block);
  }

  /**
   * @param {RemediationField} field
   * @returns {any}
   */
  _buildDetailControl(field) {
    const current = this._draft.remediationDetails[field.key] ?? '';
    if (field.type === 'select') {
      const select = /** @type {any} */ (document.createElement('select'));
      select.appendChild(buildOption('', '—'));
      for (const opt of field.options ?? []) select.appendChild(buildOption(opt, opt));
      select.value = current;
      return select;
    }
    const input = /** @type {any} */ (document.createElement('input'));
    input.type = 'text';
    input.value = current;
    return input;
  }

  /** @param {string} answerKey */
  _onQuestion(answerKey) {
    const original = this.caseRow?.answers[answerKey]?.value ?? '';
    this._draft = { ...this._emptyDraft(), answerKey, value: original, reasoning: this._draft.reasoning };
    this._render();
  }

  /** @param {string} value */
  _onValue(value) {
    this._draft.value = value;
    // Leaving a failing value drops any captured failure metadata so a re-pass
    // never carries stale attribution/details.
    const question = this._question();
    if (question && !isFailure(question, { value })) {
      this._draft.attributedParty = null;
      this._draft.remediationDetails = {};
    }
    this._render();
  }

  /** @param {string} key @param {string} value */
  _onDetail(key, value) {
    if (value === '') delete this._draft.remediationDetails[key];
    else this._draft.remediationDetails[key] = value;
  }

  /** @param {HTMLElement} errorEl */
  _submit(errorEl) {
    const question = this._question();
    if (!question) return;

    const failing = isFailure(question, { value: this._draft.value });

    /** @type {OverrideDraft} */
    const draft = {
      answerKey: question.id,
      value: this._draft.value,
      reasoning: this._draft.reasoning,
    };
    if (failing) {
      if (this._draft.attributedParty) draft.attributedParty = this._draft.attributedParty;
      if (Object.keys(this._draft.remediationDetails).length) {
        draft.remediationDetails = { ...this._draft.remediationDetails };
      }
      const actions = materializeRemediationActions(question, { value: this._draft.value }).remediationActions;
      if (actions) draft.remediationActions = actions;
    }

    const originalAnswer = this.caseRow?.answers[question.id];
    const errors = validateOverride(draft, {
      question,
      originalAnswer,
      attributeFailures: this.attributeFailures,
      remediationFields: this.remediationFields,
    });
    if (errors.length) {
      this._showErrors(errorEl, errors);
      return;
    }

    const override = buildOverride(draft, {
      question,
      originalAnswer,
      attributeFailures: this.attributeFailures,
      remediationFields: this.remediationFields,
      author: this.currentUser?.id ?? '',
      at: new Date().toISOString(),
      source: this.source,
      sourceCaseId: this.sourceCaseId,
      sourceAppealId: this.sourceAppealId,
    });

    const next = [...this._overrides(), override];
    if (this.caseRow) {
      this.caseRow.overrides = next;

      // Re-stamp the effective-outcome columns in the *same* write that appends to
      // overrides[] (ADR-0019): re-derive the Current Outcome over the Effective
      // Answers and flag the Case as overridden. One atomic ETag-guarded PATCH
      // (ADR-0008) so overrides[] and the columns can never desync — including on
      // the cross-row write path, since `caseId` is the original row throughout.
      const compute = this.computeOutcome ?? (() => /** @type {any} */ ({ verdict: 'pass' }));
      const effective = effectiveAnswers(this.caseRow.answers, next);
      this.saveQueue?.enqueueFields(this.caseId, {
        overrides: next,
        effectiveOutcome: compute(effective).verdict,
        effectiveHadRemediation: Object.values(effective).some(
          (a) => (a.remediationActions?.length ?? 0) > 0
        ),
        outcomeOverridden: next.length > 0,
      });
    }
    this._draft = this._emptyDraft();
    this._render();
  }

  /**
   * @param {HTMLElement} errorEl
   * @param {string[]} errors
   */
  _showErrors(errorEl, errors) {
    errorEl.hidden = false;
    /** @type {Node[]} */
    const items = errors.map((e) => {
      const li = document.createElement('li');
      li.textContent = e;
      return /** @type {any} */ (li);
    });
    errorEl.replaceChildren(...items);
  }
}

/**
 * The selectable replacement values for a Question. yes-no-na is the implicit
 * tri-state; single/multi-choice draw on the Question's declared options.
 * @param {QuestionDefinition} question
 * @returns {string[]}
 */
function optionsFor(question) {
  if (question.responseType === 'yes-no-na') return ['Yes', 'No', 'N/A'];
  return question.options ?? [];
}

/**
 * @param {string | string[] | undefined} value
 * @returns {string}
 */
function formatValue(value) {
  if (value === undefined) return '—';
  return Array.isArray(value) ? value.join(', ') : value;
}

/**
 * @param {string} value
 * @param {string} text
 * @returns {any}
 */
function buildOption(value, text) {
  const option = /** @type {any} */ (document.createElement('option'));
  option.value = value;
  option.textContent = text;
  return option;
}

customElements.define('cr-override-editor', CROverrideEditor);
