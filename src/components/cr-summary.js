// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import './cr-outcome.js';
import { caseDetailFields } from './cr-case-details.js';
import { buildSummaryModel } from '../evaluators/summary-model.js';
import { currentOutcome, buildOverrideRows } from '../evaluators/effective-answers.js';
import './cr-capture-groups.js';

/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').OutcomeResult} OutcomeResult */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../services/section-access.js').Section} Section */

/**
 * The read-only Summary Section (ADR-0016). It rolls the whole Case up onto one
 * page; this tracer-bullet shell renders only the Outcome block. Outcome
 * derivation is hybrid: while the Case is In-progress the verdict is computed
 * live from the current Answers, but once the Case is Completed it reads the
 * frozen `outcomeAtCompletion` snapshot (ADR-0012) rather than recomputing.
 *
 * Summary is never editable — only `read-only` or `hidden` (see section-access).
 */
export class CRSummary extends ReactiveElement {
  constructor() {
    super();
    /** @type {((answers: Record<string, Answer>) => OutcomeResult) | null} */
    this.computeOutcome = null;
    /** @type {Record<string, Answer>} */
    this.answers = {};
    /** @type {boolean} */
    this.allAnswered = false;
    /** @type {CaseRow | null} */
    this.caseRow = null;
    /**
     * The Case Type's non-deprecated Question catalogue, used to recompute the
     * counts and failed-Answer blocks from the current Answers.
     * @type {QuestionDefinition[]}
     */
    this.catalogue = [];
    /**
     * The Sections to render as Summary blocks, already filtered by membership,
     * `showInSummary`, and the viewer's access (ADR-0016). Rendered in the given
     * order. The page resolves this; the component just renders it.
     * @type {Section[]}
     */
    this.summarySections = [];
    /**
     * The Case Type's unified **Issue Capture Group**s (ADR-0020), rendered
     * read-only (expanded, populated-only) under each failed Answer. Empty when
     * the Case Type declares none.
     * @type {import('../sharepoint-client.js').CaptureGroup[]}
     */
    this.captureGroups = [];
  }

  /**
   * @param {(answers: Record<string, Answer>) => OutcomeResult} computeOutcome
   * @param {Record<string, Answer>} answers
   * @param {boolean} allAnswered
   */
  update(computeOutcome, answers, allAnswered) {
    this.computeOutcome = computeOutcome;
    this.answers = answers;
    this.allAnswered = allAnswered;
    this._render();
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
    const heading = h('h2', {}, 'Summary');
    const outcomeEl = /** @type {import('./cr-outcome.js').CROutcome} */ (h('cr-outcome'));

    const completed = this.caseRow?.status === 'Completed';
    const overrides = this.caseRow?.overrides ?? [];
    const frozen = completed ? this.caseRow?.outcomeAtCompletion : null;
    if (completed && overrides.length && this.computeOutcome) {
      // Post-completion Answer Overrides exist (ADR-0018): the Outcome block shows
      // the Current Outcome, re-derived by running computeOutcome over the
      // Effective Answers rather than reading the frozen snapshot.
      const result = currentOutcome(this.computeOutcome, this.answers, overrides);
      outcomeEl.update(() => result, {}, true);
    } else if (frozen) {
      // Read the frozen snapshot for a Completed Case (ADR-0012): the verdict is
      // whatever the system concluded at completion, not a recomputation.
      /** @type {OutcomeResult} */
      const result = { verdict: /** @type {OutcomeResult['verdict']} */ (frozen) };
      outcomeEl.update(() => result, {}, true);
    } else if (this.computeOutcome) {
      // Live derivation from the current Answers while In-progress (ADR-0016).
      outcomeEl.update(this.computeOutcome, this.answers, this.allAnswered);
    } else {
      // Nothing to derive yet — render the Outcome block in its indeterminate
      // state until update() supplies the live state.
      outcomeEl.update(() => /** @type {OutcomeResult} */ ({ verdict: 'pass' }), {}, false);
    }

    /** @type {Node[]} */
    const children = [heading, outcomeEl];

    // Per-Answer original-vs-overridden detail sits directly under the Outcome
    // block so the derived Current Outcome is never shown without its provenance.
    if (completed && overrides.length) {
      children.push(this._renderOverrides(overrides));
    }

    // Summary blocks (key dates + per-Section) only make sense for a loaded Case;
    // the page always sets caseRow alongside summarySections.
    if (this.caseRow) {
      children.push(this._renderKeyDates(this.caseRow));
      for (const section of this.summarySections) {
        const block = this._renderSectionBlock(section, this.caseRow);
        if (block) children.push(block);
      }
    }

    return children;
  }

  /**
   * Renders the Summary block for one Section (ADR-0016), or null when the
   * Section contributes no block.
   *
   * @param {Section} section
   * @param {CaseRow} caseRow
   * @returns {HTMLElement | null}
   */
  _renderSectionBlock(section, caseRow) {
    if (section === 'details') {
      return this._renderFieldBlock('cr-summary-details', 'Case Details',
        caseDetailFields(caseRow).map(f => ({ label: f.label, display: f.display })));
    }
    if (section === 'questions') {
      return this._renderCounts();
    }
    if (section === 'remediation') {
      return this._renderRemediation();
    }
    if (section === 'notes') {
      return h('section', { class: 'cr-summary-notes' },
        h('h3', {}, 'Notes'),
        h('p', {}, caseRow.notes)
      );
    }
    // Conversation/Summary are valid Sections but contribute no Summary block.
    return null;
  }

