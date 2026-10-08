// @ts-check

/**
 * The report plugin contract: what a report says about itself, and what the
 * engine hands its view.
 *
 * A report is configuration plus one view function. The configuration is data
 * the engine reads — who may open it, which files it reads, which filters it
 * offers, which layout it uses — and the view turns loaded files into
 * content. Everything between the two belongs to the engine: routing, the
 * guard, loading, the page states, the filter and table controls, sizing and
 * tooltips. No report writes any of it.
 *
 * This module declares types only.
 */

/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../core/chrome-state.js').ChromeState} ChromeState */
/** @typedef {import('../components/charts/chart-kit.js').ChartRole} ChartRole */
/** @typedef {import('../views/data-table.js').TableSort} TableSort */

/**
 * A role that holds everywhere, regardless of scope.
 *
 * @typedef {'maintainer' | 'reviewer' | 'adviser' | 'controls' | 'reviewerManager' | 'responsiblePartyManager'} PlatformRole
 */

/**
 * A role that holds for particular Case Types only, and so admits a viewer
 * only to the scopes it covers.
 *
 * @typedef {'caseTypeOwner' | 'journeyOwner' | 'caseTypeReviewer'} CaseTypeRole
 */

/**
 * One entry in a report's audience. A bare role admits its holders to every
 * scope; `{ role, of: 'scope' }` admits a holder only to the Case Types the
 * role covers; `{ group }` admits the members of one named SharePoint group to
 * every scope, for a report whose audience is no role at all.
 *
 * @typedef {PlatformRole | { role: CaseTypeRole, of: 'scope' } | { group: string }} ReportAccessRule
 */

/**
 * What a report is about. `case-type` reports have one scope per Case Type;
 * a `platform` report has exactly one scope, the platform itself.
 *
 * @typedef {{ kind: 'case-type' } | { kind: 'platform' }} ReportScopeKind
 */

/**
 * One scope a viewer can open.
 *
 * @typedef {{ kind: 'case-type' | 'platform', key: string, label: string }} ReportScope
 */

/**
 * One file a report reads. The path is relative to the report-feed library,
 * and the folder it sits in is the unit SharePoint permissions are set on —
 * every file in one scope's folder is readable by exactly the same people.
 *
 * @typedef {Object} ReportFeedSpec
 * @property {(scope: ReportScope) => string} path
 * @property {number} schemaVersion
 */

/**
 * A control a section can show, such as a date range.
 *
 * @typedef {Object} ReportFilterSpec
 * @property {string} label
 * @property {{ key: string, label: string }[]} options
 * @property {string} initial
 */

/**
 * A Report Feed as the loader returns it. `datasets` holds the named tables;
 * the rest is the envelope every feed shares.
 *
 * @typedef {Object} ReportEnvelope
 * @property {number} schema_version
 * @property {string} [report]
 * @property {string} [generated_at] the instant the file was written (UTC)
 * @property {string} [complete_through] the last local calendar day it covers
 * @property {Record<string, any>} datasets
 */

/**
 * Who is looking, handed to a report's view.
 *
 * @typedef {Object} ReportViewer
 * @property {ChromeState['currentUser']} user
 * @property {Capabilities} capabilities
 * @property {ReportScope} scope
 * @property {string} today the browser's local calendar date, `YYYY-MM-DD`
 */

/**
 * A stat tile's content.
 *
 * @typedef {Object} StatTileSpec
 * @property {string} key
 * @property {string} label
 * @property {string} value already formatted
 * @property {string} [unit]
 * @property {'danger' | 'warning'} [status] a status marker drawn before the
 *   label; it always comes with the label that names it
 * @property {{ text: string, direction: 'up' | 'down' | 'flat', tone: 'good' | 'bad' | 'neutral' }} [delta]
 * @property {number[]} [trend] oldest first, drawn as a sparkline
 * @property {{ value: number, target: number, label: string }} [meter]
 */

/**
 * One column of a panel's table view. The same descriptor the shared data
 * table takes.
 *
 * @typedef {import('../views/data-table.js').ColumnDescriptor<any>} ReportTableColumn
 */

/**
 * One panel. `render` draws the panel's body at the width the engine gives it
 * — usually a chart, but any node is fine. `table` is the same content as rows
 * and columns, which the panel's Table toggle shows instead.
 *
 * @typedef {Object} ReportPanelSpec
 * @property {string} id unique within the report; keys the toggle and sort
 * @property {string} title what is shown
 * @property {string} [subtitle] how it is measured, in one line
 * @property {number} [span] columns out of 12 on a wide screen; default 12
 * @property {string[]} [chips] short tags, such as "Snapshot"
 * @property {string} [note] a caveat under the body
 * @property {{ label: string, role: ChartRole, shape?: 'swatch' | 'line' }[]} [legend]
 * @property {(width: number) => Node} render
 * @property {{ columns: ReportTableColumn[], rows: any[], rowKey: (row: any) => string }} [table]
 */

/**
 * A titled group of panels, optionally carrying filter controls that apply to
 * the panels inside it and nothing else.
 *
 * @typedef {Object} ReportSectionSpec
 * @property {string} id
 * @property {string} title
 * @property {string} [scope] a short line saying what the section covers
 * @property {string[]} [filters] names of the report's filters shown here
 * @property {ReportPanelSpec[]} panels
 */

/**
 * What a report's view returns. `kpis` and `now` are the "Right now" content:
 * where they go is the layout's decision, not the view's.
 *
 * @typedef {Object} ReportContent
 * @property {StatTileSpec[]} [kpis]
 * @property {ReportPanelSpec[]} [now]
 * @property {ReportSectionSpec[]} [sections]
 */

/**
 * A report.
 *
 * @typedef {Object} ReportPlugin
 * @property {string} id the URL segment: `#/reports/<id>/<scope>`
 * @property {string} title
 * @property {string} description one sentence for the reports index
 * @property {'stacked' | 'rail'} layout
 * @property {readonly ReportAccessRule[]} access
 * @property {ReportScopeKind} scope
 * @property {Readonly<Record<string, ReportFeedSpec>>} feeds the first is the
 *   primary feed, whose dates the header shows
 * @property {Readonly<Record<string, ReportFilterSpec>>} [filters]
 * @property {number} [staleAfterWorkingDays] how many working days the primary
 *   feed may run behind before the page says so; default 2
 * @property {(input: {
 *   feeds: Record<string, ReportEnvelope>,
 *   viewer: ReportViewer,
 *   filters: Record<string, string>,
 * }) => ReportContent} view
 */

export {};
