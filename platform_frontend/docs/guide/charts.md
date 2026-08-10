# Grouped charts

`GroupedBarChart({ data, config })` is a pure view builder at
[`src/components/base/cora-grouped-bar-chart.js`](../../src/components/base/cora-grouped-bar-chart.js).
It returns a detached SVG tree made only with `svg()`. A caller supplies the
data and presentation configuration; the component does not load, map, or
mutate data.

## Contract

Data uses one key per group and one key per mark within that group:

```js
{
  groups: [
    {
      key: 'week-one',
      label: 'Week one',
      marks: [
        { key: 'settled', label: 'Settled', value: 8 },
        {
          key: 'provisional',
          label: 'Provisional',
          value: 4,
          provisional: true,
        },
      ],
    },
  ],
}
```

Mark keys identify series across groups. A group may omit a mark or list its
marks in a different order; the chart keeps that mark in the same horizontal
series slot wherever it appears. Group and mark labels must be non-empty. The
chart sorts series slots by key for deterministic output. Every occurrence of a
repeated key must use the same label and effective tone (including the default
`accent` tone); a disagreement throws `TypeError` rather than silently
canonicalising misleading accessible text.

`value` must be finite and non-negative. `tone` is optional and uses an
existing design-token tone: `accent`, `success`, `warning`, `danger`, or
`info`. A provisional mark is hollow with a token-backed stroke; an ordinary
mark has a token-backed fill and stroke. The provisional bar class is a
semantic/testing marker only: it intentionally has no live CSS rule, so the
SVG attributes remain the source of the encoding. This is a visual encoding
supplied by the caller, not a second data source or an inferred status.

The required configuration is `width`, `height`, and `ariaLabel`. Optional
`margin`, `yMax`, `tickCount`, axis labels, `formatValue`, and
`formatGroupLabel` control the fixed chart geometry and copy. Invalid keys,
values, formatters, or geometry throw explicitly. An explicit `yMax` must be
positive and cover every value; derived all-zero and constant data use a
positive, sensible domain with useful ticks. `tickCount` defaults to five and
must be at least two. Text and labels are passed as SVG text nodes and
attributes, so user-provided labels are not interpreted as markup. Formatter
callbacks must return non-empty strings and a value formatter must produce
distinct y-axis tick labels. The default value formatter uses three significant
figures, so nonzero subunit values such as `0.004` do not become `0`, while
values such as `3.333` remain readable.

The left and bottom margins are clamped to safe minimums when axis labels would
otherwise be clipped by the SVG viewBox. A zero top margin remains valid; the
legend and value-label bands are reserved above the plot independently.

The chart generates one legend item per series, with the full series name in
the item's `aria-label` and `<title>`. X-axis group labels and ticks are evenly
sampled when there are more than twelve groups, retaining the first and last
group and omitting duplicate visible labels. The legend wraps to rows based on
available width and truncates only the visible label when needed. At most twelve
legend rows are accepted; an overflow throws an error naming the series and
group counts. Legend rows and a value-label band reserve space above the plot,
including when the caller supplies a zero top margin, so value labels cannot
land in the legend.

The returned root is named with `role="group"`. Each bar has its own stable
key, `role="img"`, `aria-label`, and `<title>` containing its group, series,
formatted value, and provisional status where applicable. Group and mark keys
let `core/render.js` move existing SVG nodes when the caller reorders data.

## My Stats

The my-stats route keeps one Report Feed loader and stores its envelope under
`routes.myStats.reportFeed`. A separate mapping seam can dispatch
`{ type: 'my-stats/chart-loaded', chart: { data, config } }`; when that optional
view model is present, the page renders the grouped chart, otherwise it retains
`EmptyState('No data yet.')`.

The page also snapshots four pure range descriptors on slice creation and owns
the selected range, defaulting to `week`. The ordered keys are `week`, `month`,
`3-months`, and `12-months`: Week and Month use daily buckets; the longer
ranges use monthly buckets. Each descriptor carries its label and grain,
inclusive `start`, browser-local yesterday as the inclusive totals `end`,
browser-local `today` as the display endpoint, and ordered inclusive buckets.
Daily buckets use `YYYY-MM-DD` keys and monthly buckets use `YYYY-MM` keys.
The final bucket reaches today even though totals stop at yesterday.

This is state groundwork only; the page does not yet render a picker or map the
range descriptors and Report Feed into chart values. The chart remains
data-only: it does not fetch or map the Report Feed, own range selection, or
compute a live tail. The loader behavior and provenance rules remain governed by
[ADR-0048](../adr/0048-my-stats-renders-a-report-feed-with-a-live-tail.md).

When that feed is connected, solid marks retain ADR-0048's settled/feed
provenance and hollow provisional marks retain its live-tail provenance. Hollow
does not mean excluded or zero.

Line charts, stacked bars, custom tooltips, and data loading are out of this
component's contract. HTML-over-SVG tooltip behavior is deferred to the
existing [tooltip work](https://github.com/nickwarters/data-pipeline-tooling/issues/451).
