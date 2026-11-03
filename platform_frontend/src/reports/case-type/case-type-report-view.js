// @ts-check
import { formatWeekdayDate } from '../../lib/format-datetime.js';
import {
  formatCount,
  formatPercent,
} from '../../components/charts/chart-kit.js';
import { BarList } from '../../components/charts/bar-list.js';
import { LineChart } from '../../components/charts/line-chart.js';
import { StackBar } from '../../components/charts/stack-bar.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';
import { RANGES } from './case-type-report-model.js';

/** @typedef {import('./case-type-report-model.js').CaseTypeReportModel} CaseTypeReportModel */
/** @typedef {import('./case-type-report-model.js').Change} Change */
/** @typedef {import('../contract.js').ReportContent} ReportContent */
/** @typedef {import('../contract.js').ReportPanelSpec} ReportPanelSpec */
/** @typedef {import('../contract.js').StatTileSpec} StatTileSpec */
/** @typedef {import('../../components/charts/chart-kit.js').ChartRole} ChartRole */

/**
 * The Case Type report's page: which figures, which panels, in which order,
 * and in what words. Each panel is one small function, so the page reads as a
 * list and a panel can be moved, dropped or added without touching another.
 */

const MONTH_NAMES = Object.freeze([
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]);

/** @param {string} month `YYYY-MM` @returns {string} "Sep" */
function shortMonth(month) {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1].slice(0, 3);
}

