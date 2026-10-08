// @ts-check
import { svg } from '../../lib/html.js';
import {
  formatCount,
  linearScale,
  markAttributes,
  niceAxis,
  paint,
  requireFiniteValues,
  textWidth,
} from './chart-kit.js';

/**
 * @typedef {Object} RangeRow
 * @property {string} key
 * @property {string} label
 * @property {number} p50
 * @property {number} p90
 * @property {number} count
 */

/**
 * @typedef {Object} RangeChartConfig
 * @property {number} width
 * @property {string} ariaLabel
 * @property {(value: number) => string} [format] e.g. "5.1 d"
 * @property {(value: number) => string} [formatTick] e.g. "10d"
 */

const ROW_HEIGHT = 30;
const AXIS_HEIGHT = 22;
const LABEL_FONT = 12;

/**
 * @param {{ rows: RangeRow[] }} data
 * @param {RangeChartConfig} config
 * @returns {SVGSVGElement}
 */
export function RangeChart(data, config) {
  const rows = data?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TypeError('RangeChart needs at least one row');
  }
  requireFiniteValues(
    rows.flatMap((row) => [row.p50, row.p90, row.count]),
    'RangeChart values'
  );
  for (const row of rows) {
    if (row.p50 < 0 || row.p90 < row.p50) {
      throw new RangeError(
        `RangeChart row "${row.key}" needs 0 <= median <= 90th percentile`
      );
    }
  }

  const {
    width,
    ariaLabel,
    format = (value) => `${value.toFixed(1)} d`,
    formatTick = (value) => `${value}d`,
  } = config;
  const labelWidth =
    Math.max(...rows.map((row) => textWidth(row.label, LABEL_FONT))) + 14;
  const right = 14;
  if (width - labelWidth - right < 60) {
    throw new RangeError(`RangeChart is too narrow to draw at ${width}px`);
  }
  const axis = niceAxis(Math.max(...rows.map((row) => row.p90)));
  const x = linearScale(0, axis.max, labelWidth, width - right);
  const plotBottom = rows.length * ROW_HEIGHT;
  const height = plotBottom + AXIS_HEIGHT;

  /** @type {number[]} */
  const ticks = [];
  for (let value = 0; value <= axis.max; value += axis.step) ticks.push(value);

  return /** @type {SVGSVGElement} */ (
    svg(
      'svg',
      {
        className: 'cora-chart cora-range-chart',
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        role: 'group',
        'aria-label': ariaLabel,
      },
      svg(
        'g',
        { className: 'cora-chart__grid', key: 'grid' },
        ticks.map((value) =>
          svg(
            'g',
            { key: `tick-${value}` },
            svg('line', {
              className:
                value === 0 ? 'cora-chart__axis-line' : 'cora-chart__grid-line',
              key: 'line',
              x1: x(value),
              x2: x(value),
              y1: 0,
              y2: plotBottom,
            }),
            svg(
              'text',
              {
                className: 'cora-chart__tick-label',
                key: 'label',
                x: x(value),
                y: height - 6,
                'text-anchor': 'middle',
              },
              value === 0 ? '0' : formatTick(value)
            )
          )
        )
      ),
      rows.map((row, i) => {
        const cy = i * ROW_HEIGHT + ROW_HEIGHT / 2;
        const description = `${row.label}: median ${format(row.p50)}, 90th percentile ${format(row.p90)}, over ${formatCount(row.count)} Cases`;
        return svg(
          'g',
          { className: 'cora-range-chart__row', key: row.key },
          svg(
            'text',
            {
              className: 'cora-chart__category-label',
              key: 'label',
              x: 0,
              y: cy + 4,
            },
            row.label
          ),
          svg('rect', {
            className: 'cora-range-chart__band',
            key: 'band',
            x: x(row.p50),
            y: cy - 4,
            width: Math.max(2, x(row.p90) - x(row.p50)),
            height: 8,
            rx: 4,
            fill: paint('range'),
          }),
          svg('circle', {
            className: 'cora-range-chart__median',
            key: 'median',
            cx: x(row.p50),
            cy,
            r: 5,
            fill: paint('s1'),
            ...markAttributes(description),
          })
        );
      })
    )
  );
}