  /**
   * Outcome corrections block (ADR-0018): a read-only list of the post-completion
   * Answer Overrides behind the Current Outcome. Each row shows the question, the
   * original→overridden value, the source (QA or Appeal) and the reasoning, so
   * the derived verdict is always shown with its provenance.
   *
   * @param {import('../sharepoint-client.js').Override[]} overrides
   * @returns {HTMLElement}
   */
  _renderOverrides(overrides) {
    return h('section', { class: 'cr-summary-outcome-overrides' },
      h('h3', {}, 'Outcome corrections'),
      this.caseRow?.outcomeAtCompletion 
        ? h('p', { class: 'cr-summary-outcome-original' }, `Outcome at completion: ${this.caseRow.outcomeAtCompletion}`) 
        : null,
      h('ul', {},
        ...buildOverrideRows(this.catalogue, this.answers, overrides).map(row => 
          h('li', {},
            h('p', {}, row.questionText),
            h('p', {}, `${row.originalValue} → ${row.overriddenValue} (${row.source})`),
            h('p', {}, `Reason: ${row.reasoning}`)
          )
        )
      )
    );
  }

  /**
   * Remediation roll-up (ADR-0016): the total Remediation Action count plus each
   * failed Answer with its actions, recomputed from the current Answers.
   * @returns {HTMLElement}
   */
  _renderRemediation() {
    const { remediationActionCount, failures } = buildSummaryModel(this.catalogue, this.answers);

    return h('section', { class: 'cr-summary-remediation' },
      h('h3', {}, 'Issues'),
      h('p', {}, `Remediation Actions: ${remediationActionCount}`),
      failures.length === 0 
        ? h('p', {}, 'No failures.')
        : h('ul', {}, ...failures.map(failure => this._renderFailure(failure)))
    );
  }

  /**
   * @param {import('../evaluators/summary-model.js').SummaryFailure} failure
   * @returns {HTMLElement}
   */
  _renderFailure(failure) {
    return h('li', {},
      h('p', {}, failure.category ? `${failure.category}: ${failure.text}` : failure.text),
      h('p', {}, `Answer: ${failure.answer}`),
      failure.actions.length ? h('ul', {}, ...failure.actions.map(text => h('li', {}, text))) : null,
      this._renderCapture(failure.id)
    );
  }

  /**
   * Renders the failed Answer's unified Issue Capture (ADR-0020) read-only:
   * `cr-capture-groups` with `canCapture: false` shows every populated field
   * expanded. Skipped when the Case Type declares no groups, or the Answer has no
   * captured values, so the Summary stays clean.
   *
   * @param {string} questionId
   * @returns {HTMLElement | null}
   */
  _renderCapture(questionId) {
    if (!this.captureGroups?.length) return null;
    const capture = this.answers[questionId]?.capture;
    if (!capture || Object.keys(capture).length === 0) return null;

    const cg = /** @type {import('./cr-capture-groups.js').CRCaptureGroups} */ (h('cr-capture-groups', {
      class: 'cr-summary-capture'
    }));
    cg.groups = this.captureGroups;
    cg.capture = capture;
    cg.canCapture = false;
    cg.update(this.captureGroups, capture, false);
    return cg;
  }

  /**
   * Per-category pass/fail counts (ADR-0016), recomputed from the current
   * Answers — live while In-progress, the frozen Answers once Completed.
   * @returns {HTMLElement}
   */
  _renderCounts() {
    const { categoryCounts } = buildSummaryModel(this.catalogue, this.answers);
    return h('section', { class: 'cr-summary-counts' },
      h('h3', {}, 'Questions'),
      h('ul', {},
        ...categoryCounts.map(({ category, pass, fail }) =>
          h('li', {}, `${category}: ${pass} pass, ${fail} fail`)
        )
      )
    );
  }

  /**
   * Key dates roll-up (ADR-0016): only the lifecycle timestamps already modelled
   * on the Case row — `Created` and `completedAt`. No SharePoint version-history
   * mining; further milestones get explicit fields when genuinely needed.
   *
   * @param {CaseRow} caseRow
   * @returns {HTMLElement}
   */
  _renderKeyDates(caseRow) {
    const dates = [
      { label: 'Created', value: caseRow.created },
      { label: 'Completed', value: caseRow.completedAt },
    ];
    return this._renderFieldBlock('cr-summary-key-dates', 'Key dates',
      dates.map(d => ({ label: d.label, display: d.value ? d.value : '—' })));
  }

  /**
   * Renders a titled block of label/value rows as a definition list. Values are
   * assigned via textContent (no innerHTML) per the framework's hard rules.
   *
   * @param {string} className
   * @param {string} title
   * @param {Array<{ label: string, display: string }>} rows
   * @returns {HTMLElement}
   */
  _renderFieldBlock(className, title, rows) {
    return h('section', { class: className },
      h('h3', {}, title),
      h('dl', {},
        ...rows.flatMap(({ label, display }) => [
          h('dt', {}, label),
          h('dd', {}, display)
        ])
      )
    );
  }
}

customElements.define('cr-summary', CRSummary);
