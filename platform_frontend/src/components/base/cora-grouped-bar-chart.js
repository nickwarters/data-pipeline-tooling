// @ts-check
import { svg } from '../../lib/html.js';

/** @typedef {'accent' | 'success' | 'warning' | 'danger' | 'info'} GroupedBarChartTone */

/**
 * One mark in a grouped bar chart. Marks sharing a key form one series slot
 * across the groups; the label and tone must agree wherever that key appears.
 *
 * @typedef {Object} GroupedBarChartMark
 * @property {string} key
 * @property {string} label
 * @property {number} value
 * @property {boolean} [provisional]
 * @property {GroupedBarChartTone} [tone]
 */

/**
 * One x-axis group. Group keys are unique across a chart.
 *
 * @typedef {Object} GroupedBarChartGroup
 * @property {string} key
 * @property {string} label
 * @property {GroupedBarChartMark[]} marks
 */

/** @typedef {{ groups: GroupedBarChartGroup[] }} GroupedBarChartData */

/** @typedef {{ top?: number, right?: number, bottom?: number, left?: number }} GroupedBarChartMargin */

/**
 * Format a value used by a y-axis tick or a mark value label. Axis calls omit
 * the mark and group arguments. The result must be non-empty.
 *
 * @typedef {(value: number, mark?: GroupedBarChartMark, group?: GroupedBarChartGroup) => string} GroupedBarChartValueFormatter
 */

/**
 * Format a group label used by the x-axis and mark accessible names.
 *
 * @typedef {(label: string, group: GroupedBarChartGroup) => string} GroupedBarChartGroupLabelFormatter
 */

/**
 * Grouped bar chart configuration. Width and height are positive CSS pixels;
 * all other geometry is derived from the data and these options.
 *
 * @typedef {Object} GroupedBarChartConfig
 * @property {number} width
 * @property {number} height
 * @property {string} ariaLabel
 * @property {GroupedBarChartMargin} [margin]
 * @property {number} [yMax]
 * @property {number} [tickCount]
 * @property {string} [xAxisLabel]
 * @property {string} [yAxisLabel]
 * @property {GroupedBarChartValueFormatter} [formatValue]
 * @property {GroupedBarChartGroupLabelFormatter} [formatGroupLabel]
 */

/** @typedef {{ data: GroupedBarChartData, config: GroupedBarChartConfig }} GroupedBarChartProps */
/** @typedef {{ top: number, right: number, bottom: number, left: number }} ResolvedMargin */
/** @typedef {{ width: number, height: number, ariaLabel: string, margin: ResolvedMargin, yMax: number, tickCount: number, xAxisLabel?: string, yAxisLabel?: string, formatValue: GroupedBarChartValueFormatter, formatGroupLabel: GroupedBarChartGroupLabelFormatter }} ResolvedConfig */
/** @typedef {{ key: string, label: string, tone: GroupedBarChartTone }} GroupedBarChartSeries */

const DEFAULT_MARGIN = Object.freeze({
  top: 20,
  right: 20,
  bottom: 52,
  left: 52,
});
const TONE_TOKENS = Object.freeze({
  accent: 'var(--cora-color-accent)',
  success: 'var(--cora-color-success)',
  warning: 'var(--cora-color-warning)',
  danger: 'var(--cora-color-danger)',
  info: 'var(--cora-color-info)',
});
const MAX_VISIBLE_X_TICKS = 12;
const MAX_LEGEND_ROWS = 12;
const LEGEND_ITEM_MIN_WIDTH = 128;
const LEGEND_ROW_HEIGHT = 20;
const LEGEND_BOTTOM_PADDING = 4;
const VALUE_LABEL_BAND_HEIGHT = 20;
const VALUE_LABEL_GAP = 6;
const LEGEND_LABEL_CHAR_WIDTH = 7;
const MIN_LEFT_MARGIN = 24;
const MIN_BOTTOM_MARGIN = 24;
const MIN_BOTTOM_MARGIN_WITH_AXIS_LABEL = 44;

/** @param {unknown} value @param {string} name @returns {Record<string, any>} */
function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return /** @type {Record<string, any>} */ (value);
}

/** @param {unknown} value @param {string} name @param {boolean} nonEmpty */
function requireString(value, name, nonEmpty = false) {
  if (typeof value !== 'string' || (nonEmpty && value.trim() === '')) {
    throw new TypeError(
      `${name} must be a${nonEmpty ? ' non-empty' : ''} string`
    );
  }
}

