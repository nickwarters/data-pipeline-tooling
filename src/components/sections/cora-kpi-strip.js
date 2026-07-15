// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import { loadKpiModel } from '../../evaluators/kpi-strip-model.js';

/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../../services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../../evaluators/kpi-strip-model.js').KpiLane} KpiLane */
/** @typedef {import('../../evaluators/kpi-strip-model.js').KpiTile} KpiTile */
/** @typedef {import('../../evaluators/kpi-strip-model.js').Breakdown} Breakdown */

/**
 * Render the mini list/bars revealed when a tile is drilled into. Case Type
 * rows carry a CSS-drawn bar (no charting lib, the architecture decision); reason rows are a
 * plain label/count pair. Everything is phrasing-level `span`s so it can live
 * inside the tile's `<button>`.
 *
 * @param {Breakdown} breakdown
 * @returns {HTMLElement}
 */
function renderBreakdown(breakdown) {
  const max = Math.max(1, ...breakdown.rows.map((r) => r.count));
  return h(
    'span',
    { class: 'cora-kpi-breakdown' },
    ...breakdown.rows.map((row) => {
      const cells = [h('span', { class: 'cora-kpi-row__label' }, row.label)];
      if (breakdown.axis === 'caseType') {
        cells.push(
          h(
            'span',
            { class: 'cora-kpi-row__track' },
            h('span', {
              class: 'cora-kpi-row__bar',
              style: `width:${Math.round((row.count / max) * 100)}%`,
            })
          )
        );
      }
      cells.push(
        h('span', { class: 'cora-kpi-row__count' }, String(row.count))
      );
      return h(
        'span',
        { class: `cora-kpi-row cora-kpi-row--${breakdown.axis}` },
        ...cells
      );
    })
  );
}

/**
 * @param {'reviewer'|'controls'|'owner'} role
 * @param {KpiTile} tile
 * @param {boolean} expanded
 * @param {(role: string, key: string) => void} onToggleTile
 * @returns {HTMLElement}
 */
function renderTile(role, tile, expanded, onToggleTile) {
  const hasBreakdown = tile.breakdown != null;
  const face = h(
    'span',
    { class: 'cora-kpi-tile__face' },
    h('span', { class: 'cora-kpi-tile__count' }, String(tile.count)),
    h('span', { class: 'cora-kpi-tile__label' }, tile.label),
    hasBreakdown
      ? h(
          'span',
          { class: 'cora-kpi-tile__caret', 'aria-hidden': 'true' },
          expanded ? '▾' : '▸'
        )
      : null
  );

  const parts = [face];
  if (hasBreakdown && expanded) {
    parts.push(renderBreakdown(/** @type {Breakdown} */ (tile.breakdown)));
  }

  const cls = `cora-kpi-tile cora-kpi-tile--${tile.tone}`;
  if (!hasBreakdown) return h('div', { class: cls }, ...parts);

  return h(
    'button',
    {
      type: 'button',
      class: cls,
      'aria-expanded': String(expanded),
      onclick: () => onToggleTile(role, tile.key),
    },
    ...parts
  );
}

/**
 * @param {KpiLane} lane
 * @param {boolean} open
 * @param {Set<string>} expandedTiles
 * @param {(role: string, key: string) => void} onToggleTile
 * @param {(role: string) => void} onToggleLane
 * @returns {HTMLElement}
 */
function renderLane(lane, open, expandedTiles, onToggleTile, onToggleLane) {
  // Folded lanes surface the accountability at a glance ("Lending — 11 items").
  const scopeText = open
    ? lane.scopeLabel
    : `${lane.scopeLabel} — ${lane.totalItems} items`;

  const header = h(
    'button',
    {
      type: 'button',
      class: 'cora-kpi-lane__header',
      'aria-expanded': String(open),
      onclick: () => onToggleLane(lane.role),
    },
    h(
      'span',
      { class: 'cora-kpi-caret', 'aria-hidden': 'true' },
      open ? '▾' : '▸'
    ),
    h('span', { class: 'cora-kpi-lane__role' }, lane.label),
    h('span', { class: 'cora-kpi-lane__scope' }, `· ${scopeText}`)
  );

  const children = [header];
  if (open) {
    children.push(
      h(
        'span',
        { class: 'cora-kpi-tiles' },
        ...lane.tiles.map((tile) =>
          renderTile(
            lane.role,
            tile,
            expandedTiles.has(`${lane.role}:${tile.key}`),
            onToggleTile
          )
        )
      )
    );
  }

  const laneClass = `cora-kpi-lane${lane.isPrimary ? ' cora-kpi-lane--primary' : ''}`;
  return h('div', { class: laneClass }, ...children);
}

