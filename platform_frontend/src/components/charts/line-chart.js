// @ts-check
import { svg } from '../../lib/html.js';
import {
  evenIndexes,
  formatCount,
  linearScale,
  markAttributes,
  niceAxis,
  paint,
  requireFiniteValues,
  textWidth,
} from './chart-kit.js';

/** @typedef {import('./chart-kit.js').ChartRole} ChartRole */

/**
 * @typedef {Object} LineSeries
 * @property {string} key
 * @property {string} label
 * @property {ChartRole} role
 * @property {{ x: string, y: number }[]} points
 */

/**
 * @typedef {Object} LineChartConfig
 * @property {number} width
 * @property {number} [height]
 * @property {string} ariaLabel
 * @property {(x: string) => string} [formatX]
 * @property {(x: string) => string} [describeX]
 * @property {(y: number) => string} [formatY]
 * @property {[number, number]} [yDomain]
 * @property {boolean} [area]
 * @property {boolean} [dots]
 * @property {{ value: number, label: string }} [target]
 */

const MARGIN_TOP = 12;
const MARGIN_BOTTOM = 26;
const END_LABEL_GAP = 10;
const END_LABEL_SPACING = 14;
const DEFAULT_HEIGHT = 200;

/**
 * @param {{ series: LineSeries[] }} data
 * @param {LineChartConfig} config
 * @returns {SVGSVGElement}
 */
export function LineChart(data, config) {
  const series = data?.series;
  if (!Array.isArray(series) || series.length === 0) {
    throw new TypeError('LineChart needs at least one series');
  }
  const count = series[0].points.length;
  if (count < 2) {
    throw new RangeError('LineChart needs at least two points to draw a line');
  }
  for (const line of series) {
    if (line.points.length !== count) {
      throw new RangeError('every LineChart series needs the same x positions');
    }
    requireFiniteValues(
      line.points.map((point) => point.y),
      `LineChart series "${line.key}"`
    );
  }

  const {
    width,
    height = DEFAULT_HEIGHT,
    ariaLabel,
    formatX = (x) => x,
    describeX = formatX,
    formatY = formatCount,
    yDomain,
    area = false,
    dots = false,
    target,
  } = config;

  const values = series.flatMap((line) => line.points.map((point) => point.y));
  if (yDomain && !(yDomain[0] < yDomain[1])) {
    throw new RangeError(
      'LineChart yDomain must run from a lower to a higher value'
    );
  }
  if (!yDomain && values.some((value) => value < 0)) {
    throw new RangeError(
      'LineChart values below zero need a yDomain that includes them'
    );
  }
  const axis = yDomain
    ? { min: yDomain[0], max: yDomain[1], step: (yDomain[1] - yDomain[0]) / 4 }
    : { min: 0, ...niceAxis(Math.max(...values)) };

  const tickValues = [];
  for (let v = axis.min; v <= axis.max + axis.step / 1000; v += axis.step) {
    tickValues.push(v);
  }
  const tickLabels = tickValues.map(formatY);

  const lastIndex = count - 1;
  const endLabelWidth = Math.max(
    ...series.map(
      (line) =>
        textWidth(formatY(line.points[lastIndex].y)) +
        (series.length > 1 ? textWidth(line.label) + 6 : 0)
    )
  );
  const left = Math.max(
    32,
    Math.max(...tickLabels.map((l) => textWidth(l))) + 10
  );
  const right = endLabelWidth + END_LABEL_GAP + 6;
  const plotRight = width - right;
  if (plotRight - left < 40) {
    throw new RangeError(`LineChart is too narrow to draw at ${width}px`);
  }

  const x = linearScale(0, lastIndex, left, plotRight);
  const y = linearScale(axis.min, axis.max, height - MARGIN_BOTTOM, MARGIN_TOP);
  const baseline = y(axis.min);

  const grid = svg(
    'g',
    { className: 'cora-chart__grid', key: 'grid' },
    tickValues.map((value, i) =>
      svg(
        'g',
        { key: `tick-${i}` },
        svg('line', {
          className:
            i === 0 ? 'cora-chart__axis-line' : 'cora-chart__grid-line',
          key: 'line',
          x1: left,
          x2: plotRight,
          y1: y(value),
          y2: y(value),
        }),
        svg(
          'text',
          {
            className: 'cora-chart__tick-label',
            key: 'label',
            x: left - 6,
            y: y(value) + 4,
            'text-anchor': 'end',
          },
          tickLabels[i]
        )
      )
    )
  );

  const xLabels = series[0].points.map((point) => formatX(point.x));
  const labelSpacing = Math.max(...xLabels.map((l) => textWidth(l))) + 18;
  const xAxis = svg(
    'g',
    { className: 'cora-chart__x-axis', key: 'x-axis' },
    evenIndexes(
      count,
      Math.max(2, Math.floor((plotRight - left) / labelSpacing))
    ).map((i) =>
      svg(
        'text',
        {
          className: 'cora-chart__tick-label',
          key: `x-${i}`,
          x: x(i),
          y: height - 8,
          'text-anchor': i === 0 ? 'start' : i === lastIndex ? 'end' : 'middle',
        },
        xLabels[i]
      )
    )
  );

  const targetLayer = target
    ? targetView(target, series[0], x, y, left, plotRight)
    : null;

  const lines = svg(
    'g',
    { className: 'cora-line-chart__lines', key: 'lines' },
    series.map((line) => {
      const d = line.points
        .map(
          (point, i) =>
            `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(point.y).toFixed(1)}`
        )
        .join('');
      return svg(
        'g',
        { className: 'cora-line-chart__series', key: line.key },
        area && series.length === 1
          ? svg('path', {
              className: 'cora-line-chart__area',
              key: 'area',
              d: `${d}L${x(lastIndex).toFixed(1)},${baseline}L${x(0).toFixed(1)},${baseline}Z`,
              fill: paint(line.role),
            })
          : null,
        svg('path', {
          className: 'cora-line-chart__line',
          key: 'line',
          d,
          fill: 'none',
          stroke: paint(line.role),
        }),
        (dots ? line.points.map((_, i) => i) : [lastIndex]).map((i) =>
          svg('circle', {
            className: 'cora-line-chart__dot',
            key: `dot-${i}`,
            cx: x(i),
            cy: y(line.points[i].y),
            r: i === lastIndex ? 4 : 3.5,
            fill: paint(line.role),
          })
        )
      );
    })
  );

  const endLabels = endLabelsView(series, x(lastIndex), y, formatY);

  const columnWidth = (plotRight - left) / lastIndex;
  const columns = svg(
    'g',
    {
      className: 'cora-line-chart__columns',
      key: 'columns',
      'aria-hidden': 'true',
    },
    series[0].points.map((point, i) => {
      const cx = x(i);
      const description = `${describeX(point.x)}: ${series
        .map((line) => `${line.label} ${formatY(line.points[i].y)}`)
        .join(', ')}`;
      return svg(
        'g',
        { className: 'cora-line-chart__column', key: point.x },
        svg('line', {
          className: 'cora-line-chart__crosshair',
          key: 'crosshair',
          x1: cx,
          x2: cx,
          y1: MARGIN_TOP,
          y2: baseline,
        }),
        series.map((line) =>
          svg('circle', {
            className: 'cora-line-chart__hover-dot',
            key: line.key,
            cx,
            cy: y(line.points[i].y),
            r: 4,
            fill: paint(line.role),
          })
        ),
        svg('rect', {
          className: 'cora-line-chart__hit',
          key: 'hit',
          x: Math.max(left, cx - columnWidth / 2),
          y: MARGIN_TOP,
          width:
            Math.min(plotRight, cx + columnWidth / 2) -
            Math.max(left, cx - columnWidth / 2),
          height: baseline - MARGIN_TOP,
          fill: 'transparent',
          ...markAttributes(description, { focusable: false }),
        })
      );
    })
  );

  return /** @type {SVGSVGElement} */ (
    svg(
      'svg',
      {
        className: 'cora-chart cora-line-chart',
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        role: 'img',
        'aria-label': ariaLabel,
      },
      grid,
      xAxis,
      targetLayer,
      lines,
      endLabels,
      columns
    )
  );
}

