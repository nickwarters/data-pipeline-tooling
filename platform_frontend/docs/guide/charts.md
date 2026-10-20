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
marks in a different order; multi-mark groups keep each mark in the same
horizontal series slot wherever it appears. A group with one mark centers that
bar on its x-axis tick so sparse daily data remains aligned with its label.
Group and mark labels must be non-empty. The chart sorts series slots by key for
deterministic output unless `seriesOrder` names a preferred order. Every
occurrence of a repeated key must use the same label and effective tone
(including the default `accent` tone); a disagreement throws `TypeError` rather
than silently canonicalising misleading accessible text.

`value` must be finite and non-negative. `tone` is optional and uses an
existing design-token tone: `accent`, `success`, `warning`, `danger`, `info`, or
`neutral`. `neutral` is the chart's own ink, `--cora-color-chart-ink` (grey-7 in
light, grey-5 in dark), deliberately quieter than body text so history is not
the darkest thing on the page. `seriesOrder` places listed keys into
deterministic legend and multi-mark visual slots; unlisted keys follow in key
order.

A solid mark is filled with its tone and has no outline. A `provisional` mark
keeps the same tone but is drawn as a dashed outline over a faint wash of it,
so "not yet settled" reads without spending a second colour: colour stays free
to mean the series. The legend swatch of a series with any provisional mark is
drawn the same way, so the key always matches a bar on the chart. The
`--provisional` class remains a semantic/testing marker with no live CSS rule;
the flag also reaches the accessible description and the tooltip. This is a
visual encoding supplied by the caller, not a second data source or an
inferred status.

The required configuration is `width`, `height`, and `ariaLabel`. Optional
`margin`, `yMax`, `tickCount`, `seriesOrder`, axis labels, `formatValue`,
`formatGroupLabel`, `emphasis` and `emphasisLabel` control the fixed chart
geometry, ordering, and copy. Invalid keys, values, formatters, or geometry
throw explicitly. An explicit `yMax` must be
positive and cover every value; derived all-zero and constant data use a
positive, sensible domain with useful ticks. `tickCount` defaults to five and
must be at least two. Text and labels are passed as SVG text nodes and
attributes, so user-provided labels are not interpreted as markup. Formatter
callbacks must return non-empty strings and a value formatter must produce
distinct y-axis tick labels. The default value formatter uses three significant
figures, so nonzero subunit values such as `0.004` do not become `0`, while
values such as `3.333` remain readable.

The left and bottom margins are clamped to safe minimums when axis labels would
otherwise be clipped by the SVG viewBox, whether they were supplied or left at
their defaults. A zero top margin remains valid; the legend, caption and
value-label bands are reserved above the plot independently.

### The look

The chart is drawn as hairlines and slim marks. Bars take about 62% of their
group's width and never more than 24px, with lightly rounded corners; a
multi-mark group is a cluster centred on its tick. Gridlines are hairlines at
each non-zero tick; there is no vertical axis rule and no tick marks, and the
x-axis line is the baseline. The y-axis label, when given, is a small uppercase
caption above the top-left of the plot rather than rotated down its side.

Not every bar prints its value. The peak value prints (where it is above zero),
and so does every mark of the spotlit group, a zero included; the full value of
every mark stays in its accessible name and tooltip, and a page's own table or
figures carry the rest.

### The spotlight

One group is spotlit: a tinted `--cora-color-accent-muted` band behind it, its
tag above in the accent colour, and its group label in strong text. `emphasis`
picks the group: `'latest'` (the default) for the last group, any group key, or
`'none'`. `emphasisLabel` is the tag, such as `'Today'` or `'This month'`,
defaulting to `'Latest'`. An `emphasis` that names no group throws. The band is
`aria-hidden`: the marks already name their group, so it is not announced
twice. The brand red belongs to the spotlight; the bars themselves do not need
to wear it.

### Legend and x-axis labels

The chart generates one legend item per series, with the full series name in
the item's `aria-label` and `<title>`. Legend items sit one after another at
their own width and wrap to a new row when the next would overrun the plot;
only the visible label is truncated, and only when a single item is wider than
the plot. At most twelve legend rows are accepted; an overflow throws an error
naming the series and group counts. Legend rows, a caption band (the y-axis
caption and the spotlight tag) and a value-label band reserve space above the
plot, including when the caller supplies a zero top margin, so value labels
cannot land in the legend.

X-axis group labels are thinned to a common stride wide enough that the
longest label clears its neighbour, never more than twelve, always retaining the
first and last group and omitting duplicate visible labels. A label that would
run past either edge of the chart is aligned to that edge instead of being
clipped.

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