/**
 * Pure render of the whole strip from the model plus UI state. Kept separate
 * from the element so it can be tested without a fetch.
 *
 * @param {{
 * lanes: KpiLane[],
 * openLanes: Set<string>,
 * expandedTiles: Set<string>,
 * onToggleLane: (role: string) => void,
 * onToggleTile: (role: string, key: string) => void
 * }} state
 * @returns {HTMLElement}
 */
export function renderKpiStrip({
  lanes,
  openLanes,
  expandedTiles,
  onToggleLane,
  onToggleTile,
}) {
  return h(
    'section',
    { class: 'cora-kpi-strip', 'aria-label': 'Role worklist summary' },
    ...lanes.map((lane) =>
      renderLane(
        lane,
        openLanes.has(lane.role),
        expandedTiles,
        onToggleTile,
        onToggleLane
      )
    )
  );
}

/**
 * `<cora-kpi-strip>` — the role-scoped KPI strip. Self-fetches its
 * model through the `SharePointClient` and renders collapsible role lanes with
 * per-Case-Type / sub-reason drilldown. Lane and tile open state is local UI
 * state, seeded from the model's data-driven defaults.
 */
export class CORAKpiStrip extends ShellElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {string} */
    this.currentUserId = '';
    /** @type {Capabilities | null} */
    this.capabilities = null;
    /** @type {string[]} */
    this.eligibleCaseTypes = [];
    /** @type {import('../../setup/resolve-eligible-case-types.js').CaseSource[]} */
    this.caseSources = [];
    /** @type {import('../../setup/resolve-eligible-case-types.js').CaseSource[]} */
    this.allCaseSources = [];
    /** @type {Date | undefined} */
    this.now = undefined;

    /** @type {KpiLane[]} */
    this._lanes = [];
    /** @type {Set<string>} */
    this._openLanes = new Set();
    /** @type {Set<string>} */
    this._expandedTiles = new Set();
    this._loaded = false;
  }

  async connectedCallback() {
    super.connectedCallback();
    if (!this.client || !this.capabilities) return;

    this._lanes = await loadKpiModel({
      client: this.client,
      currentUserId: this.currentUserId,
      capabilities: this.capabilities,
      caseSources: this.caseSources,
      allCaseSources: this.allCaseSources,
      now: this.now,
    });

    for (const lane of this._lanes) {
      if (lane.defaultOpen) this._openLanes.add(lane.role);
      for (const tile of lane.tiles) {
        if (tile.defaultExpanded)
          this._expandedTiles.add(`${lane.role}:${tile.key}`);
      }
    }

    this._loaded = true;
    this._shellRenderNow?.();
  }

  /** @param {string} role */
  _toggleLane(role) {
    if (this._openLanes.has(role)) this._openLanes.delete(role);
    else this._openLanes.add(role);
    this._shellRenderNow?.();
  }

  /** @param {string} role @param {string} key */
  _toggleTile(role, key) {
    const id = `${role}:${key}`;
    if (this._expandedTiles.has(id)) this._expandedTiles.delete(id);
    else this._expandedTiles.add(id);
    this._shellRenderNow?.();
  }

  render() {
    if (!this._loaded || this._lanes.length === 0) return undefined;
    return renderKpiStrip({
      lanes: this._lanes,
      openLanes: this._openLanes,
      expandedTiles: this._expandedTiles,
      onToggleLane: (role) => this._toggleLane(role),
      onToggleTile: (role, key) => this._toggleTile(role, key),
    });
  }
}

customElements.define('cora-kpi-strip', CORAKpiStrip);
