// @ts-check
/**
 * Data-driven registry of the built-in Case Review Sections — the single
 * source of truth for which Sections exist and how they are ordered (ADR-0032).
 *
 * Before this module, Section *existence* was restated in three hand-maintained
 * lists with no runtime check they agreed: `SECTIONS` in
 * `services/section-access.js`, `buildCaseReviewTabs` in
 * `pages/cora-case-review/tab-controller.js`, and the node factory in
 * `pages/cora-case-review/node-registry.js`. This registry describes each
 * built-in Section once; those structures are now *derived* from it (see the
 * `sectionIds` / `tabEntries` / `summaryBlockIds` helpers below), and a
 * contract test asserts nothing re-lists Section ids independently.
 *
 * Scope (per ADR-0032): the registry owns Section *existence*, tab *order*,
 * *labels* (the `componentTag`/node wiring) and the Summary-block default. It
 * deliberately does **not** own the role→mode access policy — the `MATRIX` in
 * `services/section-access.js` stays where it is; the registry only supplies the
 * key set that MATRIX is asserted to match.
 *
 * @typedef {import('../services/section-access.js').Section} Section
 */

/**
 * One entry per built-in Section.
 *
 * @typedef {object} SectionDefinition
 * @property {Section} id
 *   The Section id — the key used across the access matrix, the tab list, the
 *   Case Type `sections` allow-list and the Summary block set.
 * @property {string | null} componentTag
 *   The custom-element tag rendered for this Section's panel, or `null` when the
 *   panel is a bespoke wrapper (only `questions`, whose panel is a plain
 *   `<section>` wrapping the question list + progress). Uniform panels are
 *   materialized from this tag by the node registry.
 * @property {string} nodeKey
 *   The key this Section's panel node is stored under in the Case Review node
 *   registry. Equals `id` except where history diverged: `questions` →
 *   `questionsPanel`, `appealRequest` → `appeal`.
 * @property {boolean} tab
 *   Whether the Section appears as a tab on the Case Review page. All Sections
 *   are tabs except `conversation`, which is a floating overlay.
 * @property {number} tabOrder
 *   Left-to-right order among the visible tabs. Ignored when `tab` is `false`.
 * @property {boolean} summaryBlock
 *   Whether the Section can contribute a block to the read-only Summary Section.
 * @property {number} summaryOrder
 *   Render order among Summary blocks. Ignored when `summaryBlock` is `false`.
 * @property {boolean} showInSummaryDefault
 *   The default value of the per-Section `showInSummary` flag when a Case Type
 *   declares no explicit override. Notes defaults off; every other Section on.
 */

/**
 * The built-in Sections, declared once. Declaration order is the canonical
 * Section order (what `SECTIONS` exposes); tab and Summary order are carried
 * explicitly because they differ from it (tabs put Remediation before Summary;
 * the Summary block set omits Summary itself, Conversation and the appeal /
 * amend Sections).
 *
 * @type {readonly SectionDefinition[]}
 */
export const SECTION_REGISTRY = /** @type {const} */ ([
  {
    id: 'details',
    componentTag: 'cora-case-details',
    nodeKey: 'details',
    tab: true,
    tabOrder: 1,
    summaryBlock: true,
    summaryOrder: 1,
    showInSummaryDefault: true,
  },
  {
    id: 'questions',
    componentTag: null,
    nodeKey: 'questionsPanel',
    tab: true,
    tabOrder: 2,
    summaryBlock: true,
    summaryOrder: 2,
    showInSummaryDefault: true,
  },
  {
    id: 'issues',
    componentTag: null,
    nodeKey: 'issues',
    tab: true,
    tabOrder: 3,
    summaryBlock: true,
    summaryOrder: 3,
    showInSummaryDefault: true,
  },
  {
    id: 'summary',
    componentTag: 'cora-summary',
    nodeKey: 'summary',
    tab: true,
    tabOrder: 5,
    summaryBlock: false,
    summaryOrder: 0,
    showInSummaryDefault: true,
  },
  {
    id: 'remediation',
    componentTag: null,
    nodeKey: 'remediation',
    tab: true,
    tabOrder: 4,
    summaryBlock: true,
    summaryOrder: 4,
    showInSummaryDefault: true,
  },
  {
    id: 'notes',
    componentTag: 'cora-notes',
    nodeKey: 'notes',
    tab: true,
    tabOrder: 6,
    summaryBlock: true,
    summaryOrder: 5,
    showInSummaryDefault: false,
  },
  {
    id: 'conversation',
    componentTag: 'cora-conversation',
    nodeKey: 'conversation',
    tab: false,
    tabOrder: 0,
    summaryBlock: false,
    summaryOrder: 0,
    showInSummaryDefault: true,
  },
  {
    id: 'appealRequest',
    componentTag: 'cora-appeal',
    nodeKey: 'appeal',
    tab: true,
    tabOrder: 7,
    summaryBlock: false,
    summaryOrder: 0,
    showInSummaryDefault: true,
  },
  {
    id: 'appealReview',
    componentTag: 'cora-appeal-review',
    nodeKey: 'appealReview',
    tab: true,
    tabOrder: 8,
    summaryBlock: false,
    summaryOrder: 0,
    showInSummaryDefault: true,
  },
  {
    id: 'amendOutcome',
    componentTag: 'cora-amend-outcome',
    nodeKey: 'amendOutcome',
    tab: true,
    tabOrder: 9,
    summaryBlock: false,
    summaryOrder: 0,
    showInSummaryDefault: true,
  },
]);

/**
 * The Section ids in canonical (declaration) order. This is what
 * `services/section-access.js` re-exports as `SECTIONS`.
 *
 * @param {readonly SectionDefinition[]} [registry]
 * @returns {Section[]}
 */
export function sectionIds(registry = SECTION_REGISTRY) {
  return registry.map((entry) => entry.id);
}

/**
 * The tab Sections in left-to-right order. Each entry keeps the id plus the
 * wiring (`componentTag`, `nodeKey`) the page needs to place its panel; the
 * label is resolved separately (per Case Type) by `resolveSectionLabels`.
 *
 * @param {readonly SectionDefinition[]} [registry]
 * @returns {SectionDefinition[]}
 */
export function tabEntries(registry = SECTION_REGISTRY) {
  return registry
    .filter((entry) => entry.tab)
    .sort((a, b) => a.tabOrder - b.tabOrder);
}

/**
 * The Section ids that can contribute a Summary block, in render order. This is
 * what `services/section-access.js` re-exports as `SUMMARY_SECTIONS`.
 *
 * @param {readonly SectionDefinition[]} [registry]
 * @returns {Section[]}
 */
export function summaryBlockIds(registry = SECTION_REGISTRY) {
  return registry
    .filter((entry) => entry.summaryBlock)
    .sort((a, b) => a.summaryOrder - b.summaryOrder)
    .map((entry) => entry.id);
}

/**
 * Look up a Section definition by id.
 *
 * @param {string} id
 * @param {readonly SectionDefinition[]} [registry]
 * @returns {SectionDefinition | undefined}
 */
export function sectionById(id, registry = SECTION_REGISTRY) {
  return registry.find((entry) => entry.id === id);
}
