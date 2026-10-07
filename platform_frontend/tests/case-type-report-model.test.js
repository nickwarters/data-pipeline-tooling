// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RANGES,
  buildCaseTypeReport,
} from '../src/reports/case-type/case-type-report-model.js';
import { shiftDateKey } from '../src/lib/local-calendar.js';

const LAST_DAY = '2026-10-06';

/**
 * @param {Record<string, any>} datasets
 * @param {Partial<import('../src/reports/contract.js').ReportEnvelope>} [rest]
 * @returns {import('../src/reports/contract.js').ReportEnvelope}
 */
function envelope(datasets, rest = {}) {
  return {
    schema_version: 1,
    complete_through: LAST_DAY,
    datasets,
    ...rest,
  };
}

/**
 * One backlog row per day, the last one on `lastDay`.
 *
 * @param {number} days
 * @param {(index: number) => Record<string, number>} [counts] by day index, oldest first
 * @param {string} [lastDay]
 * @returns {Record<string, any>[]}
 */
function backlogRows(days, counts = () => ({}), lastDay = LAST_DAY) {
  return Array.from({ length: days }, (_, index) => ({
    date: shiftDateKey(lastDay, index - (days - 1)),
    to_allocate: 0,
    in_progress: 0,
    actions_in_progress: 0,
    ...counts(index),
  }));
}

/**
 * @param {number} days
 * @param {(index: number) => Record<string, number>} counts
 * @returns {Record<string, any>[]}
 */
function flowRows(days, counts) {
  return Array.from({ length: days }, (_, index) => ({
    date: shiftDateKey(LAST_DAY, index - (days - 1)),
    ...counts(index),
  }));
}

/** @param {number} months @returns {Record<string, any>[]} */
function slaRows(months) {
  return Array.from({ length: months }, (_, index) => ({
    month: `${2024 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`,
    case_count: 10,
    on_time_count: 8,
    late_count: 2,
  }));
}

test('each range reports the window of days, weeks and months it names', () => {
  const full = envelope({
    backlog_daily: backlogRows(400),
    flow_daily: flowRows(400, () => ({ arrived: 1, completed: 1 })),
    sla_monthly: slaRows(24),
  });
  for (const [key, window] of Object.entries(RANGES)) {
    const report = buildCaseTypeReport(full, key);
    assert.equal(report.range, key);
    assert.equal(report.backlog?.length, window.days, key);
    assert.equal(report.flow?.length, window.weeks, key);
    assert.equal(report.sla?.length, window.months, key);
    assert.equal(report.backlog?.at(-1)?.date, LAST_DAY, key);
    assert.equal(report.flow?.at(-1)?.weekEnding, LAST_DAY, key);
    assert.equal(report.sla?.at(-1)?.month, '2025-12', key);
  }
});

test('a longer range reaches further back than a shorter one', () => {
  const full = envelope({
    backlog_daily: backlogRows(400),
    flow_daily: flowRows(400, () => ({ arrived: 1, completed: 1 })),
    sla_monthly: slaRows(24),
  });
  const keys = Object.entries(RANGES)
    .sort(([, a], [, b]) => a.days - b.days)
    .map(([key]) => key);
  for (let i = 1; i < keys.length; i++) {
    const shorter = buildCaseTypeReport(full, keys[i - 1]);
    const longer = buildCaseTypeReport(full, keys[i]);
    assert.ok(
      (longer.backlog?.[0].date ?? '') < (shorter.backlog?.[0].date ?? ''),
      `${keys[i]} starts before ${keys[i - 1]}`
    );
  }
});

test('a feed shorter than the range reports everything it has', () => {
  const report = buildCaseTypeReport(
    envelope({
      backlog_daily: backlogRows(10),
      sla_monthly: slaRows(2),
    }),
    '12m'
  );
  assert.equal(report.backlog?.length, 10);
  assert.equal(report.sla?.length, 2);
});

test('an unknown range is read as six months', () => {
  const full = envelope({ backlog_daily: backlogRows(400) });
  const unknown = buildCaseTypeReport(full, 'fortnight');
  assert.equal(unknown.range, '6m');
  assert.deepEqual(unknown, buildCaseTypeReport(full, '6m'));
});

test('a feed carrying no datasets has no figures', () => {
  const report = buildCaseTypeReport(envelope({}), '6m');
  assert.deepEqual(report, {
    range: '6m',
    completeThrough: LAST_DAY,
    open: null,
    openTrend: null,
    toAllocate: null,
    overdue: null,
    due: null,
    latest: null,
    backlog: null,
    flow: null,
    sla: null,
    slaTarget: null,
  });
});

