// @ts-check
import { svg } from '../../lib/html.js';

/** @typedef {'accent' | 'success' | 'warning' | 'danger' | 'info'} GroupedBarChartTone */

/**
 * One mark in a grouped bar chart. Mark keys are unique within their group;
 * the same key in another group occupies the same series slot. Values are
 * finite and non-negative; provisional marks use a hollow bar.
 *
 * @typedef {Object} GroupedBarChartMark
 * @property {string} key
 * @property {string} label
 * @property {number} value
 * @property {boolean} [provisional]
 * @property {GroupedBarChartTone} [tone]
 */

/**
 * One x-axis group. Group keys are unique across the chart.
 *
 * @typedef {Object} GroupedBarChartGroup
 * @property {string} key
 * @property {string} label
 * @property {GroupedBarChartMark[]} marks
 */

/**
 * Normalized chart data. The component does not sort, enrich, or mutate it.
 *
 * @typedef {Object} GroupedBarChartData
 * @property {GroupedBarChartGroup[]} groups
 */

/** @typedef {{ top?: number, right?: number, bottom?: number, left?: number }} GroupedBarChartMargin */

/**
 * Format a numeric value for ticks, labels, and mark names. The mark and group
 * arguments are absent for axis ticks.
 *
 * @typedef {(value: number, mark?: GroupedBarChartMark, group?: GroupedBarChartGroup) => string} GroupedBarChartValueFormatter
 */

/**
 * Format a group label for the x-axis and mark accessible names.
 *
 * @typedef {(label: string, group: GroupedBarChartGroup) => string} GroupedBarChartGroupLabelFormatter
 */

/**
 * Grouped bar chart configuration. Width and height are positive finite CSS
 * pixels. `tickCount` is an integer of at least two and `yMax`, when supplied,
 * must be finite, positive, and at least the largest mark value. Invalid
 * structure or geometry throws `TypeError` or `RangeError`; values are never
 * silently discarded. The chart generates a bounded x-axis label set and a
 * plain visible series key from the first occurrence of each mark key.
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

/** @typedef {{
 *   width: number,
 *   height: number,
 *   ariaLabel: string,
 *   margin: ResolvedMargin,
 *   yMax: number,
 *   tickCount: number,
 *   xAxisLabel?: string,
 *   yAxisLabel?: string,
 *   formatValue: GroupedBarChartValueFormatter,
 *   formatGroupLabel: GroupedBarChartGroupLabelFormatter,
 * }} ResolvedConfig */

const DEFAULT_MARGIN = Object.freeze({
  top: 24,
  right: 16,
  bottom: 48,
  left: 48,
});

const TONE_TOKENS = Object.freeze({
  accent: 'var(--cora-color-accent)',
  success: 'var(--cora-color-success)',
  warning: 'var(--cora-color-warning)',
  danger: 'var(--cora-color-danger)',
  info: 'var(--cora-color-info)',
});

const MAX_VISIBLE_X_TICKS = 12;

/** @typedef {{ key: string, label: string, tone: GroupedBarChartTone }} GroupedBarChartSeries */

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
 * Validate the normalized input before any geometry is calculated.
 *
 * @param {unknown} input
 * @returns {asserts input is GroupedBarChartData}
 */
function validateData(input) {
  const data = requireObject(input, 'data');
  if (!Array.isArray(data.groups)) {
    throw new TypeError('data.groups must be an array');
  }

  const groupKeys = new Set();
  for (const groupInput of data.groups) {
    const group = requireObject(groupInput, 'group');
    requireString(group.key, 'group.key', true);
    requireString(group.label, 'group.label');
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
      requireString(mark.label, 'mark.label');
      if (markKeys.has(mark.key)) {
        throw new TypeError(
          `mark.key values must be unique within group ${group.key}: ${mark.key}`
        );
      }
      markKeys.add(mark.key);
      requireFiniteNumber(mark.value, `mark.value for ${mark.key}`);
      requireNonNegativeNumber(mark.value, `mark.value for ${mark.key}`);
      if (
        mark.provisional !== undefined &&
        typeof mark.provisional !== 'boolean'
      ) {
        throw new TypeError(`mark.provisional must be boolean for ${mark.key}`);
      }
      if (
        mark.tone !== undefined &&
        !Object.prototype.hasOwnProperty.call(TONE_TOKENS, mark.tone)
      ) {
        throw new TypeError(
          `mark.tone must be one of accent, success, warning, danger, info for ${mark.key}`
        );
      }
    }
  }
}

