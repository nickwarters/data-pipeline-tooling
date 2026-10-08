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
 * @param {number} days
 * @param {(index: number) => Record<string, number>} [counts]
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
    legs: null,
    outcomes: null,
    remediation: null,
    posting: null,
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

/**
 * @param {string} window
 * @param {string} leg
 * @param {number} p50
 * @param {number} p90
 * @param {number} [n]
 */
function legRow(window, leg, p50, p90, n = 10) {
  return { window, leg, p50, p90, n };
}

/** @param {string[]} outcomes */
function outcomeOrder(outcomes) {
  return outcomes.map((outcome) => ({ outcome, label: outcome.toUpperCase() }));
}

/**
 * @param {string} month
 * @param {string} outcome
 * @param {number} count
 */
function outcomeRow(month, outcome, count) {
  return { month, outcome, count };
}

/** @param {number} index @param {number} [share] */
function questionRow(index, share = index / 100) {
  return {
    question_id: `q${index}`,
    label: `Question ${index}`,
    case_count: index * 10,
    share_of_cases: share,
  };
}

test('a figure whose dataset is missing or empty is absent', () => {
  const figures = ['legs', 'outcomes', 'remediation', 'posting'];
  const absent = [
    envelope({}),
    envelope({
      lifecycle_window: [],
      outcome_order: [],
      outcome_monthly: [],
      remediation_questions: [],
      posting_pattern: [],
    }),
    envelope({
      lifecycle_window: { not: 'a table' },
      outcome_order: null,
      outcome_monthly: 'nothing',
      remediation_questions: null,
      posting_pattern: {},
    }),
  ];
  for (const feed of absent) {
    const report = /** @type {Record<string, unknown>} */ (
      /** @type {unknown} */ (buildCaseTypeReport(feed, '6m'))
    );
    for (const figure of figures) {
      assert.equal(report[figure], null, figure);
    }
  }
});

test('each range reports the lifecycle legs computed for its own window', () => {
  const feed = envelope({
    lifecycle_window: [
      legRow('3m', 'review', 1, 2, 11),
      legRow('6m', 'review', 3, 4, 22),
      legRow('12m', 'review', 5, 6, 33),
    ],
  });

  for (const [range, p50, p90, count] of [
    ['3m', 1, 2, 11],
    ['6m', 3, 4, 22],
    ['12m', 5, 6, 33],
  ]) {
    assert.deepEqual(
      buildCaseTypeReport(feed, String(range)).legs,
      [{ leg: 'review', p50, p90, count }],
      String(range)
    );
  }
});

test('an unknown range reads the six-month legs', () => {
  const feed = envelope({
    lifecycle_window: [
      legRow('3m', 'review', 1, 2, 11),
      legRow('6m', 'review', 3, 4, 22),
    ],
  });

  assert.equal(buildCaseTypeReport(feed, 'fortnight').legs?.[0].count, 22);
});

test('a feed with legs for other windows only has no legs for this range', () => {
  const feed = envelope({ lifecycle_window: [legRow('12m', 'review', 1, 2)] });

  assert.equal(buildCaseTypeReport(feed, '3m').legs, null);
  assert.ok(buildCaseTypeReport(feed, '12m').legs);
});

test('legs are listed in lifecycle order whatever order the feed lists them', () => {
  const feed = envelope({
    lifecycle_window: [
      legRow('6m', 'end_to_end', 1, 2),
      legRow('6m', 'remediation', 1, 2),
      legRow('6m', 'allocation', 1, 2),
      legRow('6m', 'to_reportable', 1, 2),
      legRow('6m', 'review', 1, 2),
    ],
  });

  assert.deepEqual(
    buildCaseTypeReport(feed, '6m').legs?.map((leg) => leg.leg),
    ['allocation', 'review', 'remediation', 'to_reportable', 'end_to_end']
  );
});

