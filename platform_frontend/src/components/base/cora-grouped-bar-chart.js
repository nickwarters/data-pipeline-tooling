// @ts-check
import { svg } from '../../lib/html.js';

/** @typedef {'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'} GroupedBarChartTone */

/**
 * One mark in a grouped bar chart. Marks sharing a key form one series
 * identity across the groups; multi-mark groups use one slot for that series,
 * while singleton groups center their only bar on the group tick. The label and
 * tone must agree wherever that key appears.
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
 * @property {string[]} [seriesOrder] Series keys in their preferred visual order
 * @property {GroupedBarChartValueFormatter} [formatValue]
 * @property {GroupedBarChartGroupLabelFormatter} [formatGroupLabel]
 * @property {string} [emphasis] The group to spotlight: `'latest'` (the
 *   default) for the last group, a group key, or `'none'` for no spotlight
 * @property {string} [emphasisLabel] The tag above the spotlit group, such as
 *   `'Today'` or `'This month'`; defaults to `'Latest'`
 */

/** @typedef {{ data: GroupedBarChartData, config: GroupedBarChartConfig }} GroupedBarChartProps */
/** @typedef {{ top: number, right: number, bottom: number, left: number }} ResolvedMargin */
/** @typedef {{ width: number, height: number, ariaLabel: string, margin: ResolvedMargin, yMax: number, tickCount: number, xAxisLabel?: string, yAxisLabel?: string, seriesOrder: string[], formatValue: GroupedBarChartValueFormatter, formatGroupLabel: GroupedBarChartGroupLabelFormatter, emphasis: string, emphasisLabel: string }} ResolvedConfig */
/** @typedef {{ x: number, row: number, label: string }} LegendPlacement */
/** @typedef {{ rows: number, height: number, items: LegendPlacement[] }} LegendLayout */
/** @typedef {{ key: string, label: string, tone: GroupedBarChartTone, provisional: boolean }} GroupedBarChartSeries */

const DEFAULT_MARGIN = Object.freeze({
  top: 8,
  right: 12,
  bottom: 32,
  left: 40,
});
// The neutral tone is the chart's own ink rather than the text colour: history
// is the quiet part of a chart, so it should not be the darkest thing on the
// page.
const TONE_TOKENS = Object.freeze({
  accent: 'var(--cora-color-accent)',
  success: 'var(--cora-color-success)',
  warning: 'var(--cora-color-warning)',
  danger: 'var(--cora-color-danger)',
  info: 'var(--cora-color-info)',
  neutral: 'var(--cora-color-chart-ink)',
});
const EMPHASIS_FILL = 'var(--cora-color-accent-muted)';
const MAX_VISIBLE_X_TICKS = 12;
const MAX_LEGEND_ROWS = 12;
const LEGEND_SWATCH_SIZE = 12;
const LEGEND_SWATCH_LABEL_GAP = 5;
const LEGEND_ITEM_GAP = 20;
const LEGEND_ROW_HEIGHT = 20;
const LEGEND_BOTTOM_PADDING = 4;
const CAPTION_BAND_HEIGHT = 18;
const VALUE_LABEL_BAND_HEIGHT = 20;
const VALUE_LABEL_GAP = 6;
const LEGEND_LABEL_CHAR_WIDTH = 7;
const X_LABEL_CHAR_WIDTH = 6.5;
const X_LABEL_MIN_GAP = 8;
const MAX_BAR_WIDTH = 24;
const BAR_BAND_SHARE = 0.62;
const BAR_CORNER_RADIUS = 3;
const PROVISIONAL_FILL_OPACITY = 0.18;
const PROVISIONAL_STROKE_WIDTH = 1.5;
const PROVISIONAL_DASH = '3 2';
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
          `mark.tone must be one of accent, success, warning, danger, info, neutral for ${mark.key}`
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
    const given = margin[side];
    if (given !== undefined) {
      requireNonNegativeNumber(given, `config.margin.${side}`);
    }
    const value = given ?? DEFAULT_MARGIN[side];
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

/**
 * The spotlit group defaults to the last one, because the latest bucket is
 * what a reader of a time series comes to see. A key that names no group is
 * refused rather than quietly spotlighting nothing.
 *
 * @param {unknown} emphasis
 * @param {GroupedBarChartGroup[]} groups
 * @returns {string}
 */
