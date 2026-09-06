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
 */

export {};