test('a leg the page does not know goes last rather than being dropped', () => {
  const feed = envelope({
    lifecycle_window: [
      legRow('6m', 'mystery', 1, 2),
      legRow('6m', 'end_to_end', 1, 2),
      legRow('6m', 'allocation', 1, 2),
    ],
  });

  assert.deepEqual(
    buildCaseTypeReport(feed, '6m').legs?.map((leg) => leg.leg),
    ['allocation', 'end_to_end', 'mystery']
  );
});

test('a 90th percentile below the median is lifted to the median', () => {
  const feed = envelope({
    lifecycle_window: [
      legRow('6m', 'allocation', 5, 3),
      legRow('6m', 'review', 5, 5),
      legRow('6m', 'remediation', 5, 9),
    ],
  });

  for (const leg of buildCaseTypeReport(feed, '6m').legs ?? []) {
    assert.ok(leg.p90 >= leg.p50, leg.leg);
  }
  assert.deepEqual(
    buildCaseTypeReport(feed, '6m').legs?.map((leg) => leg.p90),
    [5, 5, 9]
  );
});

test('a leg figure that is not a number reads as zero', () => {
  const feed = envelope({
    lifecycle_window: [
      {
        window: '6m',
        leg: 'review',
        p50: 'quick',
        p90: Number.NaN,
        n: undefined,
      },
    ],
  });

  assert.deepEqual(buildCaseTypeReport(feed, '6m').legs, [
    { leg: 'review', p50: 0, p90: 0, count: 0 },
  ]);
});

test('lifecycle rows that are not a leg of a window are left out', () => {
  const feed = envelope({
    lifecycle_window: [
      null,
      { window: '6m', p50: 1, p90: 2, n: 3 },
      { window: '6m', leg: 7, p50: 1, p90: 2, n: 3 },
      legRow('6m', 'review', 1, 2),
    ],
  });

  assert.deepEqual(
    buildCaseTypeReport(feed, '6m').legs?.map((leg) => leg.leg),
    ['review']
  );
});

test('outcomes need both the Case Type outcome order and the monthly counts', () => {
  const order = outcomeOrder(['good', 'bad']);
  const rows = [outcomeRow('2026-09', 'good', 3)];

  assert.equal(
    buildCaseTypeReport(envelope({ outcome_order: order }), '6m').outcomes,
    null
  );
  assert.equal(
    buildCaseTypeReport(envelope({ outcome_monthly: rows }), '6m').outcomes,
    null
  );
  assert.ok(
    buildCaseTypeReport(
      envelope({ outcome_order: order, outcome_monthly: rows }),
      '6m'
    ).outcomes
  );
});

test('outcomes carry the order the Case Type gives, best first, with its labels', () => {
  const report = buildCaseTypeReport(
    envelope({
      outcome_order: [
        { outcome: 'good', label: 'Good' },
        { outcome: 'bad', label: 'Bad' },
      ],
      outcome_monthly: [outcomeRow('2026-09', 'bad', 1)],
    }),
    '6m'
  );

  assert.deepEqual(report.outcomes?.order, [
    { outcome: 'good', label: 'Good' },
    { outcome: 'bad', label: 'Bad' },
  ]);
});

test('an outcome with no label is called by its own key', () => {
  const report = buildCaseTypeReport(
    envelope({
      outcome_order: [
        { outcome: 'good' },
        { outcome: 'bad', label: 7 },
        null,
        { label: 'Nameless' },
      ],
      outcome_monthly: [outcomeRow('2026-09', 'bad', 1)],
    }),
    '6m'
  );

  assert.deepEqual(report.outcomes?.order, [
    { outcome: 'good', label: 'good' },
    { outcome: 'bad', label: 'bad' },
  ]);
});

