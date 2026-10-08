// @ts-check

/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../core/chrome-state.js').ChromeState} ChromeState */
/** @typedef {import('../components/charts/chart-kit.js').ChartRole} ChartRole */
/** @typedef {import('../views/data-table.js').TableSort} TableSort */

/** @typedef {'maintainer' | 'reviewer' | 'adviser' | 'controls' | 'reviewerManager' | 'responsiblePartyManager'} PlatformRole */

/** @typedef {'caseTypeOwner' | 'journeyOwner' | 'caseTypeReviewer'} CaseTypeRole */

/** @typedef {PlatformRole | { role: CaseTypeRole, of: 'scope' } | { group: string }} ReportAccessRule */

/** @typedef {{ kind: 'case-type' } | { kind: 'platform' }} ReportScopeKind */

/** @typedef {{ kind: 'case-type' | 'platform', key: string, label: string }} ReportScope */

/**
 * @typedef {Object} ReportFeedSpec
 * @property {(scope: ReportScope) => string} path
 * @property {number} schemaVersion
 */

/**
 * @typedef {Object} ReportFilterSpec
 * @property {string} label
 * @property {{ key: string, label: string }[]} options
 * @property {string} initial
 */

/**
 * @typedef {Object} ReportEnvelope
 * @property {number} schema_version
 * @property {string} [report]
 * @property {string} [generated_at] UTC instant
 * @property {string} [complete_through] last covered local day
 * @property {Record<string, any>} datasets
 */

/**
 * @typedef {Object} ReportViewer
 * @property {ChromeState['currentUser']} user
 * @property {Capabilities} capabilities
 * @property {ReportScope} scope
 * @property {string} today local date, `YYYY-MM-DD`
 */

/**
 * @typedef {Object} StatTileSpec
 * @property {string} key
 * @property {string} label
 * @property {string} value already formatted
 * @property {string} [unit]
 * @property {'danger' | 'warning'} [status]
 * @property {{ text: string, direction: 'up' | 'down' | 'flat', tone: 'good' | 'bad' | 'neutral' }} [delta]
 * @property {number[]} [trend] oldest first
 * @property {{ value: number, target: number, label: string }} [meter]
 */

/** @typedef {import('../views/data-table.js').ColumnDescriptor<any>} ReportTableColumn */

/**
 * @typedef {Object} ReportPanelSpec
 * @property {string} id
 * @property {string} title
 * @property {string} [subtitle]
 * @property {number} [span] columns out of 12
 * @property {string[]} [chips]
 * @property {string} [note]
 * @property {{ label: string, role: ChartRole, shape?: 'swatch' | 'line' }[]} [legend]
 * @property {(width: number) => Node} render
 * @property {{ columns: ReportTableColumn[], rows: any[], rowKey: (row: any) => string }} [table]
 */

/**
 * @typedef {Object} ReportSectionSpec
 * @property {string} id
 * @property {string} title
 * @property {string} [scope]
 * @property {string[]} [filters]
 * @property {ReportPanelSpec[]} panels
 */

/**
 * @typedef {Object} ReportContent
 * @property {StatTileSpec[]} [kpis]
 * @property {ReportPanelSpec[]} [now]
 * @property {ReportSectionSpec[]} [sections]
 */

/**
 * @typedef {Object} ReportPlugin
 * @property {string} id URL segment: `#/reports/<id>/<scope>`
 * @property {string} title
 * @property {string} description
 * @property {'stacked' | 'rail'} layout
 * @property {readonly ReportAccessRule[]} access
 * @property {ReportScopeKind} scope
 * @property {Readonly<Record<string, ReportFeedSpec>>} feeds
 * @property {Readonly<Record<string, ReportFilterSpec>>} [filters]
 * @property {number} [staleAfterWorkingDays]
 * @property {(input: {
 *   feeds: Record<string, ReportEnvelope>,
 *   viewer: ReportViewer,
 *   filters: Record<string, string>,
 * }) => ReportContent} view
 */

export {};
