// @ts-check
/**
 * Data-driven registry of the built-in Case Review Sections — the single
 * source of truth for which Sections exist and how they are ordered (ADR-0032).
 *
 * Before this module, Section *existence* was restated in three hand-maintained
 * lists with no runtime check they agreed. This registry describes each built-in
 * Section once, and its two live consumers derive their structures from it:
 *
 * - `services/section-access.js` re-exports `sectionIds()` as `SECTIONS` and
 *   `summaryBlockIds()` as `SUMMARY_SECTIONS`, and reads
 *   `showInSummaryDefault` via `sectionById()`.
 * - `pages/cora-case-review.js` calls `tabEntries()` to build the tab strip and
 *   its panel elements, and to iterate the Sections on render.
 *
 * A contract test asserts nothing re-lists Section ids independently.
 *
 * The registry supplies which Sections exist and in what order; it does not say
 * how a Section's panel is rendered. That is `SECTION_PANELS` in
 * `pages/cora-case-review/section-panels.js`, keyed by the ids below — it lives
 * with the page because `src/lib/` must not import `src/pages/**`, and a test
 * asserts its key set equals `tabEntries()`' ids (#512).
 *
 * Scope (per ADR-0032): the registry owns Section *existence*, tab *order* and
 * the Summary-block default. It deliberately does **not** own the role→mode
 * access policy — the `MATRIX` in `services/section-access.js` stays where it
 * is; the registry only supplies the key set that MATRIX is asserted to match.
 */

/**
 * The Section id union, projected from `SECTION_REGISTRY` itself rather than
 * restated by hand. An entry below is the only place a Section *id* is written:
 * this type, the `MATRIX` key set, the Case Type `sections` allow-list, the tab
 * list and the Summary block set all derive from it.
 *
 * `section-access.js` and `sharepoint-client.js` import this type; they used to
 * spell the union out, which `tsc` could not police because a typo in a
 * restated *type* is self-consistent. `tests/section-registry.test.js` locks it.
 *
 * Adding a Section is now: an entry here, plus its `MATRIX` access row (policy,
 * not existence — deliberately hand-written), its `DEFAULT_SECTION_LABELS`
 * label, and — for a tab Section — its `SECTION_PANELS` renderer. `tsc` demands
 * the first two; before this projection it demanded neither. A test demands the
 * third (#512).
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
 * explicitly because they differ from it (tabs put Remediation before Summary;
 * the Summary block set omits Summary itself, Conversation and the appeal /
 * amend Sections).
 *
 * Deliberately carries no `@type {readonly SectionDefinition[]}` annotation: the
 * literal `id` strings have to survive inference for `Section` above to be
 * projected from them, and a widening annotation would erase them (annotating
 * it is also circular, since `SectionDefinition.id` is itself a `Section`).
 * Entry *shape* is still checked — every helper below defaults its `registry`
 * parameter to this array, so a malformed entry fails at the default.
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
 * The tab Sections in left-to-right order. Callers place each panel by `id`; the
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