/** @param {unknown} value @param {string} name */
function requireFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
}

/** @param {unknown} value @param {string} name */
function requireNonNegativeNumber(value, name) {
  requireFiniteNumber(value, name);
  if (/** @type {number} */ (value) < 0) {
    throw new RangeError(`${name} must be non-negative`);
  }
}

/** @param {unknown} value @param {string} name */
function requirePositiveNumber(value, name) {
  requireFiniteNumber(value, name);
  if (/** @type {number} */ (value) <= 0) {
    throw new RangeError(`${name} must be greater than zero`);
  }
}

/**
 * Validate data before any layout is attempted.
 * @param {unknown} input
 * @returns {{ data: GroupedBarChartData, maxValue: number }}
 */
function validateData(input) {
  const data = requireObject(input, 'data');
  if (!Array.isArray(data.groups)) {
    throw new TypeError('data.groups must be an array');
  }

  const groupKeys = new Set();
  let maxValue = 0;
  for (const groupInput of data.groups) {
    const group = requireObject(groupInput, 'group');
    requireString(group.key, 'group.key', true);
    requireString(group.label, 'group.label', true);
    if (groupKeys.has(group.key)) {
      throw new TypeError(`group.key values must be unique: ${group.key}`);
    }
    groupKeys.add(group.key);
    if (!Array.isArray(group.marks)) {
      throw new TypeError(`marks must be an array for group ${group.key}`);
    }

    const markKeys = new Set();
    for (const markInput of group.marks) {
      const mark = requireObject(markInput, 'mark');
      requireString(mark.key, 'mark.key', true);
      requireString(mark.label, 'mark.label', true);
      if (markKeys.has(mark.key)) {
        throw new TypeError(
          `mark.key values must be unique within group ${group.key}: ${mark.key}`
        );
      }
      markKeys.add(mark.key);
      requireNonNegativeNumber(mark.value, `mark.value for ${mark.key}`);
      maxValue = Math.max(maxValue, mark.value);
      if (
        mark.provisional !== undefined &&
        typeof mark.provisional !== 'boolean'
      ) {
        throw new TypeError(`mark.provisional must be boolean for ${mark.key}`);
      }
      if (
        mark.tone !== undefined &&
        (typeof mark.tone !== 'string' ||
          !Object.prototype.hasOwnProperty.call(TONE_TOKENS, mark.tone))
      ) {
        throw new TypeError(
          `mark.tone must be one of accent, success, warning, danger, info for ${mark.key}`
        );
      }
    }
  }
  return { data: /** @type {GroupedBarChartData} */ (data), maxValue };
}

/** @param {unknown} input @param {boolean} hasXAxisLabel @returns {ResolvedMargin} */
function resolveMargin(input, hasXAxisLabel) {
  const margin =
    input === undefined ? {} : requireObject(input, 'config.margin');
  /** @param {'top' | 'right' | 'bottom' | 'left'} side */
  const side = (side) => {
    const value = margin[side];
    if (value === undefined) return DEFAULT_MARGIN[side];
    requireNonNegativeNumber(value, `config.margin.${side}`);
    if (side === 'left') return Math.max(value, MIN_LEFT_MARGIN);
    if (side === 'bottom') {
      const minimum = hasXAxisLabel
        ? MIN_BOTTOM_MARGIN_WITH_AXIS_LABEL
        : MIN_BOTTOM_MARGIN;
      return Math.max(value, minimum);
    }
    return value;
  };
  return {
    top: side('top'),
    right: side('right'),
    bottom: side('bottom'),
    left: side('left'),
  };
}

/**
 * Keep three significant digits and only use exponent notation when the
 * number is too small or large for a useful ordinary decimal string.
 * @param {number} value
 * @returns {string}
 */
function defaultFormatValue(value) {
  if (value === 0) return '0';
  return String(Number(value.toPrecision(3)));
}

/** @param {string} label @returns {string} */
function defaultFormatGroupLabel(label) {
  return label;
}

/** @param {number} value @returns {number} */
function niceStep(value) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const factor = [1, 2, 2.5, 5, 10].find(
    (candidate) => normalized <= candidate + Number.EPSILON
  );
  return (factor ?? 10) * magnitude;
}

/** @param {number} maxValue @param {number | undefined} configured @param {number} tickCount */
function resolveYMax(maxValue, configured, tickCount) {
  if (configured !== undefined) {
    requirePositiveNumber(configured, 'config.yMax');
    if (configured < maxValue) {
      throw new RangeError('config.yMax must cover every mark value');
    }
    return configured;
  }
  if (maxValue === 0) return 1;
  const step = niceStep(maxValue / (tickCount - 1));
  const candidate = step * (tickCount - 1);
  return Number.isFinite(candidate) ? Math.max(maxValue, candidate) : maxValue;
}

