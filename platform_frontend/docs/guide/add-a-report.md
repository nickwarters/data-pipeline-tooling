# Add a report

A report is a plugin: configuration the engine reads, plus one pure view. The
engine handles everything around the view: routing, who may open which scope,
loading the file, the page states, filters, each panel's table and sort,
sizing and tooltips. [ADR-0058](../adr/0058-report-pages-are-plugins-over-report-feed-files.md)
records why. The Case Type report under `src/reports/case-type/` is the worked
example.

## 1. Agree the feed

A report reads one Report Feed file per scope: JSON stored in a `.txt` file
(SharePoint SE mis-serves `.json`), under `Shared Documents/cora_report_feeds/`.

```json
{
  "schema_version": 1,
  "report": "case-type",
  "generated_at": "2026-10-07T04:15:00+00:00",
  "complete_through": "2026-10-06",
  "datasets": {
    "backlog_daily": [
      {
        "date": "2026-10-06",
        "to_allocate": 23,
        "in_progress": 148,
        "actions_in_progress": 43
      }
    ],
    "targets": { "review_on_time": 0.9 }
  }
}
```

- `generated_at` is an instant (UTC); `complete_through` is the last local
  calendar day the figures cover. The header shows both, and the page raises a
  stale banner when `complete_through` falls behind.
- `datasets` holds every table the page draws, each one named. Adding a dataset
  is additive, so bump `schema_version` only for a change existing readers
  cannot survive.
- Put the file in its **scope's folder** (`case-types/<slug>/…`). Permissions
  are set per folder, so every report about one scope shares its audience.
- Add a placeholder copy under `dev/fixtures/reports/<same path>`. `?mock=1`
  reads it from there, and it is the frontend's statement of the contract
  until a pipeline produces the real file.

## 2. Write the model

A pure function from the envelope (and the filters) to the figures the page
needs. It does no formatting and touches no DOM. Treat **every dataset as
optional**: return `null` for a figure whose dataset is absent, so the page can
ship before the pipeline change that fills it.

```js
export function buildExampleReport(envelope, range) {
  const rows = envelope.datasets.backlog_daily;
  return {
    backlog:
      Array.isArray(rows) && rows.length > 0
        ? rows.slice(-RANGES[range].days)
        : null,
  };
}
```

## 3. Write the view

The view turns the model into content: headline tiles, snapshot panels, and
sections of panels. Write one small function per panel, so the page reads as a
list.

```js
export function exampleReportContent(model) {
  return {
    kpis: [{ key: 'open', label: 'Open', value: formatCount(model.open) }],
    now: [], // snapshot panels: "Right now"
    sections: [
      {
        id: 'over-time',
        title: 'Over time',
        filters: ['range'], // controls shown here, scoping only this section
        panels: [model.backlog ? backlogPanel(model.backlog) : null].filter(Boolean),
      },
    ],
  };
}

const backlogPanel = (backlog) => ({
  id: 'backlog',
  title: 'Open Cases at close of day',
  subtitle: 'How it is measured, in one line.',
  span: 12, // out of 12; panels go full width on a narrow page
  render: (width) => LineChart({ series: [...] }, { width, ariaLabel: '…' }),
  table: { columns: [...], rows: backlog, rowKey: (row) => row.date },
});
```

A panel's body is whatever `render(width)` returns, usually a kit chart, but
any node works. Give every chart panel a `table`; it is how keyboard and
screen-reader users read the values, and the engine adds the toggle and sorting.

## 4. Declare the plugin and list it

```js
/** @satisfies {import('../contract.js').ReportPlugin} */
export const ExampleReport = {
  id: 'example', // #/reports/example/<scope>
  title: 'Example report',
  description: 'One sentence for the reports index.',
  layout: 'stacked', // or 'rail' for a page built around one long table
  access: ['maintainer', { role: 'caseTypeOwner', of: 'scope' }],
  scope: { kind: 'case-type' }, // or { kind: 'platform' }
  feeds: { report: { path: (scope) => `case-types/${scope.key}/example.txt`, schemaVersion: 1 } },
  filters: { range: { label: 'Range', options: [...], initial: '6m' } },
  view: ({ feeds, viewer, filters }) => exampleReportContent(buildExampleReport(feeds.report, filters.range)),
};
```

Then add it to `REPORT_PLUGINS` in `src/app-config.js`. The Reports link, the
index card, the routes and the guard all follow from that list.

`viewer` is `{ user, capabilities, scope, today }`. Use it to decide what is
_relevant_ to the person looking, never what is _secret_: anyone who can read
the folder can read the whole file.

## 5. Provision the folder

```sh
node scripts/report-folder-access.js
```

This prints, for each folder, the SharePoint groups that must be able to read
it, worked out from the same `access` rules the page uses. Set those
permissions in the library. Folder permissions are the real boundary; the page
only reflects them.

## The chart kit

`src/components/charts/`: each chart is `(data, config) => SVGSVGElement`,
pure, keyed, and validated (it throws on a contract breach).

| Chart          | For                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `LineChart`    | Trends over shared x positions: 1–4 series, optional area, target line, end labels, hover columns |
| `BarList`      | Ordered or ranked categories as horizontal bars, with optional status markers                     |
| `StackBar`     | One bar split into up to six parts of a whole                                                     |
| `Sparkline`    | A trend inside a stat tile (decorative; the tile states the value)                                |
| `RangeChart`   | How long things take: a median dot and a band to the 90th percentile, per row                     |
| `StackColumns` | How a whole divided up, period by period, as columns stacked to 100%                              |
| `Heatmap`      | Magnitude on a grid (weekday × hour), in six steps of one hue with a scale                        |

Colour by **role**: `s1`…`s6` for series, in order and never cycled; `quiet`
for "the rest"; `range` for bands; `danger` and `warning` only where a mark
_means_ a status, always with a marker or label. Never use a hex value, and
never use red for a series. The validated palette behind the roles is
documented in the header of `src/styles/cora-design-tokens.css`.

## Test it

- The model, by hand-built envelopes: each rule, and each dataset missing.
- The view: panels present and absent, and every `render(width)` returns a
  chart.
- The fixture: it parses and every figure comes out non-null.

See `tests/case-type-report-*.test.js`.
