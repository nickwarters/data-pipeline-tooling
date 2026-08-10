// @ts-check
import { GroupedBarChart } from '../../components/base/cora-grouped-bar-chart.js';

/** @typedef {import('../../evaluators/stats-report-model.js').StatsReport} StatsReport */
/** @typedef {import('../../components/base/cora-grouped-bar-chart.js').GroupedBarChartMark} GroupedBarChartMark */

const CHART_WIDTH = 720;
const CHART_HEIGHT = 320;

/**
 * The y-axis is a count of Cases, so its ticks have to be whole ones. The
 * chart's own derived domain is chosen to look tidy for arbitrary data and
 * happily lands on quarter-Cases for small numbers, so the domain is named
 * here instead: rounded up to a multiple of four, which the default five ticks
 * divide exactly, and never smaller than four so an empty range still draws a
 * readable axis rather than a scale from zero to one.
 *
 * @param {number} maxValue
 * @returns {number}
 */
function integerYMax(maxValue) {
  return Math.max(4, Math.ceil(maxValue / 4) * 4);
}

/**
 * The range's counts as a grouped bar chart, one group per bucket.
 *
 * Provenance is the only thing the two series carry: a solid bar was published
 * in the Reviewer's report, a hollow one was counted in the browser a moment
 * ago. Hollow does not mean excluded and does not mean provisional-as-in-wrong
 * — a day that is finished but not yet published is real work, and it is drawn
 * hollow beside today, which is not finished at all. What separates those two
 * is the totals below, not the bar.
 *
 * A bucket draws only the series it actually has days for, so a settled day
 * shows one bar rather than one bar and an empty slot. Monthly buckets can hold
 * both, which is exactly what the current month looks like while the report is
 * catching up.
 *
 * @param {StatsReport} report
 * @returns {SVGSVGElement}
 */
export function statsChartView(report) {
  const groups = report.buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    marks: /** @type {GroupedBarChartMark[]} */ ([
      ...(bucket.settled === null
        ? []
        : [{ key: 'settled', label: 'Settled', value: bucket.settled }]),
      ...(bucket.provisional === null
        ? []
        : [
            {
              key: 'provisional',
              label: 'Provisional',
              value: bucket.provisional,
              provisional: true,
            },
          ]),
    ]),
  }));

  const maxValue = groups.reduce(
    (max, group) =>
      group.marks.reduce(
        (groupMax, mark) => Math.max(groupMax, mark.value),
        max
      ),
    0
  );

  return GroupedBarChart({
    data: { groups },
    config: {
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
      ariaLabel: `Reportable Cases by ${report.range.grain}, ${report.range.label.toLowerCase()}`,
      yAxisLabel: 'Cases',
      yMax: integerYMax(maxValue),
    },
  });
}
