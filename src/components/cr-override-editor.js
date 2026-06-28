// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import {
  isFailure,
  materializeRemediationActions,
} from '../evaluators/failure-evaluator.js';
import {
  classifyTransition,
  validateOverride,
  buildOverride,
} from '../evaluators/override-author.js';
import { effectiveAnswers } from '../evaluators/effective-answers.js';
import { buildCaptureControl } from '../lib/capture-engine.js';
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
/**
 * @typedef {object} OverrideRenderProps
 * @property {CaseRow | null} caseRow
 * @property {'override' | 'read-only' | 'hidden'} access
 * @property {CurrentUser | null} currentUser
 * @property {QuestionDefinition[]} catalogue
 * @property {boolean} attributeFailures
 * @property {RemediationField[]} remediationFields
 * @property {SharePointClient | null} client
 * @property {{ answerKey: string, value: string | string[], reasoning: string, attributedParty: Party | null, remediationDetails: Record<string, string> }} draft
 * @property {(answerKey: string) => void} onQuestion
 * @property {(value: string) => void} onValue
 * @property {(key: string, value: string) => void} onDetail
 * @property {(party: Party | null) => void} onAttribute
 * @property {(errorEl: HTMLElement) => void} submit
 */

/**
 * @param {OverrideRenderProps} props
 * @returns {Node[]}
 */
export function OverrideEditor(props) {
  const heading = h('h2', {}, 'Answer Overrides');

  /** @type {any[]} */
  const children = [heading];

  for (const o of overridesFrom(props)) {
    children.push(renderOverrideHistory(props, o));
  }

  if (props.access === 'override') {
    if (isSelfReview(props)) {
      children.push(
        h(
          'p',
          { class: 'cr-override-self-review' },
          'You were the Assigned Reviewer on this Case. An Override must be authored by a different QA Reviewer.'
        )
      );
    } else {
      children.push(renderOverrideForm(props));
    }
  } else if (overridesFrom(props).length === 0) {
    children.push(
      h('p', { class: 'cr-override-empty' }, 'No Answer Overrides.')
    );
  }

  return children;
}

/** @param {OverrideRenderProps} props @returns {Override[]} */
export function overridesFrom(props) {
  return props.caseRow?.overrides ?? [];
}

/** @param {OverrideRenderProps} props @returns {QuestionDefinition[]} */
export function overrideTargets(props) {
  return props.catalogue.filter((q) => !q.deprecated);
}

/** @param {OverrideRenderProps} props @returns {QuestionDefinition | null} */
export function overrideQuestion(props) {
  return props.catalogue.find((q) => q.id === props.draft.answerKey) ?? null;
}

/** @param {OverrideRenderProps} props @returns {boolean} */
export function isSelfReview(props) {
  return (
    !!props.currentUser &&
    props.currentUser.id === props.caseRow?.assignedReviewer
  );
}

/**
 * @param {OverrideRenderProps} props
 * @param {Override} o
 * @returns {HTMLElement}
 */
export function renderOverrideHistory(props, o) {
  const question = props.catalogue.find((q) => q.id === o.answerKey);
  return h(
    'section',
    { class: 'cr-override-item' },
    h(
      'p',
      { class: 'cr-override-item-question' },
      question ? question.text : o.answerKey
    ),
    h(
      'p',
      { class: 'cr-override-item-value' },
      `Corrected to: ${formatValue(o.value)}`
    ),
    h('p', { class: 'cr-override-item-reasoning' }, o.reasoning)
  );
}

/**
 * @param {OverrideRenderProps} props
 * @returns {HTMLElement}
 */
export function renderOverrideForm(props) {
  const qSelect = /** @type {any} */ (
    h(
      'select',
      {
        class: 'cr-override-question',
        onchange: (/** @type {any} */ e) => props.onQuestion(e.target.value),
      },
      buildOption('', '— choose a Question —'),
      ...overrideTargets(props).map((q) => buildOption(q.id, q.text))
    )
  );
  qSelect.value = props.draft.answerKey;

  const question = overrideQuestion(props);
  let valueControl = null;
  let failureBlock = null;

  if (question) {
    valueControl = renderOverrideValueControl(props, question);

    if (isFailure(question, { value: props.draft.value })) {
      failureBlock = renderOverrideFailureBlock(props, question);
    }
  }

  const errorEl = h('ul', { class: 'cr-override-error', hidden: true });

  const reasoningEl = buildCaptureControl(
    { key: 'reasoning', type: 'textarea', label: 'Reasoning' },
    props.draft.reasoning,
    (value) => {
      props.draft.reasoning = value;
    },
    'cr-override-reasoning'
  );
  reasoningEl.setAttribute('aria-label', 'Override reasoning');

  return h(
    'section',
    { class: 'cr-override-form' },
    h('label', {}, 'Which Answer is being corrected?'),
    qSelect,
    valueControl,
    failureBlock,
    h('label', {}, 'Reasoning'),
    reasoningEl,
    errorEl,
    h(
      'button',
      {
        class: 'cr-override-submit',
        onclick: () => props.submit(/** @type {HTMLElement} */ (errorEl)),
      },
      'Save Override'
    )
  );
}

