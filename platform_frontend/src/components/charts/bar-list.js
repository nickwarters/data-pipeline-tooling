// @ts-check
import { svg } from '../../lib/html.js';
import {
  formatCount,
  linearScale,
  markAttributes,
  paint,
  requireFiniteValues,
  textWidth,
} from './chart-kit.js';

/** @typedef {import('./chart-kit.js').ChartRole} ChartRole */

/**
 * One row of a bar list. `marker` is the symbol drawn before a status row's
 * label (● for overdue, ▲ for due today), so a status never rests on its
 * colour alone; `detail` adds lines to the row's tooltip.
 *
 * @typedef {Object} BarListRow
 * @property {string} key
 * @property {string} label
 * @property {number} value
 * @property {ChartRole} [role]
 * @property {string} [marker]
 * @property {string[]} [detail]
 */

/**
 * @typedef {Object} BarListConfig
 * @property {number} width
 * @property {string} ariaLabel
 * @property {(value: number) => string} [format]
 * @property {string} [unit] what a value counts, for the tooltip ("Cases")
 * @property {number} [maxLabelWidth] labels longer than this are shortened
 *   on the chart; the tooltip and the table keep them whole
 */

const ROW_HEIGHT = 26;
const BAR_HEIGHT = 14;
const LABEL_FONT = 12;

/**
 * Horizontal bars, one per row, in the order given: a ranking, or an ordered
 * scale such as days to a due date. Each bar's value is written at its end,
 * and every bar starts from one shared baseline so lengths compare honestly.
 *
 * @param {{ rows: BarListRow[] }} data
 * @param {BarListConfig} config
 * @returns {SVGSVGElement}
 */
export function BarList(data, config) {
  const rows = data?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TypeError('BarList needs at least one row');
  }
  requireFiniteValues(
    rows.map((row) => row.value),
    'BarList values'
  );
  if (rows.some((row) => row.value < 0)) {
    throw new RangeError('BarList values must not be negative');
  }

  const {
    width,
    ariaLabel,
    format = formatCount,
    unit = '',
    maxLabelWidth = 200,
  } = config;

  const labels = rows.map((row) => {
    const marker = row.marker ? `${row.marker} ` : '';
    return {
      marker,
      shown: shorten(row.label, maxLabelWidth - textWidth(marker, LABEL_FONT)),
    };
  });
  const labelWidth =
    Math.max(
      ...labels.map((label) =>
        textWidth(label.marker + label.shown, LABEL_FONT)
      )
    ) + 12;
  const valueWidth =
    Math.max(...rows.map((row) => textWidth(format(row.value)))) + 12;
  if (width - labelWidth - valueWidth < 40) {
    throw new RangeError(`BarList is too narrow to draw at ${width}px`);
  }
  const max = Math.max(...rows.map((row) => row.value));
  const x = linearScale(0, max === 0 ? 1 : max, labelWidth, width - valueWidth);
  const height = rows.length * ROW_HEIGHT + 2;

  return /** @type {SVGSVGElement} */ (
    svg(
      'svg',
      {
        className: 'cora-chart cora-bar-list',
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        role: 'group',
        'aria-label': ariaLabel,
      },
      svg('line', {
        className: 'cora-chart__axis-line',
        key: 'baseline',
        x1: labelWidth,
        x2: labelWidth,
        y1: 0,
        y2: height,
      }),
      rows.map((row, i) => {
        const cy = i * ROW_HEIGHT + ROW_HEIGHT / 2;
        const length =
          row.value > 0 ? Math.max(3, x(row.value) - labelWidth) : 0;
        const value = format(row.value);
        const description = [
          `${row.label}: ${value}${unit ? ` ${unit}` : ''}`,
          ...(row.detail ?? []),
        ].join(', ');
        const role = row.role ?? 's1';
        return svg(
          'g',
          { className: 'cora-bar-list__row', key: row.key },
          svg(
            'text',
            {
              className: `cora-chart__category-label${row.marker ? ' cora-chart__category-label--status' : ''}`,
              key: 'label',
              x: 0,
              y: cy + 4,
            },
            // The marker wears the status colour; the words stay in text
            // colour, so the label is readable and the status is never
            // carried by colour alone.
            labels[i].marker
              ? svg(
                  'tspan',
                  { key: 'marker', fill: paint(role), 'aria-hidden': 'true' },
                  labels[i].marker
                )
              : null,
            svg('tspan', { key: 'text' }, labels[i].shown)
          ),
          svg('path', {
            className: 'cora-bar-list__bar',
            key: 'bar',
            d: barPath(labelWidth, cy - BAR_HEIGHT / 2, length, BAR_HEIGHT),
            fill: paint(role),
            ...markAttributes(description),
          }),
          svg(
            'text',
            {
              className: 'cora-chart__value-label',
              key: 'value',
              x: labelWidth + length + 6,
              y: cy + 4,
              'aria-hidden': 'true',
            },
            value
          )
        );
      })
    )
  );
}

/**
 * A bar that grows from the baseline with its far end rounded and its base
 * square. A zero-length bar is still a path, so it can still be hovered and
 * focused and say "0".
 *
 * @param {number} x
 * @param {number} y
 * @param {number} length
 * @param {number} height
 */
function barPath(x, y, length, height) {
  const r = Math.min(4, length / 2, height / 2);
  return `M${x},${y}H${x + length - r}Q${x + length},${y} ${x + length},${y + r}V${y + height - r}Q${x + length},${y + height} ${x + length - r},${y + height}H${x}Z`;
}

/**
 * Shorten a label to fit a width, with an ellipsis.
 *
 * @param {string} label
 * @param {number} maxWidth
 * @returns {string}
 */
function shorten(label, maxWidth) {
  if (textWidth(label, LABEL_FONT) <= maxWidth) return label;
  const keep = Math.max(1, Math.floor(maxWidth / (LABEL_FONT * 0.56)) - 1);
  return `${label.slice(0, keep).trimEnd()}…`;
}
