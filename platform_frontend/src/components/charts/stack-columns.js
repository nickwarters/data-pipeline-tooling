// @ts-check
import { svg } from '../../lib/html.js';
import {
  formatCount,
  formatPercent,
  linearScale,
  markAttributes,
  paint,
  requireFiniteValues,
  textWidth,
} from './chart-kit.js';

/** @typedef {import('./chart-kit.js').ChartRole} ChartRole */

/**
 * One part of every column, in stacking order from the baseline up.
 *
 * @typedef {{ key: string, label: string, role: ChartRole }} StackColumnsPart
 */

/**
 * One column: a period, and how many fell into each part.
 *
 * @typedef {{ key: string, label: string, describe?: string, counts: Record<string, number> }} StackColumn
 */

/**
 * @typedef {Object} StackColumnsConfig
 * @property {number} width
 * @property {number} [height]
 * @property {string} ariaLabel
 */

const MARGIN = Object.freeze({ top: 8, right: 8, bottom: 26, left: 40 });
const MAX_COLUMN_WIDTH = 24;
const GAP = 2;
const RADIUS = 4;
const DEFAULT_HEIGHT = 200;

/**
 * Columns stacked to 100%: how a whole divided up, period by period. Shares,
 * not counts, because the question is "did the mix change" and a busy month
 * would otherwise look like a change of mix. Each column's counts are in its
 * description, so the volume behind a share is never lost.
 *
 * Each column is one focusable mark naming every part, rather than a mark per
 * segment: a reader asks "what happened in May", and one stop answers it.
 *
 * @param {{ parts: StackColumnsPart[], columns: StackColumn[] }} data
 * @param {StackColumnsConfig} config
 * @returns {SVGSVGElement}
 */
export function StackColumns(data, config) {
  const parts = data?.parts;
  const columns = data?.columns;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new TypeError('StackColumns needs at least one part');
  }
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new TypeError('StackColumns needs at least one column');
  }
  requireFiniteValues(
    columns.flatMap((column) =>
      parts.map((part) => column.counts[part.key] ?? 0)
    ),
    'StackColumns counts'
  );
  if (
    columns.some((column) =>
      parts.some((part) => (column.counts[part.key] ?? 0) < 0)
    )
  ) {
    throw new RangeError('StackColumns counts must not be negative');
  }

  const { width, height = DEFAULT_HEIGHT, ariaLabel } = config;
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const band = plotWidth / columns.length;
  if (band < 8) {
    throw new RangeError(`StackColumns is too narrow to draw at ${width}px`);
  }
  const columnWidth = Math.min(MAX_COLUMN_WIDTH, band * 0.62);
  const y = linearScale(0, 1, height - MARGIN.bottom, MARGIN.top);
  const labelEvery = Math.max(
    1,
    Math.ceil(
      columns.length /
        Math.max(
          1,
          Math.floor(
            plotWidth /
              (Math.max(...columns.map((c) => textWidth(c.label))) + 12)
          )
        )
    )
  );

  return /** @type {SVGSVGElement} */ (
    svg(
      'svg',
      {
        className: 'cora-chart cora-stack-columns',
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        role: 'group',
        'aria-label': ariaLabel,
      },
      svg(
        'g',
        { className: 'cora-chart__grid', key: 'grid' },
        [0, 0.25, 0.5, 0.75, 1].map((share) =>
          svg(
            'g',
            { key: `tick-${share}` },
            svg('line', {
              className:
                share === 0 ? 'cora-chart__axis-line' : 'cora-chart__grid-line',
              key: 'line',
              x1: MARGIN.left,
              x2: width - MARGIN.right,
              y1: y(share),
              y2: y(share),
            }),
            svg(
              'text',
              {
                className: 'cora-chart__tick-label',
                key: 'label',
                x: MARGIN.left - 6,
                y: y(share) + 4,
                'text-anchor': 'end',
              },
              formatPercent(share)
            )
          )
        )
      ),
      columns.map((column, i) => {
        const centre = MARGIN.left + band * i + band / 2;
        const left = centre - columnWidth / 2;
        const total = parts.reduce(
          (sum, part) => sum + (column.counts[part.key] ?? 0),
          0
        );
        const description = `${column.describe ?? column.label}: ${parts
          .map((part) => {
            const count = column.counts[part.key] ?? 0;
            return `${part.label} ${total > 0 ? formatPercent(count / total) : '0%'} (${formatCount(count)})`;
          })
          .join(', ')}`;
        const drawn =
          total > 0
            ? parts.filter((part) => (column.counts[part.key] ?? 0) > 0)
            : [];
        let from = 0;
        return svg(
          'g',
          { className: 'cora-stack-columns__column', key: column.key },
          drawn.map((part, j) => {
            const share = column.counts[part.key] / total;
            const bottom = y(from);
            const top = y(from + share);
            from += share;
            const isTop = j === drawn.length - 1;
            // The surface-coloured gap sits on top of every segment but the
            // last, so neighbours read as two parts without a drawn border.
            const segmentHeight = Math.max(0, bottom - top - (isTop ? 0 : GAP));
            return svg('path', {
              className: 'cora-stack-columns__segment',
              key: part.key,
              d: isTop
                ? roundedTop(
                    left,
                    bottom - segmentHeight,
                    columnWidth,
                    segmentHeight
                  )
                : `M${left},${bottom}V${bottom - segmentHeight}H${left + columnWidth}V${bottom}Z`,
              fill: paint(part.role),
            });
          }),
          svg('rect', {
            className: 'cora-stack-columns__hit',
            key: 'hit',
            x: centre - band / 2,
            y: MARGIN.top,
            width: band,
            height: y(0) - MARGIN.top,
            fill: 'transparent',
            ...markAttributes(description),
          }),
          i % labelEvery === 0 || i === columns.length - 1
            ? svg(
                'text',
                {
                  className: 'cora-chart__tick-label',
                  key: 'label',
                  x: centre,
                  y: height - 8,
                  'text-anchor': 'middle',
                },
                column.label
              )
            : null
        );
      })
    )
  );
}

/**
 * A segment whose top corners are rounded and whose base is square.
 *
 * @param {number} x
 * @param {number} top
 * @param {number} w
 * @param {number} h
 */
function roundedTop(x, top, w, h) {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`;
}
