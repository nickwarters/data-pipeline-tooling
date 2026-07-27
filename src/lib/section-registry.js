// @ts-check
/**
 * Data-driven registry of the built-in Case Review Sections — the single source
 * of truth for which Sections exist and how they are ordered (ADR-0032). Its two
 * consumers derive their structures from it: `services/section-access.js`
 * (`SECTIONS`, `SUMMARY_SECTIONS`, `showInSummaryDefault`) and
 * `pages/cora-case-review.js` (`tabEntries()` for the tab strip and render
 * loop). A contract test asserts nothing re-lists Section ids independently.
 *
 * The registry does not say how a Section's panel is rendered — that is
 * `SECTION_PANELS` in `pages/cora-case-review/section-panels.js`, which lives
 * with the page because `src/lib/` must not import `src/pages/**`. Nor does it
 * own the role→mode access policy, which stays in `MATRIX`.
 */

/**
 * The Section id union, projected from `SECTION_REGISTRY` rather than restated
 * by hand: an entry below is the only place a Section id is written, and the
 * `MATRIX` key set, the Case Type `sections` allow-list, the tab list and the
 * Summary block set all derive from it.
 *
 * Adding a Section is: an entry here, plus its `MATRIX` access row (policy, not
 * existence — deliberately hand-written), its `DEFAULT_SECTION_LABELS` label,
 * and — for a tab Section — its `SECTION_PANELS` renderer. `tsc` demands the
 * first two, a test the third.
 *
 * @typedef {(typeof SECTION_REGISTRY)[number]['id']} Section
 */

/**
 * One entry per built-in Section.
 *
 * @typedef {object} SectionDefinition
 * @property {Section} id
 *   The Section id — the key used across the access matrix, the tab list, the
 *   Case Type `sections` allow-list and the Summary block set.
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
 * explicitly because they differ from it.
 *
 * Deliberately carries no `@type {readonly SectionDefinition[]}` annotation: the
 * literal `id` strings must survive inference for `Section` above to project
 * from them, and a widening annotation would erase them. Entry *shape* is still
 * checked, via each helper's `registry` parameter default.
 */
export const SECTION_REGISTRY = /** @type {const} */ ([
  {
    id: 'details',
    tab: true,
    tabOrder: 1,
    summaryBlock: true,
    summaryOrder: 1,
    showInSummaryDefault: true,
  },
  {
    id: 'questions',
    tab: true,
    tabOrder: 2,
    summaryBlock: true,
    summaryOrder: 2,
    showInSummaryDefault: true,
  },
  {
    id: 'issues',
    tab: true,
    tabOrder: 3,
    summaryBlock: true,
    summaryOrder: 3,
    showInSummaryDefault: true,
  },
  {
    id: 'summary',
    tab: true,
    tabOrder: 5,
    summaryBlock: false,
    summaryOrder: 0,
    showInSummaryDefault: true,
  },
  {
    id: 'remediation',
    tab: true,
    tabOrder: 4,
    summaryBlock: true,
    summaryOrder: 4,
    showInSummaryDefault: true,
  },
  {
    id: 'notes',
    tab: true,
    tabOrder: 6,
    summaryBlock: true,
    summaryOrder: 5,
    showInSummaryDefault: false,
  },
  {
    id: 'conversation',
    tab: false,
    tabOrder: 0,
    summaryBlock: false,
    summaryOrder: 0,
    showInSummaryDefault: true,
  },
  {
    id: 'appealRequest',
    tab: true,
    tabOrder: 7,
    summaryBlock: false,
    summaryOrder: 0,
    showInSummaryDefault: true,
  },
  {
    id: 'appealReview',
    tab: true,
    tabOrder: 8,
    summaryBlock: false,
    summaryOrder: 0,
    showInSummaryDefault: true,
  },
  {
    id: 'amendOutcome',
    tab: true,
    tabOrder: 9,
    summaryBlock: false,
    summaryOrder: 0,
    showInSummaryDefault: true,
  },
]);

/**
 * The Section ids in canonical (declaration) order; re-exported by
 * `services/section-access.js` as `SECTIONS`.
 *
 * @param {readonly SectionDefinition[]} [registry]
 * @returns {Section[]}
 */
export function sectionIds(registry = SECTION_REGISTRY) {
  return registry.map((entry) => entry.id);
}

/**
 * The tab Sections in left-to-right order. Callers place each panel by `id`; the
 * label is resolved per Case Type by `resolveSectionLabels`.
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
 * The Section ids that can contribute a Summary block, in render order;
 * re-exported by `services/section-access.js` as `SUMMARY_SECTIONS`.
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
