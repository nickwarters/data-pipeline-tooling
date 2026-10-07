// @ts-check
import { h } from '../../lib/html.js';
import {
  formatTimestamp,
  formatWeekdayDate,
} from '../../lib/format-datetime.js';
import { navigateTo } from '../../lib/navigate.js';
import { KpiRow } from './stat-tile.js';
import { ReportPanel } from './report-panel.js';

/** @typedef {import('../../reports/contract.js').ReportContent} ReportContent */
/** @typedef {import('../../reports/contract.js').ReportPanelSpec} ReportPanelSpec */
/** @typedef {import('../../reports/contract.js').ReportSectionSpec} ReportSectionSpec */
/** @typedef {import('../../reports/contract.js').ReportFilterSpec} ReportFilterSpec */
/** @typedef {import('../../reports/contract.js').ReportScope} ReportScope */
/** @typedef {import('../../views/data-table.js').TableSort} TableSort */

/**
 * The page every report is drawn in. A report chooses one of two layouts and
 * supplies content; where that content goes is decided here, once, so every
 * report reads the same way and a report can move between layouts without
 * its view changing.
 *
 * - `stacked`: header, then a "Right now" section holding the headline figures
 *   and snapshot panels, then the report's own sections.
 * - `rail`: the header and headline figures in a sticky left rail, so they stay
 *   in view while a long main column scrolls. Below a usable width the rail
 *   folds back into the stacked layout.
 *
 * Chart widths are arithmetic over the page width the engine measured, the
 * grid's twelve columns and a panel's span. Nothing here measures the DOM.
 */

const GRID_COLUMNS = 12;
const GRID_GAP = 16;
/** A panel's horizontal padding and border, which its chart sits inside. */
const PANEL_CHROME = 30;
const RAIL_WIDTH = 248;
const RAIL_GAP = 24;
/** Narrower than this, the rail leaves too little room for the main column. */
const RAIL_MIN_PAGE_WIDTH = 900;
/** Narrower than this, panels stop sitting side by side. */
const SINGLE_COLUMN_WIDTH = 640;
const MIN_CHART_WIDTH = 160;

/**
 * @typedef {Object} ReportFrameProps
 * @property {string} reportId
 * @property {'stacked' | 'rail'} layout
 * @property {number} width the page width available to the report
 * @property {string} eyebrow what kind of report this is
 * @property {string} title which scope it is about
 * @property {string | null} completeThrough
 * @property {string | null} generatedAt
 * @property {ReportScope[]} scopes every scope this viewer can switch to
 * @property {string} scopeKey
 * @property {string | null} banner
 * @property {ReportContent} content
 * @property {Readonly<Record<string, ReportFilterSpec>>} filterSpecs
 * @property {Record<string, string>} filters
 * @property {string[]} tables ids of panels showing their table
 * @property {Record<string, TableSort>} sorts
 * @property {(name: string, value: string) => void} onFilter
 * @property {(panelId: string) => void} onToggleTable
 * @property {(panelId: string, key: string) => void} onSort
 */

/**
 * @param {ReportFrameProps} props
 * @returns {HTMLElement}
 */
export function ReportFrame(props) {
  const rail = props.layout === 'rail' && props.width >= RAIL_MIN_PAGE_WIDTH;
  const mainWidth = rail ? props.width - RAIL_WIDTH - RAIL_GAP : props.width;
  const content = props.content;
  const kpis = content.kpis ?? [];
  const nowPanels = content.now ?? [];
  const asAt = props.completeThrough
    ? `As at close of ${formatWeekdayDate(props.completeThrough)}`
    : undefined;

  /** @param {ReportPanelSpec[]} panels */
  const grid = (panels) => panelGrid(panels, mainWidth, props);
  const sections = (content.sections ?? []).map((section) =>
    sectionView(section, grid(section.panels), props)
  );

  if (rail) {
    return h(
      'div',
      { className: 'cora-report cora-report--rail' },
      h(
        'aside',
        { className: 'cora-report__rail', key: 'rail' },
        headerView(props),
        bannerView(props.banner),
        kpis.length > 0
          ? h(
              'section',
              {
                className: 'cora-report__rail-now',
                'aria-labelledby': 'cora-report-now',
              },
              h(
                'div',
                { className: 'cora-report-section__head' },
                h('h2', { id: 'cora-report-now' }, 'Right now'),
                asAt
                  ? h('span', { className: 'cora-report-section__scope' }, asAt)
                  : null
              ),
              KpiRow(kpis, { stacked: true })
            )
          : null
      ),
      h(
        'div',
        { className: 'cora-report__main', key: 'main' },
        nowPanels.length > 0 ? grid(nowPanels) : null,
        sections
      )
    );
  }

  return h(
    'div',
    { className: 'cora-report cora-report--stacked' },
    headerView(props),
    bannerView(props.banner),
    kpis.length > 0 || nowPanels.length > 0
      ? sectionView(
          { id: 'now', title: 'Right now', scope: asAt, panels: nowPanels },
          [
            kpis.length > 0 ? KpiRow(kpis) : null,
            nowPanels.length > 0 ? grid(nowPanels) : null,
          ],
          props
        )
      : null,
    sections
  );
}