/** @param {GroupedBarChartConfig} input @param {number} maxValue @returns {ResolvedConfig} */
function resolveConfig(input, maxValue) {
  const config = requireObject(input, 'config');
  requirePositiveNumber(config.width, 'config.width');
  requirePositiveNumber(config.height, 'config.height');
  requireString(config.ariaLabel, 'config.ariaLabel', true);

  const tickCount = config.tickCount === undefined ? 5 : config.tickCount;
  if (!Number.isInteger(tickCount) || tickCount < 2) {
    throw new RangeError('config.tickCount must be an integer of at least two');
  }
  if (config.xAxisLabel !== undefined) {
    requireString(config.xAxisLabel, 'config.xAxisLabel', true);
  }
  if (config.yAxisLabel !== undefined) {
    requireString(config.yAxisLabel, 'config.yAxisLabel', true);
  }
  if (
    config.formatValue !== undefined &&
    typeof config.formatValue !== 'function'
  ) {
    throw new TypeError('config.formatValue must be a function');
  }
  if (
    config.formatGroupLabel !== undefined &&
    typeof config.formatGroupLabel !== 'function'
  ) {
    throw new TypeError('config.formatGroupLabel must be a function');
  }
  const margin = resolveMargin(config.margin, config.xAxisLabel !== undefined);

  return {
    width: config.width,
    height: config.height,
    ariaLabel: config.ariaLabel,
    margin,
    yMax: resolveYMax(maxValue, config.yMax, tickCount),
    tickCount,
    xAxisLabel: config.xAxisLabel,
    yAxisLabel: config.yAxisLabel,
    formatValue: config.formatValue ?? defaultFormatValue,
    formatGroupLabel: config.formatGroupLabel ?? defaultFormatGroupLabel,
  };
}

/**
 * @param {GroupedBarChartGroup[]} groups
 * @returns {{ slots: GroupedBarChartSeries[], byKey: Map<string, { index: number, series: GroupedBarChartSeries }> }}
 */
function resolveSeriesSlots(groups) {
  /** @type {Map<string, GroupedBarChartSeries>} */
  const identities = new Map();
  for (const group of groups) {
    for (const mark of group.marks) {
      const tone = mark.tone ?? 'accent';
      const existing = identities.get(mark.key);
      if (existing) {
        if (existing.label !== mark.label || existing.tone !== tone) {
          throw new TypeError(
            `mark key "${mark.key}" has conflicting series identity across groups; label and tone must stay ${existing.label}/${existing.tone}`
          );
        }
        continue;
      }
      identities.set(mark.key, { key: mark.key, label: mark.label, tone });
    }
  }

  const slots = [...identities.values()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  );
  const byKey = new Map(
    slots.map((series, index) => [series.key, { index, series }])
  );
  return { slots, byKey };
}

/** @param {number} groupCount @returns {number[]} */
function evenlySpacedIndexes(groupCount) {
  if (groupCount <= MAX_VISIBLE_X_TICKS) {
    return Array.from({ length: groupCount }, (_, index) => index);
  }
  const indexes = [];
  let previous = -1;
  for (let index = 0; index < MAX_VISIBLE_X_TICKS; index += 1) {
    const candidate = Math.round(
      (index * (groupCount - 1)) / (MAX_VISIBLE_X_TICKS - 1)
    );
    if (candidate !== previous) indexes.push(candidate);
    previous = candidate;
  }
  return indexes;
}

/** @param {string[]} labels @returns {number[]} */
function visibleXTickIndexes(labels) {
  const indexes = [];
  const seen = new Set();
  for (const index of evenlySpacedIndexes(labels.length)) {
    const label = labels[index].trim();
    if (seen.has(label)) continue;
    seen.add(label);
    indexes.push(index);
  }
  return indexes;
}

/** @param {number} seriesCount @param {number} plotWidth */
function resolveLegendLayout(seriesCount, plotWidth) {
  if (seriesCount === 0) {
    return { columns: 0, rows: 0, itemWidth: 0, height: 0 };
  }
  const columns = Math.max(
    1,
    Math.min(seriesCount, Math.floor(plotWidth / LEGEND_ITEM_MIN_WIDTH))
  );
  const rows = Math.ceil(seriesCount / columns);
  return {
    columns,
    rows,
    itemWidth: plotWidth / columns,
    height: rows * LEGEND_ROW_HEIGHT + LEGEND_BOTTOM_PADDING,
  };
}

