// src/sections/contract.js
// @ts-check

/**
 * @typedef {import('../services/section-access.js').Mode} Mode
 * @typedef {import('../services/section-access.js').Role} Role
 * @typedef {import('../sharepoint-client.js').CaseRow} CaseRow
 * @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig
 * @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition
 * @typedef {import('../services/permissions.js').Capabilities} Capabilities
 * @typedef {import('../pages/cora-case-review/section-panels.js').PanelContext} PanelContext
 * @typedef {import('../pages/cora-case-review/summary-view.js').SummaryBlockProps} SummaryBlockProps
 */

/**
 * @typedef {Object} SectionPlugin
 * @property {string} id Unique section ID (e.g. 'details', 'questions')
 * @property {boolean} tab Whether it appears in the tab strip
 * @property {number} tabOrder Order in the tab strip
 * @property {boolean} [summaryBlock] Whether it can contribute to the Summary tab
 * @property {number} [summaryOrder] Order inside the Summary view
 * @property {boolean} [showInSummaryDefault] Default summary inclusion
 * @property {{ tab: string, heading: string }} defaultLabels Default tab & panel titles
 * @property {(ctx: {
 *   caseRow: CaseRow,
 *   roles: Role[],
 *   capabilities?: Capabilities,
 *   sectionConfig?: any,
 *   catalogue?: QuestionDefinition[],
 *   config?: CaseTypeConfig,
 * }) => Mode} evaluateAccess
 * @property {(panelContext: PanelContext) => Node | Node[] | null} view
 * @property {{ fields?: readonly string[], blobs?: readonly string[] }} [writes]
 *   Optional. The Case Row columns this Section may persist: `fields` for
 *   plain values, `blobs` for JSON-object columns it merges keys into. A
 *   Section that declares nothing can persist nothing.
 *
 *   **Data on the plugin, never Case Type configuration.** A Case Type saying
 *   which fields a Section may write is what made the Admin Details Section
 *   dangerous: the list came from a descriptor, so a typo PATCHed a column that
 *   did not exist and `['status']` would have written the Case status straight
 *   to the row past `CaseMachine`. What a Section writes is a fact about the
 *   Section; which Case Types have it is the descriptor's business.
 *
 *   Some fields no Section may declare at all, whatever it puts here — the ones
 *   `CaseMachine` writes and the ones the access matrix froze a copy of at
 *   load. Declaring one is refused rather than honoured.
 * @property {(tools: { dispatch: (action: any) => unknown, sectionId: string, persist: (field: string, value: any) => void, persistBlob: (blob: string, patch: Record<string, any>) => void }) => Record<string, Function>} [createActions]
 *   Optional. This Section's own callbacks, reached by its view as
 *   `actions[sectionId].whatever(...)` — one namespace rather than a new
 *   top-level `PanelActions` member per Section.
 *
 *   `persist` and `persistBlob` are the Section's way to the SaveQueue, and
 *   they honour `writes` above: a field this Section did not declare is
 *   refused, silently and in both directions — the store does not move and
 *   nothing is enqueued.
 *
 *   Called **once per mount**, not per render. A callback captured by a
 *   memoised child has to stay valid across renders, which is the same reason
 *   the page's `currentAnswers` is a getter rather than a value; a factory
 *   re-run per render would hand out a new function every time and a memoised
 *   card would keep calling the old one.
 *
 *   The page's own members win a name clash, so a Section cannot shadow one by
 *   choosing its id.
 * @property {(sectionState: any, action: any) => any} [reduce]
 *   Optional. This Section's own state transitions, over its own slice of
 *   `route.sections` and nothing else — it is handed that slice and what it
 *   returns replaces it, so it can neither read nor write another Section's.
 *
 *   Reached by the page's reducer only for an action that names this Section
 *   (`action.section === plugin.id`), after every one of the page's own
 *   branches. A lookup rather than a fold over every plugin per dispatch: the
 *   render path is on a keystroke budget, and offering each Section every
 *   action would put the cost of a new Section on every other one.
 *
 *   Returning the slice it was given is how a Section says "not mine".
 * @property {(props: SummaryBlockProps) => Node | null} [summaryView]
 *   Optional. Renders this Section's block inside the Summary, for a Section
 *   that declares `summaryBlock`. Absent means the Section contributes no
 *   block, whatever `summaryBlock` says — a Section that claims a block and
 *   does not draw one is a mistake, not a blank.
 *
 *   Handed the same props the Summary itself renders from, plus `heading`: the
 *   Case Type's override for this Section if it declares one, otherwise the
 *   Section's own `defaultLabels.heading`. Resolved by the caller so a block
 *   never has to name its own id to look its copy up.
 */

export {};