test('rows for the same month and outcome are added together', () => {
  const report = buildCaseTypeReport(
    envelope({
      outcome_order: outcomeOrder(['good', 'bad']),
      outcome_monthly: [
        outcomeRow('2026-09', 'good', 3),
        outcomeRow('2026-09', 'good', 4),
        outcomeRow('2026-09', 'bad', 1),
        outcomeRow('2026-08', 'good', 2),
      ],
    }),
    '6m'
  );

  assert.deepEqual(report.outcomes?.months, [
    { month: '2026-08', counts: { good: 2 } },
    { month: '2026-09', counts: { good: 7, bad: 1 } },
  ]);
});

test('each range keeps its last months of outcomes, oldest first', () => {
  const months = ['2026-03', '2026-01', '2026-09', '2026-05', '2026-07'];
  const feed = envelope({
    outcome_order: outcomeOrder(['good', 'bad']),
    outcome_monthly: [
      ...months.map((month) => outcomeRow(month, 'good', 1)),
      ...Array.from({ length: 10 }, (_, i) =>
        outcomeRow(`2025-${String(i + 1).padStart(2, '0')}`, 'good', 1)
      ),
    ],
  });

  for (const [key, window] of Object.entries(RANGES)) {
    const kept = buildCaseTypeReport(feed, key).outcomes?.months.map(
      (entry) => entry.month
    );
    assert.equal(kept?.length, window.months, key);
    assert.deepEqual(kept, [...(kept ?? [])].sort(), key);
    assert.equal(kept?.at(-1), '2026-09', key);
  }
  assert.deepEqual(
    buildCaseTypeReport(feed, '3m').outcomes?.months.map((m) => m.month),
    ['2026-05', '2026-07', '2026-09']
  );
});

test('outcome rows with no month or outcome, or a bad count, are read safely', () => {
  const report = buildCaseTypeReport(
    envelope({
      outcome_order: outcomeOrder(['good']),
      outcome_monthly: [
        null,
        { outcome: 'good', count: 1 },
        { month: '2026-09', count: 1 },
        { month: '2026-09', outcome: 'good', count: 'many' },
        outcomeRow('2026-09', 'good', 2),
      ],
    }),
    '6m'
  );

  assert.deepEqual(report.outcomes?.months, [
    { month: '2026-09', counts: { good: 2 } },
  ]);
});

test('a feed with an order but no outcome months still reports the order', () => {
  const report = buildCaseTypeReport(
    envelope({
      outcome_order: outcomeOrder(['good', 'bad']),
      outcome_monthly: [{ not: 'a month' }],
    }),
    '6m'
  );

  assert.equal(report.outcomes?.order.length, 2);
  assert.deepEqual(report.outcomes?.months, []);
});

test('remediation questions are listed with the highest share first', () => {
  const report = buildCaseTypeReport(
    envelope({
      remediation_questions: [
        questionRow(1, 0.1),
        questionRow(2, 0.5),
        questionRow(3, 0.3),
      ],
    }),
    '6m'
  );

  assert.deepEqual(report.remediation, [
    { questionId: 'q2', label: 'Question 2', caseCount: 20, share: 0.5 },
    { questionId: 'q3', label: 'Question 3', caseCount: 30, share: 0.3 },
    { questionId: 'q1', label: 'Question 1', caseCount: 10, share: 0.1 },
  ]);
});

test('only the eight questions with the highest share are kept', () => {
  const report = buildCaseTypeReport(
    envelope({
      remediation_questions: Array.from({ length: 12 }, (_, i) =>
        questionRow(i + 1)
      ),
    }),
    '6m'
  );

  assert.equal(report.remediation?.length, 8);
  assert.deepEqual(
    report.remediation?.map((question) => question.questionId),
    ['q12', 'q11', 'q10', 'q9', 'q8', 'q7', 'q6', 'q5']
  );
});

test('a feed with fewer than eight questions keeps them all', () => {
  const report = buildCaseTypeReport(
    envelope({ remediation_questions: [questionRow(1), questionRow(2)] }),
    '6m'
  );

  assert.equal(report.remediation?.length, 2);
});