function resolveEmphasis(emphasis, groups) {
  if (emphasis === undefined) return 'latest';
  requireString(emphasis, 'config.emphasis', true);
  const value = /** @type {string} */ (emphasis);
  if (value === 'latest' || value === 'none') return value;
  if (!groups.some((group) => group.key === value)) {
    throw new TypeError(
      `config.emphasis must be 'latest', 'none' or a group key: ${value}`
    );
  }
  return value;
}

/** @param {GroupedBarChartConfig} input @param {number} maxValue @param {GroupedBarChartGroup[]} groups @returns {ResolvedConfig} */
function resolveConfig(input, maxValue, groups) {
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
  const seriesOrder =
    config.seriesOrder === undefined ? [] : config.seriesOrder;
  if (!Array.isArray(seriesOrder)) {
    throw new TypeError('config.seriesOrder must be an array');
  }
  const seriesOrderKeys = new Set();
  for (const key of seriesOrder) {
    requireString(key, 'config.seriesOrder item', true);
    if (seriesOrderKeys.has(key)) {
      throw new TypeError(`config.seriesOrder values must be unique: ${key}`);
    }
    seriesOrderKeys.add(key);
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
  if (config.emphasisLabel !== undefined) {
    requireString(config.emphasisLabel, 'config.emphasisLabel', true);
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
    seriesOrder: [...seriesOrder],
    formatValue: config.formatValue ?? defaultFormatValue,
    formatGroupLabel: config.formatGroupLabel ?? defaultFormatGroupLabel,
    emphasis: resolveEmphasis(config.emphasis, groups),
    emphasisLabel: config.emphasisLabel ?? 'Latest',
  };
}

/**
 * @param {GroupedBarChartGroup[]} groups
 * @param {string[]} preferredOrder
 * @returns {{ slots: GroupedBarChartSeries[], byKey: Map<string, { index: number, series: GroupedBarChartSeries }> }}
 */
function resolveSeriesSlots(groups, preferredOrder) {
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
      identities.set(mark.key, {
        key: mark.key,
        label: mark.label,
        tone,
        provisional: false,
      });
    }
  }
  // A series is drawn as provisional in the legend when any of its marks is,
  // so the swatch always matches a bar the reader can find on the chart.
  for (const group of groups) {
    for (const mark of group.marks) {
      const series = identities.get(mark.key);
      if (series && mark.provisional === true) series.provisional = true;
    }
  }

  const preferredIndexes = new Map(
    preferredOrder.map((key, index) => [key, index])
  );
  const slots = [...identities.values()].sort((a, b) => {
    const aPreferred = preferredIndexes.get(a.key);
    const bPreferred = preferredIndexes.get(b.key);
    if (aPreferred !== undefined || bPreferred !== undefined) {
      if (aPreferred === undefined) return 1;
      if (bPreferred === undefined) return -1;
      if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  const byKey = new Map(
    slots.map((series, index) => [series.key, { index, series }])
  );
  return { slots, byKey };
}

/**
 * Choose which group labels the x-axis prints. Labels are thinned to a common
 * stride wide enough that the longest one never runs into its neighbour, and
 * never more than twelve are shown. The first and the last always appear: the
 * last is usually the bucket the reader came for.
 *
 * @param {string[]} labels
 * @param {number} groupBand
 * @returns {number[]}
 */
function visibleXTickIndexes(labels, groupBand) {
  if (labels.length === 0) return [];
  const widest = Math.max(...labels.map((label) => label.length));
  const stride = Math.max(
    1,
    Math.ceil((widest * X_LABEL_CHAR_WIDTH + X_LABEL_MIN_GAP) / groupBand),
    Math.ceil(labels.length / MAX_VISIBLE_X_TICKS)
  );
  const indexes = [];
  for (let index = 0; index < labels.length; index += stride) {
    indexes.push(index);
  }
  const last = labels.length - 1;
  if (indexes[indexes.length - 1] !== last) {
    if (indexes.length > 1 && last - indexes[indexes.length - 1] < stride) {
      indexes.pop();
    }
    indexes.push(last);
  }
  const seen = new Set();
  return indexes.filter((index) => {
    const label = labels[index].trim();
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}

/** @param {string} label @param {number} maxWidth @returns {string} */
function visibleLegendLabel(label, maxWidth) {
  const maxCharacters = Math.max(
    1,
    Math.floor(
      (maxWidth - LEGEND_SWATCH_SIZE - LEGEND_SWATCH_LABEL_GAP) /
        LEGEND_LABEL_CHAR_WIDTH
    )
  );
  if (label.length <= maxCharacters) return label;
  if (maxCharacters === 1) return '…';
  return `${label.slice(0, maxCharacters - 1)}…`;
}

/**
 * Legend items sit one after another at their own width and wrap when the
 * next one would overrun the plot, so a two-series chart reads as one compact
 * key rather than labels spread across the full width.
 *
 * @param {GroupedBarChartSeries[]} series
 * @param {number} plotWidth
 * @returns {LegendLayout}
 */
function resolveLegendLayout(series, plotWidth) {
  if (series.length === 0) return { rows: 0, height: 0, items: [] };
  /** @type {LegendPlacement[]} */
  const items = [];
  let x = 0;
  let row = 0;
  for (const item of series) {
    const label = visibleLegendLabel(item.label, plotWidth);
    const width =
      LEGEND_SWATCH_SIZE +
      LEGEND_SWATCH_LABEL_GAP +
      label.length * LEGEND_LABEL_CHAR_WIDTH;
    if (x > 0 && x + width > plotWidth) {
      x = 0;
      row += 1;
    }
    items.push({ x, row, label });
    x += width + LEGEND_ITEM_GAP;
  }
  const rows = row + 1;
  return {
    rows,
    height: rows * LEGEND_ROW_HEIGHT + LEGEND_BOTTOM_PADDING,
    items,
  };
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
 * The fill and outline of a mark or legend swatch. A solid mark is its tone
 * and nothing else. A provisional one keeps the same tone as a dashed outline
 * over a faint wash of it, so it reads as unfinished without needing a second
 * colour: colour is left free to mean the series.
 *
 * @param {GroupedBarChartTone} tone
 * @param {boolean} provisional
 * @returns {Record<string, string | number>}
 */
function markPaint(tone, provisional) {
  const token = TONE_TOKENS[tone];
  if (!provisional) return { fill: token };
  return {
    fill: token,
    'fill-opacity': PROVISIONAL_FILL_OPACITY,
    stroke: token,
    'stroke-width': PROVISIONAL_STROKE_WIDTH,
    'stroke-dasharray': PROVISIONAL_DASH,
  };
}

/**
 * Build one mark. The rectangle owns the accessible image semantics; the
 * visible text is marked as decorative so assistive technology announces each
 * mark once. Only some marks print their value, so a chart is read from its
 * shape and the numbers that matter rather than a number on every bar; the
 * full value of every mark stays in its accessible name and tooltip.
 *
 * @param {GroupedBarChartMark} mark
 * @param {GroupedBarChartSeries} series
 * @param {string} groupLabel
 * @param {string} valueLabel
 * @param {{ x: number, y: number, width: number, height: number }} box
 * @param {'none' | 'plain' | 'emphasis'} valueLabelStyle
 * @returns {SVGElement}
 */
function markView(mark, series, groupLabel, valueLabel, box, valueLabelStyle) {
  const provisional = mark.provisional === true;
  const description = `${groupLabel}: ${series.label}, ${valueLabel}${provisional ? ', provisional' : ''}`;
  return svg(
    'g',
    { className: 'cora-grouped-bar-chart__mark', key: mark.key },
    svg('rect', {
      className: `cora-grouped-bar-chart__bar${provisional ? ' cora-grouped-bar-chart__bar--provisional' : ''}`,
      key: 'bar',
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rx: BAR_CORNER_RADIUS,
      ...markPaint(series.tone, provisional),
      role: 'img',
      'aria-label': description,
      'data-cora-chart-mark': 'true',
      'data-cora-chart-description': description,
      tabindex: '0',
    }),
    valueLabelStyle === 'none'
      ? null
      : svg(
          'text',
          {
            className: `cora-grouped-bar-chart__value-label${valueLabelStyle === 'emphasis' ? ' cora-grouped-bar-chart__value-label--emphasis' : ''}`,
            key: 'value-label',
            x: geometry(box.x + box.width / 2),
            y: geometry(box.y - VALUE_LABEL_GAP),
            'text-anchor': 'middle',
            'aria-hidden': 'true',
          },
          valueLabel
        )
  );
}

/** @param {GroupedBarChartSeries[]} series @param {ResolvedMargin} margin @param {LegendLayout} layout */
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
      const placement = layout.items[index];
      const x = margin.left + placement.x;
      const labelY = margin.top + placement.row * LEGEND_ROW_HEIGHT + 14;
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
          y: labelY - 11,
          width: LEGEND_SWATCH_SIZE,
          height: LEGEND_SWATCH_SIZE,
          rx: 2,
          ...markPaint(item.tone, item.provisional),
        }),
        svg(
          'text',
          {
            className: 'cora-grouped-bar-chart__legend-label',
            key: 'label',
            x: x + LEGEND_SWATCH_SIZE + LEGEND_SWATCH_LABEL_GAP,
            y: labelY,
          },
          placement.label
        )
      );
    })
  );
}

