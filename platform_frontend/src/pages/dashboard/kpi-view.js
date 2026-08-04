// @ts-check
import { h } from '../../lib/html.js';

/** @typedef {import('../../evaluators/kpi-strip-model.js').KpiLane} KpiLane */
/** @typedef {import('../../evaluators/kpi-strip-model.js').KpiTile} KpiTile */
/** @typedef {import('../../evaluators/kpi-strip-model.js').Breakdown} Breakdown */

/** @param {Breakdown} breakdown */
function breakdownView(breakdown) {
  const max = Math.max(1, ...breakdown.rows.map((row) => row.count));
  return h(
    'span',
    { className: 'cora-kpi-breakdown' },
    ...breakdown.rows.map((row) =>
      h(
        'span',
        { className: `cora-kpi-row cora-kpi-row--${breakdown.axis}` },
        h('span', { className: 'cora-kpi-row__label' }, row.label),
        breakdown.axis === 'caseType'
          ? h(
              'span',
              { className: 'cora-kpi-row__track' },
              h('span', {
                className: 'cora-kpi-row__bar',
                style: `width:${Math.round((row.count / max) * 100)}%`,
              })
            )
          : null,
        h('span', { className: 'cora-kpi-row__count' }, String(row.count))
      )
    )
  );
}

/**
 * @param {'reviewer'|'controls'|'owner'} role
 * @param {KpiTile} tile
 * @param {boolean} expanded
 * @param {(role: string, key: string) => void} onToggleTile
 */
function tileView(role, tile, expanded, onToggleTile) {
  const hasBreakdown = tile.breakdown != null;
  const content = [
    h(
      'span',
      { className: 'cora-kpi-tile__face' },
      h('span', { className: 'cora-kpi-tile__count' }, String(tile.count)),
      h('span', { className: 'cora-kpi-tile__label' }, tile.label),
      hasBreakdown
        ? h(
            'span',
            { className: 'cora-kpi-tile__caret', 'aria-hidden': 'true' },
            expanded ? '▾' : '▸'
          )
        : null
    ),
  ];
  if (hasBreakdown && expanded) {
    content.push(breakdownView(/** @type {Breakdown} */ (tile.breakdown)));
  }
  const className = `cora-kpi-tile cora-kpi-tile--${tile.tone}`;
  return hasBreakdown
    ? h(
        'button',
        {
          type: 'button',
          className,
          'aria-expanded': String(expanded),
          onclick: () => onToggleTile(role, tile.key),
        },
        ...content
      )
    : h('div', { className }, ...content);
}

/**
 * @param {KpiLane} lane
 * @param {Set<string>} openLanes
 * @param {Set<string>} expandedTiles
 * @param {(role: string) => void} onToggleLane
 * @param {(role: string, key: string) => void} onToggleTile
 */
function laneView(lane, openLanes, expandedTiles, onToggleLane, onToggleTile) {
  const open = openLanes.has(lane.role);
  const scope = open
    ? lane.scopeLabel
    : `${lane.scopeLabel} — ${lane.totalItems} items`;
  return h(
    'div',
    {
      className: `cora-kpi-lane${lane.isPrimary ? ' cora-kpi-lane--primary' : ''}`,
    },
    h(
      'button',
      {
        type: 'button',
        className: 'cora-kpi-lane__header',
        'aria-expanded': String(open),
        onclick: () => onToggleLane(lane.role),
      },
      h(
        'span',
        { className: 'cora-kpi-caret', 'aria-hidden': 'true' },
        open ? '▾' : '▸'
      ),
      h('span', { className: 'cora-kpi-lane__role' }, lane.label),
      h('span', { className: 'cora-kpi-lane__scope' }, `· ${scope}`)
    ),
    open
      ? h(
          'span',
          { className: 'cora-kpi-tiles' },
          ...lane.tiles.map((tile) =>
            tileView(
              lane.role,
              tile,
              expandedTiles.has(`${lane.role}:${tile.key}`),
              onToggleTile
            )
          )
        )
      : null
  );
}

/**
 * Pure KPI strip view fed only by `kpi-strip-model` output and store-owned UI
 * state.
 *
 * @param {{
 *   lanes: KpiLane[],
 *   openLanes: Set<string>,
 *   expandedTiles: Set<string>,
 *   onToggleLane: (role: string) => void,
 *   onToggleTile: (role: string, key: string) => void,
 * }} props
 */
export function kpiStripView({
  lanes,
  openLanes,
  expandedTiles,
  onToggleLane,
  onToggleTile,
}) {
  if (lanes.length === 0) return null;
  return h(
    'section',
    { className: 'cora-kpi-strip', 'aria-label': 'Role worklist summary' },
    ...lanes.map((lane) =>
      laneView(lane, openLanes, expandedTiles, onToggleLane, onToggleTile)
    )
  );
}