test('a question with no label is called by its id', () => {
  const report = buildCaseTypeReport(
    envelope({
      remediation_questions: [
        { question_id: 'q9', case_count: 4, share_of_cases: 0.2 },
        { question_id: 'q8', label: 12, case_count: 4, share_of_cases: 0.1 },
      ],
    }),
    '6m'
  );

  assert.deepEqual(
    report.remediation?.map((question) => question.label),
    ['q9', 'q8']
  );
});

test('a question with no id is left out and a bad count or share reads as zero', () => {
  const report = buildCaseTypeReport(
    envelope({
      remediation_questions: [
        null,
        { label: 'Anonymous', case_count: 1, share_of_cases: 0.9 },
        { question_id: 'q1', case_count: 'lots', share_of_cases: Number.NaN },
      ],
    }),
    '6m'
  );

  assert.deepEqual(report.remediation, [
    { questionId: 'q1', label: 'q1', caseCount: 0, share: 0 },
  ]);
});

test('the posting pattern is seven weekdays of 24 hours, Monday first', () => {
  const report = buildCaseTypeReport(
    envelope({
      posting_pattern: [
        { weekday_order: 1, hour_of_day: 9, message_count: 5 },
        { weekday_order: 7, hour_of_day: 23, message_count: 2 },
      ],
    }),
    '6m'
  );

  const grid = report.posting ?? [];
  assert.equal(grid.length, 7);
  for (const day of grid) assert.equal(day.length, 24);
  assert.equal(grid[0][9], 5);
  assert.equal(grid[6][23], 2);
  assert.equal(
    grid.flat().reduce((a, b) => a + b, 0),
    7
  );
});

test('an hour the feed omits reads as zero', () => {
  const report = buildCaseTypeReport(
    envelope({
      posting_pattern: [{ weekday_order: 3, hour_of_day: 0, message_count: 1 }],
    }),
    '6m'
  );

  assert.equal(report.posting?.[2][0], 1);
  assert.equal(report.posting?.[2][1], 0);
  assert.equal(report.posting?.[3][0], 0);
});

test('posting rows are added together when the feed repeats a cell', () => {
  const report = buildCaseTypeReport(
    envelope({
      posting_pattern: [
        { weekday_order: 2, hour_of_day: 8, message_count: 3 },
        { weekday_order: 2, hour_of_day: 8, message_count: 4 },
      ],
    }),
    '6m'
  );

  assert.equal(report.posting?.[1][8], 7);
});

test('posting rows outside the weekday and hour grid are ignored', () => {
  const stray = [
    null,
    { weekday_order: 0, hour_of_day: 5, message_count: 1 },
    { weekday_order: 8, hour_of_day: 5, message_count: 1 },
    { weekday_order: 1, hour_of_day: -1, message_count: 1 },
    { weekday_order: 1, hour_of_day: 24, message_count: 1 },
    { weekday_order: 1.5, hour_of_day: 5, message_count: 1 },
    { weekday_order: 1, hour_of_day: 5.5, message_count: 1 },
    { weekday_order: '1', hour_of_day: 5, message_count: 1 },
    { weekday_order: 1, hour_of_day: '5', message_count: 1 },
    { weekday_order: 1, message_count: 1 },
    { hour_of_day: 5, message_count: 1 },
  ];
  const report = buildCaseTypeReport(
    envelope({ posting_pattern: stray }),
    '6m'
  );

  assert.equal(report.posting?.length, 7);
  assert.equal(
    report.posting?.flat().reduce((a, b) => a + b, 0),
    0
  );
});

test('a posting count that is not a number reads as zero', () => {
  const report = buildCaseTypeReport(
    envelope({
      posting_pattern: [
        { weekday_order: 1, hour_of_day: 1, message_count: 'many' },
        { weekday_order: 1, hour_of_day: 2 },
      ],
    }),
    '6m'
  );

  assert.deepEqual(report.posting?.[0].slice(0, 4), [0, 0, 0, 0]);
});
