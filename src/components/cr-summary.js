// @ts-check
import { CRElement } from './cr-element.js';
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
export class CRSummary extends CRElement {
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

  connectedCallback() {
    this._render();
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
    const heading = document.createElement('h2');
    heading.textContent = 'Summary';

    const outcomeEl = /** @type {import('./cr-outcome.js').CROutcome} */ (
      document.createElement('cr-outcome')
    );

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
    const children = [/** @type {any} */ (heading), /** @type {any} */ (outcomeEl)];

    // Per-Answer original-vs-overridden detail sits directly under the Outcome
    // block so the derived Current Outcome is never shown without its provenance.
    if (completed && overrides.length) {
      children.push(/** @type {any} */ (this._renderOverrides(overrides)));
    }

    // Summary blocks (key dates + per-Section) only make sense for a loaded Case;
    // the page always sets caseRow alongside summarySections.
    if (this.caseRow) {
      children.push(/** @type {any} */ (this._renderKeyDates(this.caseRow)));
      for (const section of this.summarySections) {
        const block = this._renderSectionBlock(section, this.caseRow);
        if (block) children.push(/** @type {any} */ (block));
      }
    }

    this.replaceChildren(...children);
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
      const block = document.createElement('section');
      block.className = 'cr-summary-notes';
      const h3 = document.createElement('h3');
      h3.textContent = 'Notes';
      const body = document.createElement('p');
      // textContent, never innerHTML (framework hard rules).
      body.textContent = caseRow.notes;
      block.appendChild(h3);
      block.appendChild(body);
      return block;
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
    const section = document.createElement('section');
    section.className = 'cr-summary-outcome-overrides';

    const h3 = document.createElement('h3');
    h3.textContent = 'Outcome corrections';
    section.appendChild(h3);

    if (this.caseRow?.outcomeAtCompletion) {
      const original = document.createElement('p');
      original.className = 'cr-summary-outcome-original';
      original.textContent = `Outcome at completion: ${this.caseRow.outcomeAtCompletion}`;
      section.appendChild(original);
    }

    const ul = document.createElement('ul');
    for (const row of buildOverrideRows(this.catalogue, this.answers, overrides)) {
      const li = document.createElement('li');

      const q = document.createElement('p');
      q.textContent = row.questionText;
      li.appendChild(q);

      const change = document.createElement('p');
      change.textContent = `${row.originalValue} → ${row.overriddenValue} (${row.source})`;
      li.appendChild(change);

      const reason = document.createElement('p');
      reason.textContent = `Reason: ${row.reasoning}`;
      li.appendChild(reason);

      ul.appendChild(li);
    }
    section.appendChild(ul);
    return section;
  }

  /**
   * Remediation roll-up (ADR-0016): the total Remediation Action count plus each
   * failed Answer with its actions, recomputed from the current Answers.
   * @returns {HTMLElement}
   */
  _renderRemediation() {
    const { remediationActionCount, failures } = buildSummaryModel(this.catalogue, this.answers);

    const section = document.createElement('section');
    section.className = 'cr-summary-remediation';
    const h3 = document.createElement('h3');
    h3.textContent = 'Issues';
    section.appendChild(h3);

    const count = document.createElement('p');
    count.textContent = `Remediation Actions: ${remediationActionCount}`;
    section.appendChild(count);

    if (failures.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No failures.';
      section.appendChild(empty);
      return section;
    }

    const ul = document.createElement('ul');
    for (const failure of failures) {
      ul.appendChild(this._renderFailure(failure));
    }
    section.appendChild(ul);
    return section;
  }

  /**
   * @param {import('../evaluators/summary-model.js').SummaryFailure} failure
   * @returns {HTMLElement}
   */
  _renderFailure(failure) {
    const li = document.createElement('li');

    const q = document.createElement('p');
    q.textContent = failure.category ? `${failure.category}: ${failure.text}` : failure.text;
    li.appendChild(q);

    const ans = document.createElement('p');
    ans.textContent = `Answer: ${failure.answer}`;
    li.appendChild(ans);

    if (failure.actions.length) {
      const actions = document.createElement('ul');
      for (const text of failure.actions) {
        const item = document.createElement('li');
        item.textContent = text;
        actions.appendChild(item);
      }
      li.appendChild(actions);
    }

    this._renderCapture(li, failure.id);
    return li;
  }

  /**
   * Renders the failed Answer's unified Issue Capture (ADR-0020) read-only:
   * `cr-capture-groups` with `canCapture: false` shows every populated field
   * expanded. Skipped when the Case Type declares no groups, or the Answer has no
   * captured values, so the Summary stays clean.
   *
   * @param {HTMLElement} li
   * @param {string} questionId
   */
  _renderCapture(li, questionId) {
    if (!this.captureGroups?.length) return;
    const capture = this.answers[questionId]?.capture;
    if (!capture || Object.keys(capture).length === 0) return;

    const cg = /** @type {import('./cr-capture-groups.js').CRCaptureGroups} */ (
      document.createElement('cr-capture-groups')
    );
    cg.className = 'cr-summary-capture';
    cg.groups = this.captureGroups;
    cg.capture = capture;
    cg.canCapture = false;
    cg.update(this.captureGroups, capture, false);
    li.appendChild(/** @type {any} */ (cg));
  }

  /**
   * Per-category pass/fail counts (ADR-0016), recomputed from the current
   * Answers — live while In-progress, the frozen Answers once Completed.
   * @returns {HTMLElement}
   */
  _renderCounts() {
    const { categoryCounts } = buildSummaryModel(this.catalogue, this.answers);

    const section = document.createElement('section');
    section.className = 'cr-summary-counts';
    const h3 = document.createElement('h3');
    h3.textContent = 'Questions';
    section.appendChild(h3);

    const ul = document.createElement('ul');
    for (const { category, pass, fail } of categoryCounts) {
      const li = document.createElement('li');
      li.textContent = `${category}: ${pass} pass, ${fail} fail`;
      ul.appendChild(li);
    }
    section.appendChild(ul);
    return section;
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
    /** @type {Array<{ label: string, value: string | null | undefined }>} */
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
    const section = document.createElement('section');
    section.className = className;

    const h3 = document.createElement('h3');
    h3.textContent = title;
    section.appendChild(h3);

    const dl = document.createElement('dl');
    for (const { label, display } of rows) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = display;
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    section.appendChild(dl);
    return section;
  }
}

customElements.define('cr-summary', CRSummary);
