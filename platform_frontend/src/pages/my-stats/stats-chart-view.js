// @ts-check
import { GroupedBarChart } from '../../components/base/cora-grouped-bar-chart.js';

/** @typedef {import('../../evaluators/stats-report-model.js').StatsReport} StatsReport */
/** @typedef {import('../../components/base/cora-grouped-bar-chart.js').GroupedBarChartMark} GroupedBarChartMark */

const CHART_WIDTH = 720;
const CHART_HEIGHT = 320;

const TICK_INTERVALS = 4;
const TICK_STEP_MULTIPLIERS = [1, 1.5, 2, 2.5, 3, 4, 5];

/**
 * The y-axis is a count of Cases, so its ticks have to be whole ones, and they
 * should be numbers a reader counts in: 0, 20, 40, 60, 80 rather than 0, 17,
 * 34, 51, 68. The chart's own derived domain is chosen to look tidy for
 * arbitrary data and happily lands on quarter-Cases for small numbers, so the
 * domain is named here instead: four times the smallest whole round step that
 * covers the data, and never smaller than four so an empty range still draws a
 * readable axis rather than a scale from zero to one.
 *
 * @param {number} maxValue
 * @returns {number}
 */
function wholeTickYMax(maxValue) {
  const needed = maxValue / TICK_INTERVALS;
  for (let magnitude = 1; ; magnitude *= 10) {
    for (const multiplier of TICK_STEP_MULTIPLIERS) {
      const step = multiplier * magnitude;
      if (Number.isInteger(step) && step >= needed) {
        return step * TICK_INTERVALS;
      }
    }
  }
}

/**
 * The range's counts as a grouped bar chart, one group per bucket.
 *
 * Provenance is the only thing the two series carry: settled counts came from
 * the Reviewer's report and provisional counts were computed in the browser a
 * moment ago. Both are the same count of the same work, so both wear the one
 * neutral chart ink; the provisional series is drawn as a dashed outline, which
 * says "not yet published" without spending a colour on it. The settled series
 * is always placed first. A day that is finished but not yet published is real
 * work, and today is not finished at all. What separates those two is the
 * totals below, not the bar's height.
 *
 * The last bucket is always the one that reaches today, so it is spotlit and
 * tagged with the period it is: today on a daily range, this month on a
 * monthly one. The brand red belongs to that tag and band alone.
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
        : [
            {
              key: 'settled',
              label: 'Settled',
              value: bucket.settled,
              tone: 'neutral',
            },
          ]),
      ...(bucket.provisional === null
        ? []
        : [
            {
              key: 'provisional',
              label: 'Provisional',
              value: bucket.provisional,
              provisional: true,
              tone: 'neutral',
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
      seriesOrder: ['settled', 'provisional'],
      yMax: wholeTickYMax(maxValue),
      emphasisLabel: report.range.grain === 'day' ? 'Today' : 'This month',
    },
  });
}