/** @param {string} label @param {number} itemWidth @returns {string} */
function visibleLegendLabel(label, itemWidth) {
  const maxCharacters = Math.max(
    1,
    Math.floor((itemWidth - 14) / LEGEND_LABEL_CHAR_WIDTH)
  );
  if (label.length <= maxCharacters) return label;
  if (maxCharacters === 1) return '…';
  return `${label.slice(0, maxCharacters - 1)}…`;
}

/** @param {GroupedBarChartValueFormatter} formatter @param {number} value @param {GroupedBarChartMark | undefined} mark @param {GroupedBarChartGroup | undefined} group */
function formatValue(formatter, value, mark, group) {
  const result = formatter(value, mark, group);
  if (typeof result !== 'string' || result.trim() === '') {
    throw new TypeError('config.formatValue must return a non-empty string');
  }
  return result;
}

/** @param {GroupedBarChartGroupLabelFormatter} formatter @param {GroupedBarChartGroup} group */
function formatGroupLabel(formatter, group) {
  const result = formatter(group.label, group);
  if (typeof result !== 'string' || result.trim() === '') {
    throw new TypeError(
      'config.formatGroupLabel must return a non-empty string'
    );
  }
  return result;
}

/** @param {number} value @param {number} yMax @param {number} top @param {number} height */
function barY(value, yMax, top, height) {
  return geometry(top + height - (value / yMax) * height);
}

/** @param {number} value @param {number} yMax @param {number} height */
function barHeight(value, yMax, height) {
  return geometry((value / yMax) * height);
}

/** @param {number} value @returns {number} */
function geometry(value) {
  return Number(value.toFixed(6));
}

/** @param {string[]} labels */
function requireDistinctTickLabels(labels) {
  const seen = new Set();
  for (const label of labels) {
    if (seen.has(label)) {
      throw new TypeError(
        'config.tickCount/config.yMax and config.formatValue must produce distinct labels for y-axis ticks; use fewer ticks or a more precise formatter'
      );
    }
    seen.add(label);
  }
}

/**
 * Build one mark. The rectangle owns the accessible image semantics; the
 * visible text is marked as decorative so assistive technology announces each
 * mark once.
 *
 * @param {GroupedBarChartMark} mark
 * @param {GroupedBarChartSeries} series
 * @param {string} groupLabel
 * @param {string} valueLabel
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @returns {SVGElement}
 */
function markView(mark, series, groupLabel, valueLabel, x, y, width, height) {
  const token = TONE_TOKENS[series.tone];
  const provisional = mark.provisional === true;
  const description = `${groupLabel}: ${series.label}, ${valueLabel}${provisional ? ', provisional' : ''}`;
  return svg(
    'g',
    { className: 'cora-grouped-bar-chart__mark', key: mark.key },
    svg('rect', {
      className: `cora-grouped-bar-chart__bar${provisional ? ' cora-grouped-bar-chart__bar--provisional' : ''}`,
      key: 'bar',
      x,
      y,
      width,
      height,
      fill: provisional ? 'none' : token,
      stroke: token,
      'stroke-width': provisional ? 2 : 1,
      role: 'img',
      'aria-label': description,
      'data-cora-chart-mark': 'true',
      'data-cora-chart-value': valueLabel,
      tabindex: '0',
      focusable: true,
    }),
    svg(
      'text',
      {
        className: 'cora-grouped-bar-chart__value-label',
        key: 'value-label',
        x: x + width / 2,
        y: y - VALUE_LABEL_GAP,
        'text-anchor': 'middle',
        'aria-hidden': 'true',
      },
      valueLabel
    )
  );
}

