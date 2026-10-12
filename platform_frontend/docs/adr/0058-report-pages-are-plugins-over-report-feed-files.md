# 58. Report pages are plugins over Report Feed files

Date: 2026-10-07

## Status

Accepted.

Generalises the consumer side of the data pipeline's
[ADR-0018](../../../docs/adr/0018-report-feeds-published-locally-delivered-outside-the-framework.md)
(Report Feeds are JSON in `.txt` files, published to `Shared
Documents/cora_report_feeds/`, kept rather than deleted when stale) from one
page to any number of them. Follows the plugin pattern of
[ADR-0053](./0053-section-plugin-architecture.md) and
[ADR-0055](./0055-pages-are-plugins-of-the-composition-root.md), the pure-view
rule of [ADR-0039](./0039-view-produces-render-commits.md), and the SVG builder
of [ADR-0047](./0047-svg-view-builder-beside-h.md).

Does not change [ADR-0048](./0048-my-stats-renders-a-report-feed-with-a-live-tail.md)
or [ADR-0049](./0049-team-stats-renders-the-team-report-feed.md). My Stats keeps
its own page, palette and live tail; moving it onto this frame is #1018.

## Context

My Stats proved the shape: a pipeline computes figures offline, publishes
them as a file, and the browser renders the file instead of querying lists.
The next reports (one per Case Type, one per manager's team, and others) need
the same thing, and My Stats wrote all of it by hand: about 400 lines of route
slice to load one file, tell a missing file from a failed one, hold a range
control, and mount a tooltip, around one chart that colours its series with
status tones.

Writing that again for every report would cost the same each time and drift
each time. Four questions had to be settled before building more:

- **Who may see a report, and what enforces it.** A Report Feed is a file in a
  document library. Whoever can read the folder can read the file, whatever
  the page shows, so any rule in the browser only shapes the user interface.
  Setting folder permissions per person was rejected as unmaintainable at
  hundreds of people. A list with "read own items" would need _Created By_
  overridden, which the environment cannot do.
- **How a report is declared.** Code or configuration, and how much of each.
- **How a page is laid out**, so ten reports read as one product.
- **How charts are coloured**, given the brand palette has one red that
  already means both "brand" and "danger".

## Decision

### A report is a plugin: configuration plus one view

```js
export const CaseTypeReport = {
  id: 'case-type',
  title: 'Case Type report',
  description: '…',
  layout: 'stacked',                                     // or 'rail'
  access: ['maintainer', { role: 'caseTypeOwner', of: 'scope' }],
  scope: { kind: 'case-type' },                          // or 'platform'
  feeds: { report: { path: (scope) => `case-types/${scope.key}/case-type.txt`, schemaVersion: 1 } },
  filters: { range: { label: 'Range', options: [...], initial: '6m' } },
  view: ({ feeds, viewer, filters }) => ({ kpis, now, sections }),
};
```

`APP_CONFIG.reportPlugins` lists them. Two page entries, `#/reports` (the index)
and `#/reports/:report/:scope`, serve every report; adding one is a plugin
module and one entry in that list. The **report engine**
(`src/reports/report-engine.js`) is an ordinary route slice and owns everything
around the view: resolving the scope and whether the viewer may open it,
loading each file with the mount's abort signal, the page states, filters,
each panel's table toggle and sort, the page width, and tooltips. The view is
pure, gets `{ feeds, viewer, filters }`, and returns content: headline tiles,
snapshot panels and titled sections of panels. A panel's `render(width)` may
return any node, usually a chart.

### Access is declared once, as data, and read twice

`access` names roles from a fixed vocabulary. Platform roles (`maintainer`,
`reviewer`, `controls`, …) admit a viewer to every scope. Case Type roles
(`caseTypeOwner`, `journeyOwner`, `caseTypeReviewer`, written
`{ role, of: 'scope' }`) admit a viewer only to the Case Types the role covers.
`src/reports/report-access.js` resolves each role two ways:

- to a capability the browser already holds, which drives the Reports link,
  the index, the scope switcher and the page's own guard; and
- to the SharePoint groups that grant it, which
  `scripts/report-folder-access.js` prints per folder for whoever provisions
  the library.

The folder is the boundary, and the browser is presentation only, as
everywhere else in this app (ADR-0010). Deriving both readings from one
declaration means the page and the folders can only disagree if someone edits
a folder by hand. If they do, a forbidden file comes back 403 and the page
says "You don't have access to this report", the same as a refused scope.

It is data rather than a guard function because a provisioning script cannot
read a function. The evaluation logic stays in code, in one module, so this is
the kind of declaration ADR-0035 allows: a Case Type or report selects from a
fixed list of roles, and the rules that evaluate them stay in code.

### One file per report and scope; permissions on the scope folder

A report reads one file per scope (more are allowed; the first declared is the
primary, whose dates the header shows). The file holds every dataset the page
draws, under `datasets`, beside the shared envelope (`schema_version`,
`generated_at`, `complete_through`). One file means one fetch and one access
answer, so a page is loaded, missing, forbidden, failed or stale as a whole and
is never half-drawn. Folders are per scope (`case-types/complaints/`), so every
report about one Case Type sits behind the same groups.

A missing file (404) is "not published yet", and a forbidden one (401/403) is
"no access". Neither is an error. A file whose `complete_through` has fallen
more than two working days behind (`staleAfterWorkingDays` per report) is still
shown, under a banner, because it states its own date (ADR-0018).

Every dataset is optional in a report's model, and a panel whose data is
absent is left out. That lets the page ship before the pipeline change that
fills it.

### Two layouts, chosen by the plugin, placed by the frame

- **`stacked`**: header, a **Right now** section (headline tiles and snapshot
  panels, "As at close of …"), then the report's sections.
- **`rail`**: the header and headline tiles in a sticky left rail, so they stay
  in view beside a long main column. Below 900px it folds back into
  `stacked`.

A section may carry filter controls, and they scope only that section's
panels, so a snapshot never sits under a range control it ignores. Panels sit
on a 12-column grid by `span` and go single-column below 640px. The engine
observes the page width once and holds it in state. Chart widths are worked
out from it, and no panel measures itself, so every view stays a pure
function of state (ADR-0039).

### The chart kit and its palette

`src/components/charts/` holds pure `(data, config) => SVGSVGElement` charts
(`LineChart`, `BarList`, `StackBar`, `Sparkline`, sharing `chart-kit.js`). They
colour by **role**, never by hex value: six series slots (`--cora-viz-series-1`…`6`),
`quiet`, `range`, and the existing `danger` and `warning` status tokens.
Each mark carries the attributes the existing tooltip controller reads, and
each panel can show its chart as a table.

The series palette is the one deliberate exception to the brand palette, and
was validated as an ordered set against CORA's own surfaces with the dataviz
validator. The worst adjacent colour-blind ΔE is 16.3 in light mode and 13.0 in
dark. Orange is left out because it sits too close to brand red (normal-vision
ΔE 13.1). **Red is never a series colour.** In a chart it means danger
(overdue, the worst outcome) and always comes with a marker or label. CORA's
danger and warning colours fail colour-blind separation from each other (ΔE
3.5), so a status never rests on colour alone.

## Consequences

- **A new report is a plugin module, a model, a view and one line in the
  composition root.** Everything else is shared. See
  [`docs/guide/add-a-report.md`](../guide/add-a-report.md).
- **The page is only as private as the folder.** Per-viewer shaping inside a
  view is for relevance, not secrecy: anything one person must not see has to
  live in a file they cannot read. Data about named individuals therefore needs
  a file per audience, not a filter in the view.
- **Provisioning has a source of truth but is not automated.**
  `scripts/report-folder-access.js` says what each folder must allow; nothing
  applies it yet, and nothing checks a live library against it.
- **Each report's feed is a new contract with the pipeline**, versioned by its
  own `schema_version`. The placeholder fixtures under
  `dev/fixtures/reports/` are the frontend's statement of that contract until a
  pipeline produces the files.
- **Two chart vocabularies exist until #1018 lands.** `GroupedBarChart` still
  takes status tones for My Stats, and the new kit takes roles.