/**
 * @param {OverrideRenderProps} props
 * @param {QuestionDefinition} question
 * @returns {Node[]}
 */
export function renderOverrideValueControl(props, question) {
  const select = buildCaptureControl(
    {
      key: 'value',
      type: 'select',
      label: 'Replacement value',
      options: optionsFor(question),
    },
    /** @type {string} */ (props.draft.value),
    (value) => props.onValue(value),
    'cr-override-value-control'
  );

  return [h('label', {}, 'Replacement value'), select];
}

/**
 * @param {OverrideRenderProps} props
 * @param {QuestionDefinition} question
 * @returns {HTMLElement}
 */
export function renderOverrideFailureBlock(props, question) {
  void question;
  let attributeMenu = null;
  if (props.attributeFailures) {
    attributeMenu = h('cr-attribute-menu', {
      class: 'cr-override-attribute',
      client: props.client,
      attributedParty: props.draft.attributedParty,
      responsibleParty: props.caseRow?.responsibleParty
        ? {
            loginName: props.caseRow.responsibleParty,
            displayName: props.caseRow.responsibleParty,
          }
        : null,
      'oncr-attribute-change': (/** @type {any} */ ev) => {
        props.onAttribute(ev.detail.attributedParty);
      },
    });
  }

  const detailFields = props.remediationFields.map((field) => {
    const current = props.draft.remediationDetails[field.key] ?? '';
    const control = buildCaptureControl(
      field,
      current,
      (value) => props.onDetail(field.key, value),
      `cr-override-detail-${field.key}`
    );

    return h(
      'div',
      { class: 'cr-override-detail-field' },
      h(
        'label',
        {},
        field.required ? `${field.label} (required)` : field.label
      ),
      control
    );
  });

  return h(
    'div',
    { class: 'cr-override-failure' },
    attributeMenu,
    ...detailFields
  );
}

export class CROverrideEditor extends ReactiveElement {
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
    super.connectedCallback();
    this._render();
  }

  /** @returns {{ answerKey: string, value: string | string[], reasoning: string, attributedParty: Party | null, remediationDetails: Record<string, string> }} */
  _emptyDraft() {
    return {
      answerKey: '',
      value: '',
      reasoning: '',
      attributedParty: null,
      remediationDetails: {},
    };
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
    return (
      !!this.currentUser &&
      this.currentUser.id === this.caseRow?.assignedReviewer
    );
  }

  _render() {
    const content = this.render();
    if (content !== undefined) {
      if (Array.isArray(content)) this.replaceChildren(...content);
      else this.replaceChildren(content);
    }
  }

  render() {
    return OverrideEditor(this._props());
  }

  /**
   * @param {Override} o
   */
  _renderHistory(o) {
    return renderOverrideHistory(this._props(), o);
  }

  _renderForm() {
    return renderOverrideForm(this._props());
  }

  /**
   * @param {QuestionDefinition} question
   */
  _renderValueControl(question) {
    return renderOverrideValueControl(this._props(), question);
  }

  /**
   * The pass→fail / fail→fail capture surface: Attributed Party (when the Case
   * Type attributes failures) and the configurable Remediation Details.
   * @param {QuestionDefinition} question
   */
  _renderFailureBlock(question) {
    return renderOverrideFailureBlock(this._props(), question);
  }

  /** @param {string} answerKey */
  _onQuestion(answerKey) {
    const original = this.caseRow?.answers[answerKey]?.value ?? '';
    this._draft = {
      ...this._emptyDraft(),
      answerKey,
      value: original,
      reasoning: this._draft.reasoning,
    };
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
      if (this._draft.attributedParty)
        draft.attributedParty = this._draft.attributedParty;
      if (Object.keys(this._draft.remediationDetails).length) {
        draft.remediationDetails = { ...this._draft.remediationDetails };
      }
      const actions = materializeRemediationActions(question, {
        value: this._draft.value,
      }).remediationActions;
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
      const compute =
        this.computeOutcome ?? (() => /** @type {any} */ ({ outcome: 'pass' }));
      const effective = effectiveAnswers(this.caseRow.answers, next);
      this.saveQueue?.enqueueFields(this.caseId, {
        overrides: next,
        effectiveOutcome: compute(effective).outcome,
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
    const items = errors.map((e) => h('li', {}, e));
    errorEl.replaceChildren(...items);
  }

  /** @returns {OverrideRenderProps} */
  _props() {
    return {
      caseRow: this.caseRow,
      access: this.access,
      currentUser: this.currentUser,
      catalogue: this.catalogue,
      attributeFailures: this.attributeFailures,
      remediationFields: this.remediationFields,
      client: this.client,
      draft: this._draft,
      onQuestion: (answerKey) => this._onQuestion(answerKey),
      onValue: (value) => this._onValue(value),
      onDetail: (key, value) => this._onDetail(key, value),
      onAttribute: (party) => {
        this._draft.attributedParty = party;
        this._render();
      },
      submit: (errorEl) => this._submit(errorEl),
    };
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
  const option = /** @type {any} */ (h('option', { value }, text));
  return option;
}

customElements.define('cr-override-editor', CROverrideEditor);
