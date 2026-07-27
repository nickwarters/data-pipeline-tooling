// @ts-check
// Single source of truth for Case Review tab labels and section headings.
// A Case Type may override any entry via `CaseTypeConfig.sectionLabels`
// (src/sharepoint-client.js); DEFAULT_SECTION_LABELS supplies the rest.

/** @typedef {import('../sharepoint-client.js').SectionLabels} SectionLabels */

/**
 * The default Case Review tab labels / section headings, keyed by Section id.
 * `resolveSectionLabels` merges a Case Type's `sectionLabels` over these, and
 * `cora-case-review.js` renders the result on the tab strip. The headings are
 * read directly by the Section views that display one (`summary-view.js`,
 * `remediation-tracking-view.js`, `appeal-view.js`).
 *
 * @type {Required<SectionLabels>}
 */
export const DEFAULT_SECTION_LABELS = {
  details: 'Details',
  questions: 'Review',
  issues: 'Issues',
  remediation: 'Remediation',
  summary: 'Summary',
  notes: 'Notes',
  appealRequest: 'Appeal',
  appealReview: 'Appeal Review',
  amendOutcome: 'Amend Outcome',
  conversation: 'Conversation',
};

/**
 * The current hardcoded section *headings* (the `<h2>`/`<h3>` copy inside each
 * Section). Identical to the tab labels except `questions`: the tab has always
 * read "Review" while the panel and Summary headings read "Questions" — both
 * defaults are preserved so a Case Type without `sectionLabels` renders
 * exactly as before. A single `sectionLabels.questions` override replaces both.
 *
 * @type {Required<SectionLabels>}
 */
export const DEFAULT_SECTION_HEADINGS = {
  ...DEFAULT_SECTION_LABELS,
  questions: 'Questions',
};

/**
 * Resolve a Case Type's effective section labels: `DEFAULT_SECTION_LABELS`
 * overridden by any `config.sectionLabels` entries the Case Type declares.
 * Mirrors the default-with-override `customColumns` pattern
 * (cora-case-table.js) — absence of `sectionLabels` (or of `config` itself)
 * is a no-op, so existing Case Types are unaffected.
 *
 * @param {{ sectionLabels?: SectionLabels } | null | undefined} config
 * @returns {Required<SectionLabels>}
 */
export function resolveSectionLabels(config) {
  return { ...DEFAULT_SECTION_LABELS, ...(config?.sectionLabels ?? {}) };
}

/**
 * Resolve a Case Type's effective section *headings* — as
 * `resolveSectionLabels`, but over `DEFAULT_SECTION_HEADINGS`.
 *
 * @param {{ sectionLabels?: SectionLabels } | null | undefined} config
 * @returns {Required<SectionLabels>}
 */
export function resolveSectionHeadings(config) {
  return { ...DEFAULT_SECTION_HEADINGS, ...(config?.sectionLabels ?? {}) };
}
