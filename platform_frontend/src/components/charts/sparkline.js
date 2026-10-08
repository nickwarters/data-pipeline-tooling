// @ts-check
import { svg } from '../../lib/html.js';
import { linearScale, paint, requireFiniteValues } from './chart-kit.js';

/**
 * @param {number[]} values oldest first
 * @param {{ width?: number, height?: number }} [config]
 * @returns {SVGSVGElement}
 */
export function Sparkline(values, { width = 72, height = 26 } = {}) {
  requireFiniteValues(values, 'Sparkline values');
  if (values.length < 2) {
    throw new RangeError('Sparkline needs at least two values to show a trend');
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = linearScale(0, values.length - 1, 2, width - 5);
  const y =
    min === max ? () => height / 2 : linearScale(min, max, height - 4, 4);
  const last = values.length - 1;
  const d = values
    .map(
      (value, i) =>
        `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(value).toFixed(1)}`
    )
    .join('');

  return /** @type {SVGSVGElement} */ (
    svg(
      'svg',
      {
        className: 'cora-sparkline',
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        'aria-hidden': 'true',
        focusable: 'false',
      },
      svg('path', {
        className: 'cora-sparkline__line',
        key: 'line',
        d,
        fill: 'none',
        stroke: paint('quiet-strong'),
      }),
      svg('circle', {
        className: 'cora-sparkline__latest',
        key: 'latest',
        cx: x(last),
        cy: y(values[last]),
        r: 3.5,
        fill: paint('s1'),
      })
    )
  );
}