/**
 * A group label sits centred under its group unless that would push it past
 * the edge of the chart, which happens to the last label first because it is
 * often the longest ("Oct 20 (today)"). Such a label is aligned to the edge
 * instead, so it is never clipped.
 *
 * @param {number} centre
 * @param {string} label
 * @param {number} width
 * @returns {{ x: number, anchor: 'start' | 'middle' | 'end' }}
 */
function groupLabelPlacement(centre, label, width) {
  const half = (label.length * X_LABEL_CHAR_WIDTH) / 2;
  if (centre + half > width) return { x: width, anchor: 'end' };
  if (centre - half < 0) return { x: 0, anchor: 'start' };
  return { x: geometry(centre), anchor: 'middle' };
}

/** @param {GroupedBarChartGroup[]} groups @param {string[]} groupLabels @param {ResolvedConfig} config @param {number} baseline @param {number} plotWidth @param {number} emphasisIndex */
function xAxisView(
  groups,
  groupLabels,
  config,
  baseline,
  plotWidth,
  emphasisIndex
) {
  const groupBand = groups.length > 0 ? plotWidth / groups.length : plotWidth;
  const indexes = visibleXTickIndexes(groupLabels, groupBand);
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
      const { x, anchor } = groupLabelPlacement(
        config.margin.left + groupIndex * groupBand + groupBand / 2,
        groupLabels[groupIndex],
        config.width
      );
      return svg(
        'g',
        {
          className: 'cora-grouped-bar-chart__x-tick',
          key: groups[groupIndex].key,
        },
        svg(
          'text',
          {
            className: `cora-grouped-bar-chart__group-label${groupIndex === emphasisIndex ? ' cora-grouped-bar-chart__group-label--emphasis' : ''}`,
            key: 'label',
            x,
            y: baseline + 18,
            'text-anchor': anchor,
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

/**
 * Hairline gridlines and their values. There is no vertical axis rule and no
 * gridline at zero, where the x-axis already draws the baseline; the unit
 * reads once as a caption above the plot instead of rotated down its side.
 *
 * @param {ResolvedConfig} config
 * @param {number[]} tickValues
 * @param {string[]} tickLabels
 * @param {number} captionY
 * @param {number} plotTop
 * @param {number} plotHeight
 */
function yAxisView(
  config,
  tickValues,
  tickLabels,
  captionY,
  plotTop,
  plotHeight
) {
  return svg(
    'g',
    { className: 'cora-grouped-bar-chart__y-axis', key: 'y-axis' },
    tickValues.map((value, index) => {
      const y = barY(value, config.yMax, plotTop, plotHeight);
      return svg(
        'g',
        { className: 'cora-grouped-bar-chart__y-tick', key: `tick-${index}` },
        value === 0
          ? null
          : svg('line', {
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
            x: config.margin.left,
            y: captionY,
            'text-anchor': 'start',
          },
          config.yAxisLabel
        )
  );
}

/**
 * The spotlight: a tinted band behind one group with its tag above it. It is
 * decoration over the marks, which already name their group, so it is hidden
 * from assistive technology rather than announced twice.
 *
 * @param {ResolvedConfig} config
 * @param {number} groupStart
 * @param {number} groupBand
 * @param {number} bandTop
 * @param {number} baseline
 * @param {number} captionY
 */
function emphasisView(
  config,
  groupStart,
  groupBand,
  bandTop,
  baseline,
  captionY
) {
  return svg(
    'g',
    {
      className: 'cora-grouped-bar-chart__emphasis',
      key: 'emphasis',
      'aria-hidden': 'true',
    },
    svg('rect', {
      className: 'cora-grouped-bar-chart__emphasis-band',
      key: 'band',
      x: geometry(groupStart),
      y: geometry(bandTop),
      width: geometry(groupBand),
      height: geometry(baseline - bandTop),
      rx: 4,
      fill: EMPHASIS_FILL,
    }),
    svg(
      'text',
      {
        className: 'cora-grouped-bar-chart__emphasis-label',
        key: 'label',
        x: geometry(groupStart + groupBand / 2),
        y: captionY,
        'text-anchor': 'middle',
      },
      config.emphasisLabel
    )
  );
}

/** @param {ResolvedConfig} config @param {GroupedBarChartGroup[]} groups @returns {number} */
function emphasisIndexOf(config, groups) {
  if (config.emphasis === 'none' || groups.length === 0) return -1;
  if (config.emphasis === 'latest') return groups.length - 1;
  return groups.findIndex((group) => group.key === config.emphasis);
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
  const config = resolveConfig(props.config, maxValue, data.groups);
  const { slots, byKey } = resolveSeriesSlots(data.groups, config.seriesOrder);
  const plotWidth = config.width - config.margin.left - config.margin.right;
  if (plotWidth <= 0) {
    throw new RangeError(
      `GroupedBarChart cannot draw ${data.groups.length} groups and ${slots.length} series: horizontal margins leave no plot area`
    );
  }

  const legend = resolveLegendLayout(slots, plotWidth);
  if (legend.rows > MAX_LEGEND_ROWS) {
    throw new RangeError(
      `GroupedBarChart cannot draw ${slots.length} series in ${legend.rows} legend rows for ${data.groups.length} groups; increase width or reduce the series count`
    );
  }
  // Below the legend sits one caption band, shared by the unit caption and the
  // spotlight tag, then the band that keeps value labels clear of both.
  const captionTop = config.margin.top + legend.height;
  const captionY = captionTop + 12;
  const plotTop = captionTop + CAPTION_BAND_HEIGHT + VALUE_LABEL_BAND_HEIGHT;
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
  const markGap = seriesCount > 1 ? Math.min(2, groupBand * 0.03) : 0;
  const barWidth =
    seriesCount > 0
      ? Math.min(
          MAX_BAR_WIDTH,
          (groupBand * BAR_BAND_SHARE - markGap * (seriesCount - 1)) /
            seriesCount
        )
      : 0;
  if (seriesCount > 0 && barWidth <= 0) {
    throw new RangeError(
      `GroupedBarChart cannot draw ${seriesCount} series in a ${data.groups.length}-group chart: each group is too narrow for a bar`
    );
  }
  const clusterWidth = barWidth * seriesCount + markGap * (seriesCount - 1);
  const emphasisIndex = emphasisIndexOf(config, data.groups);

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
      const emphasised = groupIndex === emphasisIndex;
      // A sparse bucket represents one point on the x-axis, so center its
      // bar on the tick. Groups with multiple marks retain their stable slots
      // within a cluster centered the same way.
      const markStart =
        group.marks.length === 1
          ? groupStart + (groupBand - barWidth) / 2
          : groupStart + (groupBand - clusterWidth) / 2;
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
          const slotIndex = group.marks.length === 1 ? 0 : slot.index;
          const x = geometry(markStart + slotIndex * (barWidth + markGap));
          // The spotlit group always prints its numbers, a zero included, and
          // the peak prints its own so the top of the scale is never a guess.
          const valueLabelStyle = emphasised
            ? 'emphasis'
            : mark.value > 0 && mark.value === maxValue
              ? 'plain'
              : 'none';
          return markView(
            mark,
            slot.series,
            groupLabels[groupIndex],
            valueLabel,
            {
              x,
              y: barY(mark.value, config.yMax, plotTop, plotHeight),
              width: geometry(barWidth),
              height: barHeight(mark.value, config.yMax, plotHeight),
            },
            valueLabelStyle
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
      yAxisView(config, tickValues, tickLabels, captionY, plotTop, plotHeight),
      emphasisIndex === -1
        ? null
        : emphasisView(
            config,
            config.margin.left + emphasisIndex * groupBand,
            groupBand,
            captionTop,
            baseline,
            captionY
          ),
      barsLayer,
      xAxisView(
        data.groups,
        groupLabels,
        config,
        baseline,
        plotWidth,
        emphasisIndex
      )
    )
  );
}
