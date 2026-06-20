// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import {
  effectiveAnswers,
  currentOutcome,
} from '../evaluators/effective-answers.js';
import './cr-outcome.js';
import './cr-override-editor.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').OutcomeResult} OutcomeResult */
/** @typedef {import('../sharepoint-client.js').RemediationField} RemediationField */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */

/**
 * The read-only **source Case** panel on a **QA Check** (issue #47, ADR-0018).
 *
 * A QA Check (`caseType: 'qa-{slug}'`) links to the original **Completed Case**
 * via `CaseRow.sourceCaseId`. The page fetches that original and hands it here
 * along with the *original* Case Type's catalogue and `computeOutcome`. This
 * panel presents the original's **Effective Answers** and **Current Outcome**
 * read-only (the original Answers are never written), and — as a convenience —
 * embeds the reusable Override editor so a QA Reviewer can correct the original
 * without navigating away. Per ADR-0018 the storage and authority do not move
 * with the surface: the embedded editor performs a cross-row, ETag-guarded write
 * to the original row's `overrides[]`, and its `override` capability is resolved
 * by the page against the linked original (passed in as `overrideAccess`).
 */
export class CRSourceCase extends ReactiveElement {
  constructor() {
    super();
    /** The fetched original Completed Case (the write target), or null if missing. @type {CaseRow | null} */
    this.originalRow = null;
    /** The original Case Type's non-deprecated Question catalogue. @type {QuestionDefinition[]} */
    this.catalogue = [];
    /** The original Case Type's outcome function — re-run over the Effective Answers. @type {((answers: Record<string, Answer>) => OutcomeResult) | null} */
    this.computeOutcome = null;
    /** The original Case Type's attribution flag (ADR-0013), forwarded to the editor. @type {boolean} */
    this.attributeFailures = false;
    /** The original Case Type's per-failure capture fields (ADR-0017). @type {RemediationField[]} */
    this.remediationFields = [];
    /** @type {SaveQueue | null} */
    this.saveQueue = null;
    /** @type {CurrentUser | null} */
    this.currentUser = null;
    /** Backs the embedded people picker. @type {SharePointClient | null} */
    this.client = null;
    /** The Override Mode resolved against the linked original ('override' | 'read-only'). @type {'override' | 'read-only'} */
    this.overrideAccess = 'read-only';
    /** This QA Check's own id, stamped on overrides authored here as provenance. @type {string} */
    this.sourceCaseId = '';
  }

  _render() {
    const content = this.render();
    if (content !== undefined) {
      if (Array.isArray(content)) this.replaceChildren(...content);
      else this.replaceChildren(content);
    } else {
      this.replaceChildren();
    }
  }

  render() {
    if (!this.originalRow) {
      return [
        h('h2', {}, 'Source Case'),
        h(
          'p',
          { class: 'cr-source-case-missing' },
          'The source Case is not available.'
        ),
      ];
    }

    const row = this.originalRow;
    const overrides = row.overrides ?? [];

    // Current Outcome, re-derived from the Effective Answers (ADR-0018). The
    // source Case is Completed, so the verdict is always resolved.
    const effective = effectiveAnswers(row.answers, overrides);
    const result = currentOutcome(
      this.computeOutcome ??
        (() => /** @type {OutcomeResult} */ ({ verdict: 'pass' })),
      row.answers,
      overrides
    );
    const outcomeEl = /** @type {import('./cr-outcome.js').CROutcome} */ (
      h('cr-outcome')
    );
    outcomeEl.update(() => result, {}, true);

    const answersList = this._renderEffectiveAnswers(effective, overrides);

    // Embedded Override editor (ADR-0018): same element as the original Case
    // page, but the write targets the original row (caseId) while the QA Check is
    // the page's primary. `sourceCaseId` records that this was authored during a
    // formal QA Check.
    const editor =
      /** @type {import('./cr-override-editor.js').CROverrideEditor} */ (
        h('cr-override-editor')
      );
    editor.caseRow = row;
    editor.caseId = row.id;
    editor.saveQueue = this.saveQueue;
    editor.access = this.overrideAccess;
    editor.currentUser = this.currentUser;
    editor.catalogue = this.catalogue;
    editor.attributeFailures = this.attributeFailures;
    editor.remediationFields = this.remediationFields;
    editor.computeOutcome = this.computeOutcome;
    editor.client = this.client;
    editor.source = 'qa';
    editor.sourceCaseId = this.sourceCaseId;

    return [
      h('h2', {}, 'Source Case'),
      h('p', { class: 'cr-source-case-title' }, row.title),
      h('p', { class: 'cr-source-case-id' }, `Source Case: ${row.id}`),
      outcomeEl,
      answersList,
      editor,
    ];
  }

  /**
   * A read-only list of each catalogue Question with its Effective value, marking
   * the ones an Override displaces so the QA Reviewer sees the corrected state.
   *
   * @param {Record<string, Answer>} effective
   * @param {import('../sharepoint-client.js').Override[]} overrides
   * @returns {HTMLElement}
   */
  _renderEffectiveAnswers(effective, overrides) {
    const overridden = new Set(overrides.map((o) => o.answerKey));
    return h(
      'ul',
      { class: 'cr-source-case-answers' },
      ...this.catalogue.map((q) => {
        const value = formatValue(effective[q.id]?.value);
        return h(
          'li',
          {},
          overridden.has(q.id)
            ? `${q.text}: ${value} (overridden)`
            : `${q.text}: ${value}`
        );
      })
    );
  }
}

/**
 * @param {string | string[] | undefined} value
 * @returns {string}
 */
function formatValue(value) {
  if (value === undefined) return '—';
  return Array.isArray(value) ? value.join(', ') : value;
}

customElements.define('cr-source-case', CRSourceCase);