test('datasets that are empty or not tables read as absent', () => {
  const report = buildCaseTypeReport(
    envelope({
      backlog_daily: [],
      flow_daily: { not: 'a table' },
      due_profile: [],
      sla_monthly: null,
      targets: null,
    }),
    '6m'
  );
  assert.equal(report.open, null);
  assert.equal(report.backlog, null);
  assert.equal(report.flow, null);
  assert.equal(report.due, null);
  assert.equal(report.overdue, null);
  assert.equal(report.sla, null);
  assert.equal(report.slaTarget, null);
});

test('the latest day is the last day when the feed names none', () => {
  const rows = backlogRows(5, () => ({}), '2026-09-20');
  const report = buildCaseTypeReport(
    envelope({ backlog_daily: rows }, { complete_through: undefined }),
    '6m'
  );
  assert.equal(report.completeThrough, '2026-09-20');
});

test('the feed names its own last day when it can', () => {
  const rows = backlogRows(5, () => ({}), '2026-09-20');
  const report = buildCaseTypeReport(envelope({ backlog_daily: rows }), '6m');
  assert.equal(report.completeThrough, LAST_DAY);
});

test('a feed with neither a last day nor a backlog has no last day', () => {
  const report = buildCaseTypeReport(
    envelope(
      { flow_daily: [{ date: LAST_DAY, arrived: 3, completed: 2 }] },
      { complete_through: undefined }
    ),
    '6m'
  );
  assert.equal(report.completeThrough, null);
  assert.equal(report.flow, null, 'weeks need a day to end on');
});

test('backlog days are put in date order whatever order the feed lists them', () => {
  const rows = backlogRows(4, (i) => ({ in_progress: i + 1 }));
  const report = buildCaseTypeReport(
    envelope({ backlog_daily: [rows[2], rows[0], rows[3], rows[1]] }),
    '6m'
  );
  assert.deepEqual(
    report.backlog?.map((day) => day.date),
    rows.map((row) => row.date)
  );
  assert.equal(report.latest?.date, LAST_DAY);
  assert.equal(report.latest?.inProgress, 4);
});

test('a backlog count that is not a number reads as zero', () => {
  const report = buildCaseTypeReport(
    envelope({
      backlog_daily: [
        {
          date: LAST_DAY,
          to_allocate: '5',
          in_progress: Number.NaN,
          actions_in_progress: null,
        },
      ],
    }),
    '6m'
  );
  assert.deepEqual(report.latest, {
    date: LAST_DAY,
    toAllocate: 0,
    inProgress: 0,
    actionsInProgress: 0,
    open: 0,
  });
});

test('open is the three working statuses added together', () => {
  const report = buildCaseTypeReport(
    envelope({
      backlog_daily: [
        {
          date: LAST_DAY,
          to_allocate: 2,
          in_progress: 30,
          actions_in_progress: 400,
        },
      ],
    }),
    '6m'
  );
  assert.equal(report.latest?.open, 432);
  assert.equal(report.open?.now, 432);
  assert.equal(report.toAllocate?.now, 2);
});

test('a backlog row without a date is left out', () => {
  const report = buildCaseTypeReport(
    envelope({
      backlog_daily: [
        null,
        { to_allocate: 9 },
        { date: LAST_DAY, to_allocate: 1 },
      ],
    }),
    '6m'
  );
  assert.equal(report.backlog?.length, 1);
  assert.equal(report.latest?.toAllocate, 1);
});

test('open and to-allocate are compared with exactly 30 days earlier', () => {
  const report = buildCaseTypeReport(
    envelope({
      backlog_daily: backlogRows(60, (i) => ({
        to_allocate: i,
        in_progress: 2 * i,
      })),
    }),
    '6m'
  );
  // Index 59 is the latest day; 30 days before it is index 29.
  assert.deepEqual(report.toAllocate, { now: 59, before: 29 });
  assert.deepEqual(report.open, { now: 59 * 3, before: 29 * 3 });
});

test('the 30-day comparison is empty when the feed does not reach back that far', () => {
  const report = buildCaseTypeReport(
    envelope({ backlog_daily: backlogRows(30, () => ({ to_allocate: 4 })) }),
    '6m'
  );
  assert.deepEqual(report.toAllocate, { now: 4, before: null });
  assert.deepEqual(report.open, { now: 4, before: null });
});

