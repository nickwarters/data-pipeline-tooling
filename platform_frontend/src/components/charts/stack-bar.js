// @ts-check
import { svg } from '../../lib/html.js';
import {
  formatCount,
  formatPercent,
  markAttributes,
  paint,
  requireFiniteValues,
  textWidth,
} from './chart-kit.js';

/** @typedef {import('./chart-kit.js').ChartRole} ChartRole */

/**
 * @typedef {Object} StackBarPart
 * @property {string} key
 * @property {string} label
 * @property {number} value
 * @property {ChartRole} role
 */

/**
 * @typedef {Object} StackBarConfig
 * @property {number} width
 * @property {string} ariaLabel
 * @property {string} [wholeLabel] what the whole is, for the tooltip ("open")
 */

const BAR_HEIGHT = 24;
const GAP = 2;
const RADIUS = 4;
const INLINE_LABEL_PADDING = 12;
/** Past six parts a single bar stops being readable as parts of a whole. */
const MAX_PARTS = 6;

/**
 * One bar split into the parts of a whole, at a glance. The parts are named by
 * the panel's legend, not on the bar; a part's count is written inside it only
 * where it fits, and every part says its count and share on hover and focus.
 * A 2px gap in the surface colour separates the parts, so neighbours read as
 * two things without a border drawn round either.
 *
 * @param {{ parts: StackBarPart[] }} data
 * @param {StackBarConfig} config
 * @returns {SVGSVGElement}
 */
export function StackBar(data, config) {
  const parts = data?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new TypeError('StackBar needs at least one part');
  }
  if (parts.length > MAX_PARTS) {
    throw new RangeError(
      `StackBar shows at most ${MAX_PARTS} parts; fold the rest into one`
    );
  }
  requireFiniteValues(
    parts.map((part) => part.value),
    'StackBar values'
  );
  if (parts.some((part) => part.value < 0)) {
    throw new RangeError('StackBar values must not be negative');
  }

  const { width, ariaLabel, wholeLabel = 'of the total' } = config;
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const drawn = parts.filter((part) => part.value > 0);
  const usable = width - GAP * Math.max(0, drawn.length - 1);

  let x = 0;
  const segments = drawn.map((part, i) => {
    const length = (part.value / total) * usable;
    const segment = {
      part,
      x,
      length,
      first: i === 0,
      last: i === drawn.length - 1,
    };
    x += length + GAP;
    return segment;
  });

  return /** @type {SVGSVGElement} */ (
    svg(
      'svg',
      {
        className: 'cora-chart cora-stack-bar',
        width,
        height: BAR_HEIGHT,
        viewBox: `0 0 ${width} ${BAR_HEIGHT}`,
        role: 'group',
        'aria-label': ariaLabel,
      },
      total === 0
        ? svg('rect', {
            className: 'cora-stack-bar__empty',
            key: 'empty',
            x: 0,
            y: 0,
            width,
            height: BAR_HEIGHT,
            rx: RADIUS,
            ...markAttributes(`None ${wholeLabel}`),
          })
        : segments.map(({ part, x: left, length, first, last }) => {
            const count = formatCount(part.value);
            return svg(
              'g',
              { className: 'cora-stack-bar__part', key: part.key },
              svg('path', {
                className: 'cora-stack-bar__segment',
                key: 'segment',
                d: segmentPath(left, length, first, last),
                fill: paint(part.role),
                ...markAttributes(
                  `${part.label}: ${count}, ${formatPercent(part.value / total)} ${wholeLabel}`
                ),
              }),
              textWidth(count) + INLINE_LABEL_PADDING < length
                ? svg(
                    'text',
                    {
                      className: 'cora-stack-bar__count',
                      key: 'count',
                      x: left + 6,
                      y: BAR_HEIGHT / 2 + 4,
                      'aria-hidden': 'true',
                    },
                    count
                  )
                : null
            );
          })
    )
  );
}

/**
 * A segment with its outer ends rounded: the first part's left end and the
 * last part's right end, so the whole bar reads as one rounded shape.
 *
 * @param {number} x
 * @param {number} length
 * @param {boolean} first
 * @param {boolean} last
 */
function segmentPath(x, length, first, last) {
  const r = Math.min(RADIUS, length / 2);
  const h = BAR_HEIGHT;
  const left = first ? `M${x + r},0` : `M${x},0`;
  const top = `H${x + length - (last ? r : 0)}`;
  const right = last
    ? `Q${x + length},0 ${x + length},${r}V${h - r}Q${x + length},${h} ${x + length - r},${h}`
    : `V${h}`;
  const bottom = `H${x + (first ? r : 0)}`;
  const close = first
    ? `Q${x},${h} ${x},${h - r}V${r}Q${x},0 ${x + r},0Z`
    : 'V0Z';
  return `${left}${top}${right}${bottom}${close}`;
}