/**
 * @param {unknown} input
 * @returns {ResolvedMargin}
 */
function resolveMargin(input) {
  const margin =
    input === undefined ? {} : requireObject(input, 'config.margin');
  /** @param {'top' | 'right' | 'bottom' | 'left'} side */
  const side = (side) => {
    const value = margin[side];
    if (value === undefined) return DEFAULT_MARGIN[side];
    requireNonNegativeNumber(value, `config.margin.${side}`);
    return value;
  };
  return {
    top: side('top'),
    right: side('right'),
    bottom: side('bottom'),
    left: side('left'),
  };
}

/** @param {number} value @returns {string} */
function defaultFormatValue(value) {
  return String(value);
}

/** @param {string} label @returns {string} */
function defaultFormatGroupLabel(label) {
  return label;
}

/**
 * Keep the first and last group visible while spacing the remaining labels
 * evenly. The bound keeps daily group labels legible without changing the
 * caller's data or the mark accessibility descriptions.
 *
 * @param {number} groupCount
 * @returns {number[]}
 */
function visibleXTickIndexes(groupCount) {
  if (groupCount <= MAX_VISIBLE_X_TICKS) {
    return Array.from({ length: groupCount }, (_, index) => index);
  }

  const indexes = [];
  let previous = -1;
  for (let index = 0; index < MAX_VISIBLE_X_TICKS; index++) {
    const candidate = Math.round(
      (index * (groupCount - 1)) / (MAX_VISIBLE_X_TICKS - 1)
    );
    if (candidate !== previous) indexes.push(candidate);
    previous = candidate;
  }
  return indexes;
}

/**
 * Mark keys define series slots across all groups. The first occurrence also
 * supplies the compact legend's label and tone.
 *
 * @param {GroupedBarChartGroup[]} groups
 * @returns {{ slots: GroupedBarChartSeries[], indexes: Map<string, number> }}
 */
function resolveSeriesSlots(groups) {
  /** @type {GroupedBarChartSeries[]} */
  const slots = [];
  const indexes = new Map();
  for (const group of groups) {
    for (const mark of group.marks) {
      if (indexes.has(mark.key)) continue;
      indexes.set(mark.key, slots.length);
      slots.push({
        key: mark.key,
        label: mark.label,
        tone: mark.tone ?? 'accent',
      });
    }
  }
  return { slots, indexes };
}

/**
 * @param {GroupedBarChartConfig} input
 * @param {number} maxValue
 * @returns {ResolvedConfig}
 */
