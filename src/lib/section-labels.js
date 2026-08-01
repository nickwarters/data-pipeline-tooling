// @ts-check
// Single source of truth for Case Review tab labels and section headings.
// A Case Type may override any entry via `CaseTypeConfig.sectionLabels`
// (src/sharepoint-client.js); DEFAULT_SECTION_LABELS supplies the rest.

/** @typedef {import('../sharepoint-client.js').SectionLabels} SectionLabels */
/** @typedef {import('../sharepoint-client.js').ResolvedSectionLabels} ResolvedSectionLabels */

/**
 * The default display copy for every Section, keyed by Section id. Each entry
 * carries both spellings a Section can need: `tab` is the caption on the Case
 * Review tab strip, `heading` is the `<h2>`/`<h3>` copy inside the panel (and
 * the block title in the Summary Section).
 *
 * Most Sections say the same thing in both places, so both strings are written
 * out identically rather than derived — the pair is the unit, and a reader
 * should be able to see a Section's whole vocabulary on one line. Two Sections
 * genuinely differ: the `questions` tab has always read "Review" while its
 * panel reads "Questions", and the `details` tab reads "Details" while its
 * panel reads "Case Details". Both splits predate this map and are preserved so
 * a Case Type declaring no override renders exactly as it always has.
 *
 * @type {Readonly<ResolvedSectionLabels>}
 */
export const DEFAULT_SECTION_LABELS = Object.freeze({
  details: { tab: 'Details', heading: 'Case Details' },
  questions: { tab: 'Review', heading: 'Questions' },
  issues: { tab: 'Issues', heading: 'Issues' },
  remediation: { tab: 'Remediation', heading: 'Remediation' },
  summary: { tab: 'Summary', heading: 'Summary' },
  notes: { tab: 'Notes', heading: 'Notes' },
  appealRequest: { tab: 'Appeal', heading: 'Appeal' },
  appealReview: { tab: 'Appeal Review', heading: 'Appeal Review' },
  amendOutcome: { tab: 'Amend Outcome', heading: 'Amend Outcome' },
  conversation: { tab: 'Conversation', heading: 'Conversation' },
});

/**
 * Resolve a Case Type's effective section display copy: `DEFAULT_SECTION_LABELS`
 * with any `config.sectionLabels` entries the Case Type declares applied over
 * the top. Absence of `sectionLabels` (or of `config` itself) is a no-op.
 *
 * An override entry may be a bare string — which renames both the tab and the
 * heading, the common case where a Case Type simply calls the Section something
 * else — or an object naming either axis, which patches only what it names and
 * leaves the other at its default.
 *
 * Every returned entry is a complete `{ tab, heading }` pair, so a caller never
 * has to normalise on the read path.
 *
 * @param {{ sectionLabels?: SectionLabels } | null | undefined} config
 * @returns {ResolvedSectionLabels}
 */
export function resolveSectionLabels(config) {
  const overrides = config?.sectionLabels ?? {};
  const resolved = /** @type {ResolvedSectionLabels} */ ({});
  for (const [id, fallback] of Object.entries(DEFAULT_SECTION_LABELS)) {
    const override = overrides[/** @type {keyof SectionLabels} */ (id)];
    resolved[/** @type {keyof ResolvedSectionLabels} */ (id)] =
      typeof override === 'string'
        ? { tab: override, heading: override }
        : { ...fallback, ...(override ?? {}) };
  }
  return resolved;
}