The my-stats route reads two things and derives the chart, headline figures, and
breakdown table from them **once**.

The first is the Reviewer's Report Feed. The second is a live read of the days
the feed cannot cover yet — the tail — issued only when a feed exists and
clamped by `LIVE_TAIL_MAX_DAYS` in
[`src/services/live-tail-fetcher.js`](../../src/services/live-tail-fetcher.js)
so it can never reach further back than ten calendar days. With no feed
published there is no boundary to compute from, so no list read is issued at
all and the page says a report has not been published rather than showing an
empty one.

`buildStatsReport()` in
[`src/evaluators/stats-report-model.js`](../../src/evaluators/stats-report-model.js)
merges the two. `complete_through` is the whole boundary: a date at or before it
is answered by the file, a date after it by the live read, so neither can claim
the same day. The result carries one bucket per range bucket, each with a
`settled` and a `provisional` total (`null` where that provenance has no days),
a combined `total`, and Case Type cells. It also carries one deterministic
global Case Type column list, so every bucket has a zero cell for a type absent
from that bucket. The four headline figures use the same day counts over the
totals window.

That one report feeds all three readings. `statsChartView()` in
[`src/pages/my-stats/stats-chart-view.js`](../../src/pages/my-stats/stats-chart-view.js)
maps buckets to groups, drawing a solid `Settled` mark and a dashed-outline
`Provisional` one and omitting either where the bucket has no days of that
provenance. Both series use the `neutral` tone, so every bar is the one chart
ink and provenance is carried by the outline, the tooltip and the accessible
name. Settled is always the first series. A daily bucket therefore draws one
bar, and the current monthly bucket can draw both. The last bucket is the one
that reaches today, so it is spotlit with `emphasisLabel` `Today` on a daily
range and `This month` on a monthly one. The y-axis domain is four times the
smallest whole round step that covers the data (1, 2, 3, 4, 5, 10, 15, 20, 25,
30, 40, 50 and so on), so the ticks are whole Cases a reader counts in: 0, 20,
40, 60, 80 rather than 0, 17, 34, 51, 68. `headlineStripView()` in
[`src/pages/my-stats/headline-strip-view.js`](../../src/pages/my-stats/headline-strip-view.js)
renders the same report's figures beneath the full-width chart: total (asterisked,
`* excludes today`), average per working day with its divisor, active days, and
the busiest day with its count. The average is never labelled "avg/day". A
failed tail, or a feed older than the clamp, adds one muted line under the
figures; it never hides the settled half.

`statsBreakdownTableView()` in
[`src/pages/my-stats/stats-breakdown-table-view.js`](../../src/pages/my-stats/stats-breakdown-table-view.js)
renders the report immediately beneath the headline strip. It uses the report's
bucket labels verbatim, with one total column and one count/percentage pair for
each globally sorted Case Type. The report's feed and typed live-tail rows are
merged before both chart and table rendering, so a monthly bucket can combine
settled and provisional work while its row total still equals the chart total.
Manifest display names are resolved once in
[`src/evaluators/stats-case-type-model.js`](../../src/evaluators/stats-case-type-model.js);
unknown slugs receive safe presentation copy. The former selected-range,
feed-only `buildStatsCaseTypeBreakdown()` and My Stats `caseTypePanel()` path
are retired, and the dead `ProportionBars` component and its styles/tests were
removed with it.

The page also snapshots four pure range descriptors on slice creation and owns
the selected range, defaulting to `week`. The ordered keys are `week`, `month`,
`3-months`, and `12-months`: Week and Month use daily buckets; the longer
ranges use monthly buckets. Each descriptor carries its label and grain,
inclusive `start`, browser-local yesterday as the inclusive totals `end`,
browser-local `today` as the display endpoint, and ordered inclusive buckets.
Daily buckets use `YYYY-MM-DD` keys and monthly buckets use `YYYY-MM` keys.
The final bucket reaches today even though totals stop at yesterday. A labelled
range control group sits above the chart; its buttons dispatch
`my-stats/range-selected` and expose the active range with `aria-pressed`.

Dates are the subtle part. `ReportableAt` is an instant and every key on this
page is a browser-local calendar date; the one crossing between them is
[`src/lib/local-calendar.js`](../../src/lib/local-calendar.js), and the tail's
query bounds are the local start of the first day and of tomorrow so the filter
and the bucketing agree about where a day begins.

The loader behaviour, the provenance rules and the clamp are governed by
[ADR-0048](../adr/0048-my-stats-renders-a-report-feed-with-a-live-tail.md).

Line charts, stacked bars, custom tooltip markup, and data loading are out of
this component's contract. The route owns the HTML-over-SVG tooltip controller
around the pure chart builder.