test('the 30-day comparison is empty when that exact day has no row', () => {
  const rows = backlogRows(60, () => ({ to_allocate: 4 })).filter(
    (row) => row.date !== shiftDateKey(LAST_DAY, -30)
  );
  const report = buildCaseTypeReport(envelope({ backlog_daily: rows }), '6m');
  assert.equal(report.open?.before, null);
});

test('the open trend samples once a week, ending on the latest day', () => {
  const report = buildCaseTypeReport(
    envelope({
      backlog_daily: backlogRows(200, (i) => ({ in_progress: i })),
    }),
    '6m'
  );
  const trend = report.openTrend ?? [];
  assert.equal(trend.at(-1), 199);
  for (let i = 1; i < trend.length; i++) {
    assert.equal(trend[i] - trend[i - 1], 7, 'one sample per week');
  }
});

test('the open trend covers the last thirteen weeks and no further', () => {
  const report = buildCaseTypeReport(
    envelope({ backlog_daily: backlogRows(400, (i) => ({ in_progress: i })) }),
    '12m'
  );
  // Thirteen weeks back, plus the latest day itself.
  assert.equal(report.openTrend?.length, 14);
});

test('the open trend needs two samples to show a direction', () => {
  const week = buildCaseTypeReport(
    envelope({ backlog_daily: backlogRows(7) }),
    '6m'
  );
  assert.equal(week.openTrend, null);
  const eightDays = buildCaseTypeReport(
    envelope({ backlog_daily: backlogRows(8, (i) => ({ in_progress: i })) }),
    '6m'
  );
  assert.deepEqual(eightDays.openTrend, [0, 7]);
});

test('overdue adds the two overdue buckets and nothing else', () => {
  const report = buildCaseTypeReport(
    envelope({
      due_profile: [
        { bucket: 'overdue_8_plus', order: 1, count: 6, on_hold: 1 },
        { bucket: 'overdue_1_7', order: 2, count: 17, on_hold: 3 },
        { bucket: 'due_today', order: 3, count: 100 },
        { bucket: 'due_1_7', order: 4, count: 1000 },
        { bucket: 'no_due_date', order: 5, count: 10000 },
      ],
    }),
    '6m'
  );
  assert.equal(report.overdue, 23);
});

test('nothing overdue is a real zero, not an absent figure', () => {
  const report = buildCaseTypeReport(
    envelope({ due_profile: [{ bucket: 'due_1_7', order: 1, count: 5 }] }),
    '6m'
  );
  assert.equal(report.overdue, 0);
});

test('due buckets are listed in the order the feed gives them', () => {
  const report = buildCaseTypeReport(
    envelope({
      due_profile: [
        { bucket: 'c', order: 3, count: 3 },
        { bucket: 'a', order: 1, count: 1, on_hold: 2 },
        { bucket: 'b', order: 2, count: 2 },
      ],
    }),
    '6m'
  );
  assert.deepEqual(report.due, [
    { bucket: 'a', count: 1, onHold: 2 },
    { bucket: 'b', count: 2, onHold: 0 },
    { bucket: 'c', count: 3, onHold: 0 },
  ]);
});

test('a due row with no bucket name is left out, and a missing count reads as zero', () => {
  const report = buildCaseTypeReport(
    envelope({
      due_profile: [null, { order: 1, count: 4 }, { bucket: 'due_today' }],
    }),
    '6m'
  );
  assert.deepEqual(report.due, [{ bucket: 'due_today', count: 0, onHold: 0 }]);
});

test('flow adds up seven-day weeks that end on the last day', () => {
  const report = buildCaseTypeReport(
    envelope({
      flow_daily: [
        { date: '2026-10-06', arrived: 2, completed: 1 },
        { date: '2026-09-30', arrived: 5, completed: 4 },
        { date: '2026-09-29', arrived: 100, completed: 50 },
      ],
    }),
    '3m'
  );
  const flow = report.flow ?? [];
  assert.equal(flow.at(-1)?.weekEnding, '2026-10-06');
  assert.deepEqual(flow.at(-1), {
    weekEnding: '2026-10-06',
    arrived: 7,
    completed: 5,
  });
  // 29 September is the seventh day of the week before.
  assert.deepEqual(flow.at(-2), {
    weekEnding: '2026-09-29',
    arrived: 100,
    completed: 50,
  });
});

