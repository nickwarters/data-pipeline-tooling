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
key, `role="img"`, and `aria-label` containing its group, series, formatted
value, and provisional status where applicable. Each mark rectangle also has
`tabindex="0"` and the stable `data-cora-chart-mark="true"` hook with its full
description in `data-cora-chart-description`. The per-mark SVG `<title>` is not
emitted: the HTML overlay replaces that native hover affordance while the
mark's accessible name remains its `aria-label`. Legend `<title>` elements are
retained. Group and mark keys let `core/render.js` move existing SVG nodes when
the caller reorders data.

## Tooltip

The pure chart builder does not touch `document`, `window`, or install event
listeners. When the committed chart appears on `#/my-stats`, the route mounts
one HTML `div[role="tooltip"]` under `context.appEl`, outside the reconciled
route container and SVG. Pointer hover and keyboard focus use the same mark
rectangle; a focused mark takes priority over a hovered mark. The overlay
contains the full mark description as text, wraps through CSS, uses a fixed
position above the mark with a below fallback, clamps horizontally to the
viewport, and refreshes on resize and document scrolling. Its temporary
`aria-describedby` ownership is removed when the mark changes, the chart
disappears, or the route unmounts. Escape dismisses the current tooltip even
when it was opened by pointer hover.

## My Stats

The my-stats route keeps one Report Feed loader and stores its envelope under
`routes.myStats.reportFeed`. `buildStatsCaseTypeBreakdown()` in
[`src/evaluators/stats-case-type-model.js`](../../src/evaluators/stats-case-type-model.js)
selects feed rows for the existing selected range and builds the Case Type
totals and proportions. It compares the feed's ISO date strings directly with
the descriptor's inclusive `start` and `end`; because `end` is yesterday,
today's work is excluded. Duplicate sparse rows are folded by `case_type`, and
only positive totals are shown. The evaluator resolves registered slugs through
`case-types/manifest.js`'s `displayNameFor()`; an unknown slug gets presentation
copy only, never a raw slug in visible or accessible text.

The pure [`ProportionBars`](../../src/components/base/cora-proportion-bars.js)
view renders that resolved shape as a semantic list. Each row shows its Case
Type label and count, and exposes a bounded `role="progressbar"` with a
percentage width and accessible label. The my-stats page places the panel alone
when it is the only available feed-backed content, or in the left `1fr` column
of `cora-my-stats-top-row` beside the chart's right `2fr` column when both are
present. A feed with no selected-range counts shows `No data for this range.`;
an absent feed and chart still show the page-level `No data yet.`.

A separate mapping seam can still dispatch
`{ type: 'my-stats/chart-loaded', chart: { data, config } }`; the route keeps
that `chart` state and the existing tooltip ownership unchanged. The current
Case Type panel does not map feed rows into the chart, compute a live tail, or
include live work in its totals. Those provenance and live-tail connections
remain separate deferred work.

The page also snapshots four pure range descriptors on slice creation and owns
the selected range, defaulting to `week`. The ordered keys are `week`, `month`,
`3-months`, and `12-months`: Week and Month use daily buckets; the longer
ranges use monthly buckets. Each descriptor carries its label and grain,
inclusive `start`, browser-local yesterday as the inclusive totals `end`,
browser-local `today` as the display endpoint, and ordered inclusive buckets.
Daily buckets use `YYYY-MM-DD` keys and monthly buckets use `YYYY-MM` keys.
The final bucket reaches today even though totals stop at yesterday.

The page still does not render a range picker. Range selection is existing route
state used by the Case Type evaluator; the chart remains data-only and does not
fetch or map the Report Feed, own range selection, or compute a live tail. The
loader behavior and provenance rules remain governed by
[ADR-0048](../adr/0048-my-stats-renders-a-report-feed-with-a-live-tail.md).

When that feed is connected, solid marks retain ADR-0048's settled/feed
provenance and hollow provisional marks retain its live-tail provenance. Hollow
does not mean excluded or zero.

Line charts, stacked bars, custom tooltip markup, and data loading are out of
this component's contract. The route owns the HTML-over-SVG tooltip controller
around the pure chart builder.
