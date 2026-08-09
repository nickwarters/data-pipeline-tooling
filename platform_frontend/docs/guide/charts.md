# Grouped charts

`GroupedBarChart({ data, config })` is a pure view builder at
[`src/components/base/cora-grouped-bar-chart.js`](../../src/components/base/cora-grouped-bar-chart.js).
It returns a detached SVG tree made only with `svg()`. A caller supplies the
data and presentation configuration; the component does not load, sort, or
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
  ];
}
```

Mark keys identify series across groups. A group may omit a mark or list its
marks in a different order; the chart keeps that mark in the same horizontal
series slot wherever it appears. The first occurrence of a mark key supplies
the generated legend label and tone.

`value` must be finite and non-negative. `tone` is optional and uses an
existing design-token tone: `accent`, `success`, `warning`, `danger`, or
`info`. A provisional mark is hollow with a token-backed stroke; an ordinary
mark has a token-backed fill and stroke. This is a visual encoding supplied by
the caller, not a second data source or an inferred status.

The required configuration is `width`, `height`, and `ariaLabel`. Optional
`margin`, `yMax`, `tickCount`, axis labels, `formatValue`, and
`formatGroupLabel` control the fixed chart geometry and copy. Invalid keys,
values, formatters, or geometry throw explicitly. An explicit `yMax` must be
positive and cover every value; derived all-zero data uses a positive fallback
domain. `tickCount` defaults to five and must be at least two. Text and labels
are passed as SVG text nodes and attributes, so user-provided labels are not
interpreted as markup.

The chart generates a plain visible series key from the mark keys, labels, and
design-token tones. X-axis group labels and ticks are evenly sampled when
there are more than twelve groups, retaining the first and last group, so
large daily inputs remain readable.

The returned root is named with `role="group"`, preserving the descendant mark
semantics. Each bar has its own stable key, `role="img"`, `aria-label`, and
`<title>`. Group and mark keys let `core/render.js` move existing SVG nodes when
the caller reorders data.

## My Stats

The my-stats route keeps its initial `routes.myStats` value as `{}`. If a
caller supplies `routes.myStats.chart` with `{ data, config }`, the page renders
the grouped chart; otherwise it retains `EmptyState('No data yet.')`. The
current page does not fetch the Report Feed, choose a date range, or compute a
live tail. Those seams remain for the later feed work described by
[ADR-0048](../adr/0048-my-stats-renders-a-report-feed-with-a-live-tail.md).

When that feed is connected, solid marks retain ADR-0048's settled/feed
provenance and hollow provisional marks retain its live-tail provenance. Hollow
does not mean excluded or zero.

Line charts, stacked bars, custom tooltips, and data loading are out of this
component's contract. HTML-over-SVG tooltip behavior is deferred to the
existing [tooltip work](https://github.com/nickwarters/data-pipeline-tooling/issues/451).