test('weeks are listed oldest first, seven days apart', () => {
  const report = buildCaseTypeReport(
    envelope({ flow_daily: [{ date: LAST_DAY, arrived: 1, completed: 1 }] }),
    '3m'
  );
  const ends = (report.flow ?? []).map((week) => week.weekEnding);
  assert.equal(ends.length, RANGES['3m'].weeks);
  for (let i = 1; i < ends.length; i++) {
    assert.equal(shiftDateKey(ends[i - 1], 7), ends[i]);
  }
});

test('a day with no flow row counts as zero', () => {
  const report = buildCaseTypeReport(
    envelope({ flow_daily: [{ date: LAST_DAY, arrived: 3, completed: 2 }] }),
    '3m'
  );
  const flow = report.flow ?? [];
  assert.deepEqual(flow.at(-1), {
    weekEnding: LAST_DAY,
    arrived: 3,
    completed: 2,
  });
  for (const week of flow.slice(0, -1)) {
    assert.equal(week.arrived, 0);
    assert.equal(week.completed, 0);
  }
});

test('flow rows without a date are ignored and bad counts read as zero', () => {
  const report = buildCaseTypeReport(
    envelope({
      flow_daily: [
        null,
        { arrived: 99, completed: 99 },
        { date: LAST_DAY, arrived: 'many', completed: 4 },
      ],
    }),
    '3m'
  );
  assert.deepEqual(report.flow?.at(-1), {
    weekEnding: LAST_DAY,
    arrived: 0,
    completed: 4,
  });
});

test('flow ends on the latest backlog day when the feed names no last day', () => {
  const report = buildCaseTypeReport(
    envelope(
      {
        backlog_daily: backlogRows(3, () => ({}), '2026-09-20'),
        flow_daily: [{ date: '2026-09-20', arrived: 6, completed: 5 }],
      },
      { complete_through: undefined }
    ),
    '3m'
  );
  assert.equal(report.flow?.at(-1)?.weekEnding, '2026-09-20');
  assert.equal(report.flow?.at(-1)?.arrived, 6);
});

test('the SLA share is on time over the Cases that had a due date', () => {
  const report = buildCaseTypeReport(
    envelope({
      sla_monthly: [
        {
          month: '2026-09',
          case_count: 100,
          on_time_count: 30,
          late_count: 10,
          no_due_date_count: 60,
        },
      ],
    }),
    '6m'
  );
  assert.deepEqual(report.sla, [
    { month: '2026-09', completed: 100, onTime: 30, late: 10, share: 0.75 },
  ]);
});

test('a month with nothing judged is dropped from the SLA', () => {
  const report = buildCaseTypeReport(
    envelope({
      sla_monthly: [
        { month: '2026-07', case_count: 4, on_time_count: 0, late_count: 0 },
        { month: '2026-08', case_count: 4, on_time_count: 2, late_count: 2 },
        { case_count: 4, on_time_count: 4, late_count: 0 },
      ],
    }),
    '6m'
  );
  assert.deepEqual(
    report.sla?.map((month) => month.month),
    ['2026-08']
  );
});

test('a feed whose months all have nothing judged has no SLA', () => {
  const report = buildCaseTypeReport(
    envelope({
      sla_monthly: [
        { month: '2026-08', case_count: 4, on_time_count: 0, late_count: 0 },
      ],
    }),
    '6m'
  );
  assert.equal(report.sla, null);
});

test('SLA months are put in order whatever order the feed lists them', () => {
  const rows = slaRows(5);
  const report = buildCaseTypeReport(
    envelope({
      sla_monthly: [rows[3], rows[0], rows[4], rows[2], rows[1]],
    }),
    '12m'
  );
  assert.deepEqual(
    report.sla?.map((month) => month.month),
    rows.map((row) => row.month)
  );
});

test('the SLA target is carried when it is a finite number', () => {
  for (const target of [0.9, 0]) {
    const report = buildCaseTypeReport(
      envelope({ targets: { review_on_time: target } }),
      '6m'
    );
    assert.equal(report.slaTarget, target);
  }
});

test('a target that is not a finite number is no target', () => {
  for (const target of ['0.9', Number.NaN, Infinity, null, undefined]) {
    const report = buildCaseTypeReport(
      envelope({ targets: { review_on_time: target } }),
      '6m'
    );
    assert.equal(report.slaTarget, null, String(target));
  }
});

test('a feed without targets has no SLA target', () => {
  assert.equal(buildCaseTypeReport(envelope({}), '6m').slaTarget, null);
  assert.equal(
    buildCaseTypeReport(envelope({ targets: {} }), '6m').slaTarget,
    null
  );
});