/** @param {GroupedBarChartSeries[]} series @param {ResolvedMargin} margin @param {{ columns: number, rows: number, itemWidth: number, height: number }} layout */
function legendView(series, margin, layout) {
  if (series.length === 0) return null;
  return svg(
    'g',
    {
      className: 'cora-grouped-bar-chart__legend',
      key: 'legend',
      role: 'group',
      'aria-label': 'Chart series',
    },
    series.map((item, index) => {
      const row = Math.floor(index / layout.columns);
      const column = index % layout.columns;
      const x = margin.left + column * layout.itemWidth;
      const labelY = margin.top + row * LEGEND_ROW_HEIGHT + 14;
      return svg(
        'g',
        {
          className: 'cora-grouped-bar-chart__legend-item',
          key: item.key,
          role: 'img',
          'aria-label': item.label,
        },
        svg('title', { key: 'title' }, item.label),
        svg('rect', {
          className: 'cora-grouped-bar-chart__legend-swatch',
          key: 'swatch',
          x,
          y: labelY - 10,
          width: 10,
          height: 10,
          fill: TONE_TOKENS[item.tone],
          stroke: TONE_TOKENS[item.tone],
        }),
        svg(
          'text',
          {
            className: 'cora-grouped-bar-chart__legend-label',
            key: 'label',
            x: x + 14,
            y: labelY,
          },
          visibleLegendLabel(item.label, layout.itemWidth)
        )
      );
    })
  );
}

/** @param {GroupedBarChartGroup[]} groups @param {string[]} groupLabels @param {ResolvedConfig} config @param {number} baseline @param {number} plotWidth */
function xAxisView(groups, groupLabels, config, baseline, plotWidth) {
  const indexes = visibleXTickIndexes(groupLabels);
  const groupBand = groups.length > 0 ? plotWidth / groups.length : plotWidth;
  return svg(
    'g',
    { className: 'cora-grouped-bar-chart__x-axis', key: 'x-axis' },
    svg('line', {
      className: 'cora-grouped-bar-chart__axis-line',
      key: 'line',
      x1: config.margin.left,
      y1: baseline,
      x2: config.width - config.margin.right,
      y2: baseline,
      stroke: 'var(--cora-color-border-strong)',
    }),
    indexes.map((groupIndex) => {
      const x = config.margin.left + groupIndex * groupBand + groupBand / 2;
      return svg(
        'g',
        {
          className: 'cora-grouped-bar-chart__x-tick',
          key: groups[groupIndex].key,
        },
        svg('line', {
          className: 'cora-grouped-bar-chart__tick-line',
          key: 'line',
          x1: x,
          y1: baseline,
          x2: x,
          y2: baseline + 5,
          stroke: 'var(--cora-color-border-strong)',
        }),
        svg(
          'text',
          {
            className: 'cora-grouped-bar-chart__group-label',
            key: 'label',
            x,
            y: baseline + 18,
            'text-anchor': 'middle',
          },
          groupLabels[groupIndex]
        )
      );
    }),
    config.xAxisLabel === undefined
      ? null
      : svg(
          'text',
          {
            className: 'cora-grouped-bar-chart__x-axis-label',
            key: 'label',
            x: config.margin.left + plotWidth / 2,
            y: config.height - 8,
            'text-anchor': 'middle',
          },
          config.xAxisLabel
        )
  );
}

/** @param {ResolvedConfig} config @param {number[]} tickValues @param {string[]} tickLabels @param {number} plotTop @param {number} plotHeight @param {number} baseline */
function yAxisView(
  config,
  tickValues,
  tickLabels,
  plotTop,
  plotHeight,
  baseline
) {
  return svg(
    'g',
    { className: 'cora-grouped-bar-chart__y-axis', key: 'y-axis' },
    svg('line', {
      className: 'cora-grouped-bar-chart__axis-line',
      key: 'line',
      x1: config.margin.left,
      y1: plotTop,
      x2: config.margin.left,
      y2: baseline,
      stroke: 'var(--cora-color-border-strong)',
    }),
    tickValues.map((value, index) => {
      const y = barY(value, config.yMax, plotTop, plotHeight);
      return svg(
        'g',
        { className: 'cora-grouped-bar-chart__y-tick', key: `tick-${index}` },
        svg('line', {
          className: 'cora-grouped-bar-chart__grid-line',
          key: 'line',
          x1: config.margin.left,
          y1: y,
          x2: config.width - config.margin.right,
          y2: y,
        }),
        svg(
          'text',
          {
            className: 'cora-grouped-bar-chart__tick-label',
            key: 'label',
            x: config.margin.left - 8,
            y: y + 4,
            'text-anchor': 'end',
          },
          tickLabels[index]
        )
      );
    }),
    config.yAxisLabel === undefined
      ? null
      : svg(
          'text',
          {
            className: 'cora-grouped-bar-chart__y-axis-label',
            key: 'label',
            x: 14,
            y: plotTop + plotHeight / 2,
            transform: `rotate(-90 14 ${plotTop + plotHeight / 2})`,
            'text-anchor': 'middle',
          },
          config.yAxisLabel
        )
  );
}