function resolveConfig(input, maxValue) {
  const config = requireObject(input, 'config');
  requirePositiveNumber(config.width, 'config.width');
  requirePositiveNumber(config.height, 'config.height');
  requireString(config.ariaLabel, 'config.ariaLabel', true);

  const margin = resolveMargin(config.margin);
  const plotWidth = config.width - margin.left - margin.right;
  const plotHeight = config.height - margin.top - margin.bottom;
  if (plotWidth <= 0 || plotHeight <= 0) {
    throw new RangeError('config margins must leave a positive drawable area');
  }

  let yMax;
  if (config.yMax === undefined) {
    yMax = maxValue > 0 ? maxValue : 1;
  } else {
    requirePositiveNumber(config.yMax, 'config.yMax');
    yMax = config.yMax;
    if (yMax < maxValue) {
      throw new RangeError('config.yMax must cover every mark value');
    }
  }

  const tickCount = config.tickCount === undefined ? 5 : config.tickCount;
  if (!Number.isInteger(tickCount) || tickCount < 2) {
    throw new RangeError('config.tickCount must be an integer of at least two');
  }

  if (config.xAxisLabel !== undefined) {
    requireString(config.xAxisLabel, 'config.xAxisLabel');
  }
  if (config.yAxisLabel !== undefined) {
    requireString(config.yAxisLabel, 'config.yAxisLabel');
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

  return {
    width: config.width,
    height: config.height,
    ariaLabel: config.ariaLabel,
    margin,
    yMax,
    tickCount,
    xAxisLabel: config.xAxisLabel,
    yAxisLabel: config.yAxisLabel,
    formatValue: config.formatValue ?? defaultFormatValue,
    formatGroupLabel: config.formatGroupLabel ?? defaultFormatGroupLabel,
  };
}

/**
 * @param {GroupedBarChartValueFormatter} formatter
 * @param {number} value
 * @param {GroupedBarChartMark | undefined} mark
 * @param {GroupedBarChartGroup | undefined} group
 * @returns {string}
 */
function formatValue(formatter, value, mark, group) {
  const result = formatter(value, mark, group);
  if (typeof result !== 'string') {
    throw new TypeError('config.formatValue must return a string');
  }
  return result;
}

/**
 * @param {GroupedBarChartGroupLabelFormatter} formatter
 * @param {GroupedBarChartGroup} group
 * @returns {string}
 */
function formatGroupLabel(formatter, group) {
  const result = formatter(group.label, group);
  if (typeof result !== 'string') {
    throw new TypeError('config.formatGroupLabel must return a string');
  }
  return result;
}

/** @param {number} value @param {number} yMax @param {number} top @param {number} height */
function barY(value, yMax, top, height) {
  if (yMax === 0) return geometry(top + height);
  return geometry(top + height - (value / yMax) * height);
}

/** @param {number} value @param {number} yMax @param {number} height */
function barHeight(value, yMax, height) {
  if (yMax === 0) return 0;
  return geometry((value / yMax) * height);
}

/** @param {number} value @returns {number} */
function geometry(value) {
  return Number(value.toFixed(6));
}

/**
 * Build one accessible bar. The structural mark group is keyed, while the
 * rectangle carries the mark's SVG image semantics and title.
 *
 * @param {GroupedBarChartMark} mark
 * @param {string} groupLabel
 * @param {string} valueLabel
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @returns {SVGElement}
 */
function markView(mark, groupLabel, valueLabel, x, y, width, height) {
  const tone = mark.tone === undefined ? 'accent' : mark.tone;
  const token = TONE_TOKENS[tone];
  const provisional = mark.provisional === true;
  const description = `${groupLabel}: ${mark.label}, ${valueLabel}${provisional ? ', provisional' : ''}`;
  return svg(
    'g',
    { className: 'cora-grouped-bar-chart__mark', key: mark.key },
    svg(
      'rect',
      {
        className: `cora-grouped-bar-chart__bar cora-grouped-bar-chart__bar--${tone}${provisional ? ' cora-grouped-bar-chart__bar--provisional' : ''}`,
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
      },
      svg('title', { key: 'title' }, description)
    ),
    svg(
      'text',
      {
        className: 'cora-grouped-bar-chart__value-label',
        key: 'value-label',
        x: x + width / 2,
        y: Math.max(y - 6, 12),
        'text-anchor': 'middle',
      },
      valueLabel
    )
  );
}

/**
 * Build a pure detached SVG tree for grouped, side-by-side bars.
 *
 * The root uses `role="group"` so its name does not hide the individual mark
 * images from assistive technology. Every mark is independently keyed and
 * named; callers can safely hand a fresh tree to the keyed reconciler.
 *
 * @param {GroupedBarChartProps} props
 * @returns {SVGSVGElement}
 */
export function GroupedBarChart(props) {
  if (props === null || typeof props !== 'object') {
    throw new TypeError('GroupedBarChart expects { data, config }');
  }
  const data = props.data;
  const config = props.config;
  validateData(data);

  let maxValue = 0;
  for (const group of data.groups) {
    for (const mark of group.marks) maxValue = Math.max(maxValue, mark.value);
  }
  const { slots: seriesSlots, indexes: seriesSlotIndexes } = resolveSeriesSlots(
    data.groups
  );
  const resolved = resolveConfig(config, maxValue);
  const { width, height, margin, yMax } = resolved;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const baseline = margin.top + plotHeight;
  const groupBand =
    data.groups.length > 0 ? plotWidth / data.groups.length : plotWidth;
  const seriesCount = seriesSlots.length;
  const groupPadding = seriesCount > 0 ? Math.min(12, groupBand * 0.15) : 0;
  const markGap = seriesCount > 1 ? Math.min(4, groupBand * 0.03) : 0;
  const barWidth =
    seriesCount > 0
      ? (groupBand - groupPadding * 2 - markGap * (seriesCount - 1)) /
        seriesCount
      : 0;
  if (seriesCount > 0 && barWidth <= 0) {
    throw new RangeError('chart geometry leaves no width for a bar');
  }

  const groupLabels = data.groups.map((group) =>
    formatGroupLabel(resolved.formatGroupLabel, group)
  );
  const visibleXIndexes = visibleXTickIndexes(data.groups.length);
  const tickValues = Array.from(
    { length: resolved.tickCount },
    (_, index) => (yMax * index) / (resolved.tickCount - 1)
  );
  const tickLabels = tickValues.map((value) =>
    formatValue(resolved.formatValue, value, undefined, undefined)
  );

  const barsLayer = svg(
    'g',
    { className: 'cora-grouped-bar-chart__bars', key: 'bars' },
    data.groups.map((group, groupIndex) => {
      const groupStart = margin.left + groupIndex * groupBand;
      const markStart = groupStart + groupPadding;
      return svg(
        'g',
        {
          className: 'cora-grouped-bar-chart__group',
          key: group.key,
        },
        group.marks.map((mark) => {
          const valueLabel = formatValue(
            resolved.formatValue,
            mark.value,
            mark,
            group
          );
          const slotIndex = seriesSlotIndexes.get(mark.key);
          if (slotIndex === undefined) return null;
          const x = markStart + slotIndex * (barWidth + markGap);
          const y = barY(mark.value, yMax, margin.top, plotHeight);
          const markHeight = barHeight(mark.value, yMax, plotHeight);
          return markView(
            mark,
            groupLabels[groupIndex],
            valueLabel,
            x,
            y,
            barWidth,
            markHeight
          );
        })
      );
    })
  );

  const groupLabelsLayer = svg(
    'g',
    { className: 'cora-grouped-bar-chart__group-labels', key: 'group-labels' },
    visibleXIndexes.map((groupIndex) =>
      svg(
        'text',
        {
          className: 'cora-grouped-bar-chart__group-label',
          key: data.groups[groupIndex].key,
          x: margin.left + groupIndex * groupBand + groupBand / 2,
          y: baseline + 20,
          'text-anchor': 'middle',
        },
        groupLabels[groupIndex]
      )
    )
  );

  const xAxis = svg(
    'g',
    { className: 'cora-grouped-bar-chart__x-axis', key: 'x-axis' },
    svg('line', {
      className: 'cora-grouped-bar-chart__axis-line',
      key: 'line',
      x1: margin.left,
      y1: baseline,
      x2: width - margin.right,
      y2: baseline,
      stroke: 'var(--cora-color-border-strong)',
    }),
    visibleXIndexes.map((groupIndex) =>
      svg(
        'g',
        {
          className: 'cora-grouped-bar-chart__x-tick',
          key: data.groups[groupIndex].key,
        },
        svg('line', {
          className: 'cora-grouped-bar-chart__tick-line',
          key: 'line',
          x1: margin.left + groupIndex * groupBand + groupBand / 2,
          y1: baseline,
          x2: margin.left + groupIndex * groupBand + groupBand / 2,
          y2: baseline + 5,
          stroke: 'var(--cora-color-border-strong)',
        })
      )
    ),
    resolved.xAxisLabel === undefined
      ? null
      : svg(
          'text',
          {
            className: 'cora-grouped-bar-chart__x-axis-label',
            key: 'label',
            x: margin.left + plotWidth / 2,
            y: height - 6,
            'text-anchor': 'middle',
          },
          resolved.xAxisLabel
        )
  );

  const yAxis = svg(
    'g',
    { className: 'cora-grouped-bar-chart__y-axis', key: 'y-axis' },
    svg('line', {
      className: 'cora-grouped-bar-chart__axis-line',
      key: 'line',
      x1: margin.left,
      y1: margin.top,
      x2: margin.left,
      y2: baseline,
      stroke: 'var(--cora-color-border-strong)',
    }),
    tickValues.map((value, index) => {
      const y = barY(value, yMax, margin.top, plotHeight);
      return svg(
        'g',
        { className: 'cora-grouped-bar-chart__y-tick', key: `tick-${index}` },
        svg('line', {
          className: 'cora-grouped-bar-chart__tick-line',
          key: 'line',
          x1: margin.left - 5,
          y1: y,
          x2: margin.left,
          y2: y,
          stroke: 'var(--cora-color-border-strong)',
        }),
        svg(
          'text',
          {
            className: 'cora-grouped-bar-chart__tick-label',
            key: 'label',
            x: margin.left - 8,
            y: y + 4,
            'text-anchor': 'end',
          },
          tickLabels[index]
        )
      );
    }),
    resolved.yAxisLabel === undefined
      ? null
      : svg(
          'text',
          {
            className: 'cora-grouped-bar-chart__y-axis-label',
            key: 'label',
            x: 14,
            y: margin.top + plotHeight / 2,
            transform: `rotate(-90 14 ${margin.top + plotHeight / 2})`,
            'text-anchor': 'middle',
          },
          resolved.yAxisLabel
        )
  );

  const legend =
    seriesSlots.length === 0
      ? null
      : svg(
          'g',
          {
            className: 'cora-grouped-bar-chart__legend',
            key: 'legend',
            role: 'group',
            'aria-label': 'Chart series',
          },
          seriesSlots.map((series, seriesIndex) => {
            const itemWidth = plotWidth / seriesSlots.length;
            const x = margin.left + seriesIndex * itemWidth;
            const token = TONE_TOKENS[series.tone];
            const swatchY = Math.max(2, margin.top - 16);
            return svg(
              'g',
              {
                className: 'cora-grouped-bar-chart__legend-item',
                key: series.key,
              },
              svg('rect', {
                className: 'cora-grouped-bar-chart__legend-swatch',
                key: 'swatch',
                x,
                y: swatchY,
                width: 10,
                height: 10,
                fill: token,
                stroke: token,
              }),
              svg(
                'text',
                {
                  className: 'cora-grouped-bar-chart__legend-label',
                  key: 'label',
                  x: x + 14,
                  y: swatchY + 9,
                },
                series.label
              )
            );
          })
        );

  return /** @type {SVGSVGElement} */ (
    svg(
      'svg',
      {
        className: 'cora-grouped-bar-chart',
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        role: 'group',
        'aria-label': resolved.ariaLabel,
      },
      legend,
      svg(
        'g',
        { className: 'cora-grouped-bar-chart__plot', key: 'plot' },
        barsLayer,
        groupLabelsLayer,
        xAxis,
        yAxis
      )
    )
  );
}