/** @param {ReportFrameProps} props */
function headerView(props) {
  const published = props.generatedAt
    ? formatTimestamp(props.generatedAt)
    : null;
  return h(
    'header',
    { className: 'cora-report__header', key: 'header' },
    h(
      'div',
      { className: 'cora-report__heading' },
      h('p', { className: 'cora-report__eyebrow' }, props.eyebrow),
      h('h1', { className: 'cora-report__title' }, props.title),
      h(
        'p',
        { className: 'cora-report__freshness' },
        props.completeThrough
          ? [
              'Complete through ',
              h('strong', {}, formatWeekdayDate(props.completeThrough)),
            ]
          : 'Completeness not stated',
        published ? ` · published ${published}` : null
      )
    ),
    props.scopes.length > 1
      ? h(
          'label',
          { className: 'cora-report__scope' },
          h('span', { className: 'cora-report__scope-label' }, 'Showing'),
          h(
            'select',
            {
              value: props.scopeKey,
              onchange: (/** @type {Event} */ event) => {
                const key = /** @type {HTMLSelectElement} */ (
                  event.currentTarget
                ).value;
                navigateTo(
                  `#/reports/${props.reportId}/${encodeURIComponent(key)}`
                );
              },
            },
            props.scopes.map((scope) =>
              h('option', { value: scope.key, key: scope.key }, scope.label)
            )
          )
        )
      : null
  );
}

/** @param {string | null} banner */
function bannerView(banner) {
  return banner
    ? h(
        'p',
        { className: 'cora-report__banner', role: 'status', key: 'banner' },
        banner
      )
    : null;
}

/**
 * @param {ReportSectionSpec} section
 * @param {Node | (Node | null)[]} body
 * @param {ReportFrameProps} props
 */
function sectionView(section, body, props) {
  const headingId = `cora-report-section-${section.id}`;
  const filters = section.filters ?? [];
  return h(
    'section',
    {
      className: 'cora-report-section',
      key: section.id,
      'aria-labelledby': headingId,
    },
    h(
      'div',
      { className: 'cora-report-section__head' },
      h('h2', { id: headingId }, section.title),
      section.scope
        ? h('span', { className: 'cora-report-section__scope' }, section.scope)
        : null,
      filters.length > 0
        ? h(
            'div',
            { className: 'cora-report-section__filters' },
            filters.map((name) => filterView(name, props))
          )
        : null
    ),
    body
  );
}

/**
 * One filter as a row of buttons, the pressed one being the current value.
 * A section names a filter the report does not declare is a mistake in the
 * report, and throws rather than drawing nothing.
 *
 * @param {string} name
 * @param {ReportFrameProps} props
 */
function filterView(name, props) {
  const spec = props.filterSpecs[name];
  if (!spec)
    throw new TypeError(`report section names an undeclared filter: ${name}`);
  return h(
    'div',
    {
      className: 'cora-report-filter',
      role: 'group',
      'aria-label': spec.label,
      key: name,
    },
    spec.options.map((option) =>
      h(
        'button',
        {
          key: option.key,
          className: 'cora-report-filter__option',
          'aria-pressed': String(props.filters[name] === option.key),
          onclick: () => props.onFilter(name, option.key),
        },
        option.label
      )
    )
  );
}

/**
 * @param {ReportPanelSpec[]} panels
 * @param {number} mainWidth
 * @param {ReportFrameProps} props
 */
function panelGrid(panels, mainWidth, props) {
  const single = mainWidth < SINGLE_COLUMN_WIDTH;
  const columnWidth =
    (mainWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  return h(
    'div',
    {
      className: 'cora-report-grid',
      key: `grid-${panels.map((p) => p.id).join('-')}`,
    },
    panels.map((panel) => {
      const span = single ? GRID_COLUMNS : (panel.span ?? GRID_COLUMNS);
      const panelWidth = columnWidth * span + GRID_GAP * (span - 1);
      return ReportPanel(panel, {
        width: Math.max(MIN_CHART_WIDTH, Math.floor(panelWidth - PANEL_CHROME)),
        span,
        showTable: props.tables.includes(panel.id),
        sort: props.sorts[panel.id] ?? null,
        onToggleTable: props.onToggleTable,
        onSort: props.onSort,
      });
    })
  );
}