/**
 * Build a pure detached SVG tree for grouped, side-by-side bars. Data loading
 * and upstream mapping belong to the caller; this function only validates the
 * chart model and builds its SVG tree.
 *
 * @param {GroupedBarChartProps} props
 * @returns {SVGSVGElement}
 */
export function GroupedBarChart(props) {
  if (props === null || typeof props !== 'object' || Array.isArray(props)) {
    throw new TypeError('GroupedBarChart expects { data, config }');
  }
  const { data, maxValue } = validateData(props.data);
  const { slots, byKey } = resolveSeriesSlots(data.groups);
  const config = resolveConfig(props.config, maxValue);
  const plotWidth = config.width - config.margin.left - config.margin.right;
  if (plotWidth <= 0) {
    throw new RangeError(
      `GroupedBarChart cannot draw ${data.groups.length} groups and ${slots.length} series: horizontal margins leave no plot area`
    );
  }

  const legend = resolveLegendLayout(slots.length, plotWidth);
  if (legend.rows > MAX_LEGEND_ROWS) {
    throw new RangeError(
      `GroupedBarChart cannot draw ${slots.length} series in ${legend.rows} legend rows for ${data.groups.length} groups; increase width or reduce the series count`
    );
  }
  const plotTop = config.margin.top + legend.height + VALUE_LABEL_BAND_HEIGHT;
  const plotHeight = config.height - config.margin.bottom - plotTop;
  if (plotHeight <= 0) {
    throw new RangeError(
      `GroupedBarChart cannot draw ${data.groups.length} groups and ${slots.length} series: legend, value-label band, and margins leave no plot area; increase height or reduce the series count`
    );
  }

  const baseline = plotTop + plotHeight;
  const groupBand =
    data.groups.length > 0 ? plotWidth / data.groups.length : plotWidth;
  const seriesCount = slots.length;
  const groupPadding = seriesCount > 0 ? Math.min(12, groupBand * 0.15) : 0;
  const markGap = seriesCount > 1 ? Math.min(4, groupBand * 0.03) : 0;
  const barWidth =
    seriesCount > 0
      ? (groupBand - groupPadding * 2 - markGap * (seriesCount - 1)) /
        seriesCount
      : 0;
  if (seriesCount > 0 && barWidth <= 0) {
    throw new RangeError(
      `GroupedBarChart cannot draw ${seriesCount} series in a ${data.groups.length}-group chart: each group is too narrow for a bar`
    );
  }

  const groupLabels = data.groups.map((group) =>
    formatGroupLabel(config.formatGroupLabel, group)
  );
  const tickValues = Array.from(
    { length: config.tickCount },
    (_, index) => config.yMax * (index / (config.tickCount - 1))
  );
  const tickLabels = tickValues.map((value) =>
    formatValue(config.formatValue, value, undefined, undefined)
  );
  requireDistinctTickLabels(tickLabels);

  const barsLayer = svg(
    'g',
    { className: 'cora-grouped-bar-chart__bars', key: 'bars' },
    data.groups.map((group, groupIndex) => {
      const groupStart = config.margin.left + groupIndex * groupBand;
      const markStart = groupStart + groupPadding;
      return svg(
        'g',
        {
          className: 'cora-grouped-bar-chart__group',
          key: group.key,
        },
        group.marks.map((mark) => {
          const slot = byKey.get(mark.key);
          if (!slot)
            throw new TypeError(`mark key is not a known series: ${mark.key}`);
          const valueLabel = formatValue(
            config.formatValue,
            mark.value,
            mark,
            group
          );
          const x = markStart + slot.index * (barWidth + markGap);
          const y = barY(mark.value, config.yMax, plotTop, plotHeight);
          const height = barHeight(mark.value, config.yMax, plotHeight);
          return markView(
            mark,
            slot.series,
            groupLabels[groupIndex],
            valueLabel,
            x,
            y,
            barWidth,
            height
          );
        })
      );
    })
  );

  return /** @type {SVGSVGElement} */ (
    svg(
      'svg',
      {
        className: 'cora-grouped-bar-chart',
        viewBox: `0 0 ${config.width} ${config.height}`,
        width: config.width,
        height: config.height,
        role: 'group',
        'aria-label': config.ariaLabel,
      },
      legendView(slots, config.margin, legend),
      yAxisView(config, tickValues, tickLabels, plotTop, plotHeight, baseline),
      barsLayer,
      xAxisView(data.groups, groupLabels, config, baseline, plotWidth)
    )
  );
}
