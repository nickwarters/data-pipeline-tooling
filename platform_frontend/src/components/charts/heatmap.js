// @ts-check
import { svg } from '../../lib/html.js';
import {
  formatCount,
  markAttributes,
  paint,
  requireFiniteValues,
  textWidth,
} from './chart-kit.js';

/**
 * @typedef {Object} HeatmapConfig
 * @property {number} width
 * @property {string} ariaLabel
 * @property {string[]} rowLabels
 * @property {string[]} columnLabels
 * @property {(row: number, column: number) => string} describeCell e.g. "Mon 09:00–10:00"
 * @property {string} [unit]
 * @property {number[]} [labelColumns]
 */

const LEFT = 36;
const GAP = 2;
const LEGEND_HEIGHT = 30;
const AXIS_HEIGHT = 16;
const BINS = Object.freeze([0.16, 0.3, 0.46, 0.64, 0.82, 1]);

/**
 * @param {{ values: number[][] }} data
 * @param {HeatmapConfig} config
 * @returns {SVGSVGElement}
 */
export function Heatmap(data, config) {
  const values = data?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError('Heatmap needs at least one row');
  }
  const columns = values[0].length;
  if (columns === 0 || values.some((row) => row.length !== columns)) {
    throw new RangeError(
      'every Heatmap row needs the same, non-zero number of columns'
    );
  }
  const flat = values.flat();
  requireFiniteValues(flat, 'Heatmap values');
  if (flat.some((value) => value < 0)) {
    throw new RangeError('Heatmap values must not be negative');
  }

  const {
    width,
    ariaLabel,
    rowLabels,
    columnLabels,
    describeCell,
    unit = '',
    labelColumns = [...new Set([0, Math.floor(columns / 2), columns - 1])],
  } = config;
  if (rowLabels.length !== values.length || columnLabels.length !== columns) {
    throw new RangeError('Heatmap needs one label per row and per column');
  }
  const cellWidth = (width - LEFT) / columns;
  if (cellWidth < 6) {
    throw new RangeError(`Heatmap is too narrow to draw at ${width}px`);
  }
  const cellHeight = Math.min(18, Math.max(12, cellWidth * 0.9));
  const gridHeight = values.length * (cellHeight + GAP);
  const height = gridHeight + AXIS_HEIGHT + LEGEND_HEIGHT;
  const max = Math.max(...flat);

  /** @param {number} value */
  const bin = (value) =>
    value === 0 || max === 0
      ? -1
      : Math.min(BINS.length - 1, Math.ceil((value / max) * BINS.length) - 1);

  const legendY = gridHeight + AXIS_HEIGHT + 14;
  const legendX = LEFT + textWidth('Fewer') + 8;

  return /** @type {SVGSVGElement} */ (
    svg(
      'svg',
      {
        className: 'cora-chart cora-heatmap',
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        role: 'img',
        'aria-label': ariaLabel,
      },
      values.map((row, r) =>
        svg(
          'g',
          { className: 'cora-heatmap__row', key: `row-${r}` },
          svg(
            'text',
            {
              className: 'cora-chart__tick-label',
              key: 'label',
              x: 0,
              y: r * (cellHeight + GAP) + cellHeight / 2 + 4,
            },
            rowLabels[r]
          ),
          row.map((value, c) => {
            const step = bin(value);
            return svg('rect', {
              className: `cora-heatmap__cell${step < 0 ? ' cora-heatmap__cell--zero' : ''}`,
              key: `cell-${c}`,
              x: LEFT + c * cellWidth,
              y: r * (cellHeight + GAP),
              width: Math.max(1, cellWidth - GAP),
              height: cellHeight,
              rx: 2,
              fill: step < 0 ? undefined : paint('s1'),
              'fill-opacity': step < 0 ? undefined : BINS[step],
              ...markAttributes(
                `${describeCell(r, c)}: ${formatCount(value)}${unit ? ` ${unit}` : ''}`,
                { focusable: false }
              ),
            });
          })
        )
      ),
      svg(
        'g',
        { className: 'cora-chart__x-axis', key: 'x-axis' },
        labelColumns
          .filter((c) => c >= 0 && c < columns)
          .map((c) =>
            svg(
              'text',
              {
                className: 'cora-chart__tick-label',
                key: `x-${c}`,
                x: LEFT + c * cellWidth + (cellWidth - GAP) / 2,
                y: gridHeight + 12,
                'text-anchor': 'middle',
              },
              columnLabels[c]
            )
          )
      ),
      svg(
        'g',
        {
          className: 'cora-heatmap__legend',
          key: 'legend',
          'aria-hidden': 'true',
        },
        svg(
          'text',
          {
            className: 'cora-chart__tick-label',
            key: 'fewer',
            x: LEFT,
            y: legendY + 4,
          },
          'Fewer'
        ),
        BINS.map((opacity, i) =>
          svg('rect', {
            key: `bin-${i}`,
            x: legendX + i * 16,
            y: legendY - 5,
            width: 14,
            height: 10,
            rx: 2,
            fill: paint('s1'),
            'fill-opacity': opacity,
          })
        ),
        svg(
          'text',
          {
            className: 'cora-chart__tick-label',
            key: 'more',
            x: legendX + BINS.length * 16 + 4,
            y: legendY + 4,
          },
          'More'
        )
      )
    )
  );
}