/**
 * @param {{ value: number, label: string }} target
 * @param {LineSeries} line
 * @param {(i: number) => number} x
 * @param {(v: number) => number} y
 * @param {number} left
 * @param {number} plotRight
 */
function targetView(target, line, x, y, left, plotRight) {
  const points = line.points;
  const from = Math.floor(points.length * 0.15);
  const to = Math.min(points.length - 1, Math.ceil(points.length * 0.85));
  let best = from;
  for (let i = from; i <= to; i++) {
    if (
      Math.abs(points[i].y - target.value) >
      Math.abs(points[best].y - target.value)
    ) {
      best = i;
    }
  }
  const dataBelow = points[best].y < target.value;
  const lineY = y(target.value);
  return svg(
    'g',
    { className: 'cora-chart__target', key: 'target' },
    svg('line', {
      className: 'cora-chart__target-line',
      key: 'line',
      x1: left,
      x2: plotRight,
      y1: lineY,
      y2: lineY,
    }),
    svg(
      'text',
      {
        className: 'cora-chart__target-label',
        key: 'label',
        x: x(best),
        y: dataBelow ? lineY - 6 : lineY + 14,
        'text-anchor': 'middle',
      },
      target.label
    )
  );
}

/**
 * @param {LineSeries[]} series
 * @param {number} endX
 * @param {(v: number) => number} y
 * @param {(v: number) => string} formatY
 */
function endLabelsView(series, endX, y, formatY) {
  const ends = series
    .map((line) => {
      const value = line.points[line.points.length - 1].y;
      return { line, value, at: y(value), labelY: y(value) };
    })
    .sort((a, b) => a.at - b.at);
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].labelY - ends[i - 1].labelY < END_LABEL_SPACING) {
      ends[i].labelY = ends[i - 1].labelY + END_LABEL_SPACING;
    }
  }
  return svg(
    'g',
    { className: 'cora-line-chart__end-labels', key: 'end-labels' },
    ends.map(({ line, value, at, labelY }) =>
      svg(
        'g',
        { key: line.key },
        labelY === at
          ? null
          : svg('line', {
              className: 'cora-chart__leader',
              key: 'leader',
              x1: endX + 5,
              x2: endX + END_LABEL_GAP - 1,
              y1: at,
              y2: labelY,
            }),
        svg(
          'text',
          {
            className: 'cora-chart__value-label',
            key: 'label',
            x: endX + END_LABEL_GAP,
            y: labelY + 4,
          },
          svg(
            'tspan',
            { className: 'cora-chart__value', key: 'value' },
            formatY(value)
          ),
          series.length > 1
            ? svg('tspan', { key: 'name', dx: 5 }, line.label)
            : null
        )
      )
    )
  );
}
