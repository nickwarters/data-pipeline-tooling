// @ts-check
/**
 * Case Review Section registry.
 *
 * Built-in static Section definitions and derivers for Section IDs and Summary blocks.
 * Individual SectionPlugins are registered and managed via `sections/registry.js`.
 */

/**
 * The Section id union, projected from `SECTION_REGISTRY` rather than restated
 * anywhere.
 *
 * Declared as a separate type alias so it is an exportable named type in JSDoc;
 * `const` on `SECTION_REGISTRY` narrows the array element's `.id` to literal
 * string types rather than `string`, so this union resolves to the ten names
 * rather than widening.
 *
 * @typedef {(typeof SECTION_REGISTRY)[number]['id']} Section
 */

/**
 * A Section definition in the registry.
 *
 * @typedef {Object} SectionDefinition
 * @property {Section} id
 *   Canonical identifier for the Section across the registry, plugins, and the route slice.
 * @property {boolean} tab
 *   Whether this Section has a dedicated tab on the Case Review page.
 * @property {number} tabOrder
 *   Position in the tab strip (1-based, left to right). Ignored when `tab` is
 *   false.
 * @property {boolean} summaryBlock
 *   Whether this Section can contribute a block to the Summary Section.
 * @property {number} summaryOrder
 *   Position within the Summary view (1-based, top to bottom). Ignored when
 *   `summaryBlock` is false.
 * @property {boolean} showInSummaryDefault
 *   Default visibility in Summary when the Case Type does not configure
 *   `showInSummary`. Ignored when `summaryBlock` is false. Notes defaults off;
 *   every other Section on.
 */

/**
 * The built-in Sections, declared once. Declaration order is the canonical
 * Section order (what `SECTIONS` exposes); tab and Summary order are carried
 * explicitly so they can differ from it. Summary precedes Remediation in the
 * tab strip so the Responsible Party's two tabs read as the roll-up first,
 * then the actions to take; the Reviewer sees the same order.
 *
 * Deliberately carries no `@type {readonly SectionDefinition[]}` annotation: the
 * literal `id` strings must survive inference for `Section` above to project
 * from them, and a widening annotation would erase them. Entry *shape* is still
 * checked, via each helper's `registry` parameter default.
 */
export const SECTION_REGISTRY = Object.freeze(
  /** @type {const} */ ([
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
      tabOrder: 4,
      summaryBlock: false,
      summaryOrder: 0,
      showInSummaryDefault: true,
    },
    {
      id: 'remediation',
      tab: true,
      tabOrder: 5,
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
  ])
);

/**
 * The Section ids in canonical order.
 *
 * @param {readonly SectionDefinition[]} [registry]
 * @returns {Section[]}
 */
export function sectionIds(registry = SECTION_REGISTRY) {
  return registry.map((entry) => entry.id);
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
 * Look up a Section definition by its canonical id.
 *
 * @param {Section} id
 * @param {readonly SectionDefinition[]} [registry]
 * @returns {SectionDefinition | undefined}
 */
export function sectionById(id, registry = SECTION_REGISTRY) {
  return registry.find((entry) => entry.id === id);
}
