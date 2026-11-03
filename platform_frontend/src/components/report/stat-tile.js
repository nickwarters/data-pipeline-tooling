// @ts-check
import { h } from '../../lib/html.js';
import { formatPercent } from '../charts/chart-kit.js';
import { Sparkline } from '../charts/sparkline.js';

/** @typedef {import('../../reports/contract.js').StatTileSpec} StatTileSpec */

const DELTA_ARROWS = Object.freeze({ up: '▲', down: '▼', flat: '■' });
const STATUS_WORDS = Object.freeze({
  danger: 'Needs attention',
  warning: 'Due soon',
});

/**
 * A ratio against a target: a filled track with a tick where the target is.
 * The track is a lighter step of the fill's own colour, so the bar reads as
 * one measure whether it is short or long.
 *
 * @param {{ value: number, target: number, label: string }} meter
 * @returns {HTMLElement}
 */
function meterView({ value, target, label }) {
  const clamp = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));
  return h(
    'span',
    {
      className: 'cora-report-tile__meter',
      role: 'img',
      'aria-label': `${formatPercent(value, 1)} against ${label} of ${formatPercent(target)}`,
    },
    h('span', {
      className: 'cora-report-tile__meter-fill',
      style: `width: ${(clamp(value) * 100).toFixed(1)}%`,
    }),
    h('span', {
      className: 'cora-report-tile__meter-target',
      style: `left: ${(clamp(target) * 100).toFixed(1)}%`,
    })
  );
}

/**
 * One headline figure: a label, a value, and optionally which way it moved, a
 * sparkline of where it has been, or a meter against its target.
 *
 * A change is coloured by whether it is good news, not by its direction — a
 * backlog going up is bad, completions going up are good — and the arrow says
 * the direction, so neither half rests on colour.
 *
 * @param {StatTileSpec} tile
 * @returns {HTMLElement}
 */
function statTileView(tile) {
  return h(
    'div',
    { className: 'cora-report-tile', key: tile.key },
    h(
      'span',
      { className: 'cora-report-tile__label' },
      tile.status
        ? h('span', {
            className: `cora-report-tile__status cora-report-tile__status--${tile.status}`,
            role: 'img',
            'aria-label': STATUS_WORDS[tile.status],
          })
        : null,
      tile.label
    ),
    h(
      'span',
      { className: 'cora-report-tile__row' },
      h(
        'span',
        { className: 'cora-report-tile__value' },
        tile.value,
        tile.unit
          ? h('span', { className: 'cora-report-tile__unit' }, tile.unit)
          : null
      ),
      tile.trend ? Sparkline(tile.trend) : null
    ),
    tile.delta || tile.meter
      ? h(
          'span',
          { className: 'cora-report-tile__foot' },
          tile.delta
            ? h(
                'span',
                {
                  className: `cora-report-tile__delta cora-report-tile__delta--${tile.delta.tone}`,
                },
                `${DELTA_ARROWS[tile.delta.direction]} ${tile.delta.text}`
              )
            : null,
          tile.meter ? meterView(tile.meter) : null
        )
      : null
  );
}

/**
 * A row of headline figures.
 *
 * @param {StatTileSpec[]} tiles
 * @param {{ stacked?: boolean }} [options] one tile per line, for a narrow rail
 * @returns {HTMLElement}
 */
export function KpiRow(tiles, { stacked = false } = {}) {
  return h(
    'div',
    {
      className: `cora-report-kpis${stacked ? ' cora-report-kpis--stacked' : ''}`,
    },
    tiles.map(statTileView)
  );
}