/** @param {string} month `YYYY-MM` @returns {string} "September 2026" */
function longMonth(month) {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** @param {string} dateKey @returns {string} "6 Oct" */
function shortDay(dateKey) {
  return formatWeekdayDate(dateKey).split(' ').slice(1).join(' ');
}

/**
 * How a figure moved over 30 days, worded for a tile. A rise in work waiting
 * is bad news and a fall is good, so the tone follows that rather than the
 * arrow.
 *
 * @param {Change} change
 * @returns {StatTileSpec['delta']}
 */
function backlogDelta(change) {
  if (change.before === null) return undefined;
  const difference = change.now - change.before;
  return {
    text: `${formatCount(Math.abs(difference))} vs 30 days ago`,
    direction: difference > 0 ? 'up' : difference < 0 ? 'down' : 'flat',
    tone: difference > 0 ? 'bad' : difference < 0 ? 'good' : 'neutral',
  };
}

/**
 * @param {CaseTypeReportModel} model
 * @returns {StatTileSpec[]}
 */
function kpis(model) {
  /** @type {StatTileSpec[]} */
  const tiles = [];
  if (model.open) {
    tiles.push({
      key: 'open',
      label: 'Open',
      value: formatCount(model.open.now),
      delta: backlogDelta(model.open),
      trend: model.openTrend ?? undefined,
    });
  }
  if (model.toAllocate) {
    tiles.push({
      key: 'to-allocate',
      label: 'To allocate',
      value: formatCount(model.toAllocate.now),
      delta: backlogDelta(model.toAllocate),
    });
  }
  if (model.overdue !== null) {
    tiles.push({
      key: 'overdue',
      label: 'Overdue',
      value: formatCount(model.overdue),
      status: model.overdue > 0 ? 'danger' : undefined,
    });
  }
  const latestSla = model.sla?.[model.sla.length - 1];
  if (latestSla) {
    tiles.push({
      key: 'sla',
      label: `Review SLA on time · ${shortMonth(latestSla.month)}`,
      value: (latestSla.share * 100).toFixed(1),
      unit: '%',
      meter:
        model.slaTarget === null
          ? undefined
          : {
              value: latestSla.share,
              target: model.slaTarget,
              label: 'a target',
            },
    });
  }
  return tiles;
}

/** @type {Readonly<Record<string, { label: string, role: ChartRole, marker?: string }>>} */
const DUE_BUCKETS = Object.freeze({
  overdue_8_plus: { label: 'Overdue 8+ days', role: 'danger', marker: '●' },
  overdue_1_7: { label: 'Overdue 1–7 days', role: 'danger', marker: '●' },
  due_today: { label: 'Due today', role: 'warning', marker: '▲' },
  due_1_7: { label: 'Due in 1–7 days', role: 'quiet' },
  due_8_plus: { label: 'Due in 8+ days', role: 'quiet' },
  no_due_date: { label: 'No due date', role: 'quiet' },
});

/**
 * @param {NonNullable<CaseTypeReportModel['due']>} due
 * @returns {ReportPanelSpec}
 */
function duePanel(due) {
  const rows = due.map((row) => {
    const bucket = DUE_BUCKETS[row.bucket] ?? {
      label: row.bucket,
      role: /** @type {ChartRole} */ ('quiet'),
    };
    return { ...row, ...bucket };
  });
  return {
    id: 'due',
    title: 'Open Cases by due date',
    subtitle:
      'Calendar days to the review due date. A Case on hold stays in its bucket.',
    span: 7,
    chips: ['Snapshot'],
    render: (width) =>
      BarList(
        {
          rows: rows.map((row) => ({
            key: row.bucket,
            label: row.label,
            value: row.count,
            role: row.role,
            marker: row.marker,
            detail:
              row.onHold > 0
                ? [`${formatCount(row.onHold)} on hold`]
                : undefined,
          })),
        },
        {
          width,
          ariaLabel: 'Open Cases by days to their review due date',
          unit: 'Cases',
        }
      ),
    table: {
      columns: [
        { key: 'label', label: 'Due', value: 'label', sortable: false },
        { key: 'count', label: 'Cases', value: 'count' },
        { key: 'onHold', label: 'On hold', value: 'onHold' },
      ],
      rows,
      rowKey: (row) => row.bucket,
    },
  };
}

/** @type {readonly { key: 'toAllocate' | 'inProgress' | 'actionsInProgress', label: string, role: ChartRole }[]} */
const STATUSES = Object.freeze([
  { key: 'toAllocate', label: 'To allocate', role: 's3' },
  { key: 'inProgress', label: 'In progress', role: 's1' },
  { key: 'actionsInProgress', label: 'Actions in progress', role: 's2' },
]);

/**
 * @param {NonNullable<CaseTypeReportModel['latest']>} latest
 * @returns {ReportPanelSpec}
 */
function statusPanel(latest) {
  const rows = STATUSES.map((status) => ({
    ...status,
    value: latest[status.key],
  }));
  return {
    id: 'status',
    title: 'Where open Cases are',
    subtitle: 'Open Cases by status.',
    span: 5,
    chips: ['Snapshot'],
    legend: STATUSES.map(({ label, role }) => ({ label, role })),
    render: (width) =>
      StackBar(
        {
          parts: rows.map(({ key, label, value, role }) => ({
            key,
            label,
            value,
            role,
          })),
        },
        {
          width,
          ariaLabel: 'Open Cases by status',
          wholeLabel: 'of open Cases',
        }
      ),
    table: {
      columns: [
        { key: 'label', label: 'Status', value: 'label', sortable: false },
        { key: 'value', label: 'Cases', value: 'value' },
        {
          key: 'share',
          label: 'Share',
          value: (row) => (latest.open > 0 ? row.value / latest.open : 0),
          format: (value) => formatPercent(Number(value)),
        },
      ],
      rows,
      rowKey: (row) => row.key,
    },
  };
}

/**
 * @param {NonNullable<CaseTypeReportModel['backlog']>} backlog
 * @returns {ReportPanelSpec}
 */
function backlogPanel(backlog) {
  return {
    id: 'backlog',
    title: 'Open Cases at close of day',
    subtitle:
      'Every Case not yet Completed or Void, counted at the end of each day.',
    note: 'Counted from hourly polls, so a Case opened and closed within the same hour is never seen.',
    render: (width) =>
      LineChart(
        {
          series: [
            {
              key: 'open',
              label: 'Open',
              role: 's1',
              points: backlog.map((day) => ({ x: day.date, y: day.open })),
            },
          ],
        },
        {
          width,
          height: 220,
          area: true,
          formatX: shortDay,
          describeX: formatWeekdayDate,
          ariaLabel: `Open Cases at close of day, ${formatCount(backlog[0].open)} on ${formatWeekdayDate(backlog[0].date)} and ${formatCount(backlog[backlog.length - 1].open)} on ${formatWeekdayDate(backlog[backlog.length - 1].date)}`,
        }
      ),
    table: {
      columns: [
        {
          key: 'date',
          label: 'Date',
          value: 'date',
          format: (value) => formatWeekdayDate(value),
        },
        { key: 'toAllocate', label: 'To allocate', value: 'toAllocate' },
        { key: 'inProgress', label: 'In progress', value: 'inProgress' },
        {
          key: 'actionsInProgress',
          label: 'Actions in progress',
          value: 'actionsInProgress',
        },
        { key: 'open', label: 'Open', value: 'open' },
      ],
      rows: [...backlog].reverse(),
      rowKey: (row) => row.date,
    },
  };
}

/**
 * @param {NonNullable<CaseTypeReportModel['flow']>} flow
 * @returns {ReportPanelSpec}
 */
function flowPanel(flow) {
  return {
    id: 'flow',
    title: 'Arrived and completed, per week',
    subtitle: 'Weeks ending on the date shown.',
    span: 6,
    legend: [
      { label: 'Arrived', role: 's1', shape: 'line' },
      { label: CASE_STATUS.COMPLETED, role: 's2', shape: 'line' },
    ],
    render: (width) =>
      LineChart(
        {
          series: [
            {
              key: 'arrived',
              label: 'Arrived',
              role: 's1',
              points: flow.map((w) => ({ x: w.weekEnding, y: w.arrived })),
            },
            {
              key: 'completed',
              label: CASE_STATUS.COMPLETED,
              role: 's2',
              points: flow.map((w) => ({ x: w.weekEnding, y: w.completed })),
            },
          ],
        },
        {
          width,
          formatX: shortDay,
          describeX: (x) => `Week ending ${formatWeekdayDate(x)}`,
          ariaLabel: 'Cases arrived and completed per week',
        }
      ),
    table: {
      columns: [
        {
          key: 'weekEnding',
          label: 'Week ending',
          value: 'weekEnding',
          format: (value) => formatWeekdayDate(value),
        },
        { key: 'arrived', label: 'Arrived', value: 'arrived' },
        { key: 'completed', label: CASE_STATUS.COMPLETED, value: 'completed' },
      ],
      rows: [...flow].reverse(),
      rowKey: (row) => row.weekEnding,
    },
  };
}

/**
 * @param {NonNullable<CaseTypeReportModel['sla']>} sla
 * @param {number | null} target
 * @returns {ReportPanelSpec}
 */
function slaPanel(sla, target) {
  // A line may zoom in where a bar may not; the floor sits a little under the
  // lowest month so the movement is visible, and the axis labels say so.
  const lowest = Math.min(...sla.map((month) => month.share), target ?? 1);
  const floor = Math.max(
    0,
    Math.min(0.6, Math.floor((lowest - 0.05) * 10) / 10)
  );
  return {
    id: 'sla',
    title: 'Review SLA: completed on time',
    subtitle:
      'Share of Cases completed by their review due date, by month completed.',
    span: 6,
    render: (width) =>
      LineChart(
        {
          series: [
            {
              key: 'sla',
              label: 'On time',
              role: 's1',
              points: sla.map((m) => ({ x: m.month, y: m.share })),
            },
          ],
        },
        {
          width,
          dots: sla.length <= 6,
          formatX: shortMonth,
          describeX: longMonth,
          formatY: (v) => formatPercent(v),
          yDomain: [floor, 1],
          target:
            target === null
              ? undefined
              : { value: target, label: `Target ${formatPercent(target)}` },
          ariaLabel: `Review SLA attainment by month, ${formatPercent(sla[sla.length - 1].share, 1)} in ${longMonth(sla[sla.length - 1].month)}`,
        }
      ),
    table: {
      columns: [
        {
          key: 'month',
          label: 'Month',
          value: 'month',
          format: (value) => longMonth(String(value)),
        },
        { key: 'completed', label: CASE_STATUS.COMPLETED, value: 'completed' },
        { key: 'onTime', label: 'On time', value: 'onTime' },
        { key: 'late', label: 'Late', value: 'late' },
        {
          key: 'share',
          label: 'On time %',
          value: 'share',
          format: (value) => formatPercent(Number(value), 1),
        },
      ],
      rows: [...sla].reverse(),
      rowKey: (row) => row.month,
    },
  };
}

/**
 * @template T
 * @param {(T | null | false)[]} items
 * @returns {T[]}
 */
function present(items) {
  return /** @type {T[]} */ (items.filter(Boolean));
}

/**
 * The page.
 *
 * @param {CaseTypeReportModel} model
 * @returns {ReportContent}
 */
export function caseTypeReportContent(model) {
  const range = RANGES[model.range];
  return {
    kpis: kpis(model),
    now: present([
      model.due ? duePanel(model.due) : null,
      model.latest ? statusPanel(model.latest) : null,
    ]),
    sections: [
      {
        id: 'over-time',
        title: 'Over time',
        scope: model.completeThrough
          ? `${range.label} to ${formatWeekdayDate(model.completeThrough)}`
          : range.label,
        filters: ['range'],
        panels: present([
          model.backlog && model.backlog.length >= 2
            ? backlogPanel(model.backlog)
            : null,
          model.flow ? flowPanel(model.flow) : null,
          // One month is not a trend; the headline tile already states it.
          model.sla && model.sla.length >= 2
            ? slaPanel(model.sla, model.slaTarget)
            : null,
        ]),
      },
    ],
  };
}
