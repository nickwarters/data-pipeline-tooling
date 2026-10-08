// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { caseTypeReportContent } =
  await import('../src/reports/case-type/case-type-report-view.js');

/**
 * @param {Partial<import('../src/reports/case-type/case-type-report-model.js').CaseTypeReportModel>} [overrides]
 * @returns {import('../src/reports/case-type/case-type-report-model.js').CaseTypeReportModel}
 */
function model(overrides = {}) {
  return {
    range: '6m',
    completeThrough: '2026-10-06',
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
    ...overrides,
  };
}

/** @param {number} toAllocate @param {number} inProgress @param {number} actions @param {string} [date] */
function backlogDay(toAllocate, inProgress, actions, date = '2026-10-06') {
  return {
    date,
    toAllocate,
    inProgress,
    actionsInProgress: actions,
    open: toAllocate + inProgress + actions,
  };
}

/** @param {string} month @param {number} onTime @param {number} late */
function slaMonth(month, onTime, late) {
  return {
    month,
    completed: onTime + late,
    onTime,
    late,
    share: onTime / (onTime + late),
  };
}

const FLOW = [{ weekEnding: '2026-10-06', arrived: 1, completed: 1 }];

/** @param {number} count @returns {{ outcome: string, label: string }[]} */
function outcomeOrder(count) {
  return Array.from({ length: count }, (_, i) => ({
    outcome: `o${i}`,
    label: `Outcome ${i}`,
  }));
}

/**
 * @param {number} count
 * @param {string[]} [months]
 */
function outcomeMix(count, months = ['2026-08', '2026-09']) {
  const order = outcomeOrder(count);
  return {
    order,
    months: months.map((month, m) => ({
      month,
      counts: Object.fromEntries(
        order.map((entry, i) => [entry.outcome, (i + 1) * (m + 1)])
      ),
    })),
  };
}

/** @returns {{ leg: string, p50: number, p90: number, count: number }[]} */
function legFigures() {
  return [
    { leg: 'allocation', p50: 1, p90: 2.25, count: 10 },
    { leg: 'review', p50: 5.14, p90: 12, count: 1200 },
    { leg: 'mystery', p50: 3, p90: 3, count: 4 },
  ];
}

/** @returns {{ questionId: string, label: string, caseCount: number, share: number }[]} */
function questionFigures() {
  return [
    {
      questionId: 'q1',
      label: 'Is the file complete?',
      caseCount: 1234,
      share: 0.256,
    },
    {
      questionId: 'q2',
      label: 'Was the customer told?',
      caseCount: 40,
      share: 0.05,
    },
  ];
}

/** @returns {number[][]} */
function postingGrid() {
  return Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) =>
      hour >= 9 && hour < 17 ? day + hour : 0
    )
  );
}

function fullModel() {
  return model({
    open: { now: 1200, before: 1000 },
    openTrend: [1000, 1100, 1200],
    toAllocate: { now: 20, before: 25 },
    overdue: 7,
    due: [
      { bucket: 'overdue_8_plus', count: 3, onHold: 1 },
      { bucket: 'overdue_1_7', count: 4, onHold: 0 },
      { bucket: 'due_today', count: 5, onHold: 0 },
      { bucket: 'due_1_7', count: 6, onHold: 0 },
      { bucket: 'due_8_plus', count: 7, onHold: 0 },
      { bucket: 'no_due_date', count: 8, onHold: 0 },
    ],
    latest: backlogDay(20, 100, 30),
    backlog: [
      backlogDay(1, 2, 3, '2026-10-04'),
      backlogDay(2, 3, 4, '2026-10-05'),
      backlogDay(20, 100, 30, '2026-10-06'),
    ],
    flow: [
      { weekEnding: '2026-09-29', arrived: 10, completed: 8 },
      { weekEnding: '2026-10-06', arrived: 12, completed: 9 },
    ],
    sla: [slaMonth('2026-08', 8, 2), slaMonth('2026-09', 9, 1)],
    slaTarget: 0.9,
    legs: legFigures(),
    outcomes: outcomeMix(3),
    remediation: questionFigures(),
    posting: postingGrid(),
  });
}

/** @param {import('../src/reports/contract.js').ReportContent} content */
function allPanels(content) {
  return [
    ...(content.now ?? []),
    ...(content.sections ?? []).flatMap((section) => section.panels),
  ];
}

/** @param {any} node @param {(node: any) => boolean} test @param {any[]} [found] @returns {any[]} */
function find(node, test, found = []) {
  if (test(node)) found.push(node);
  for (const child of node.childNodes ?? []) find(child, test, found);
  return found;
}

/** @param {any} svg @returns {string[]} */
function marks(svg) {
  return find(svg, (n) => n.getAttribute?.('data-cora-chart-mark') === 'true')
    .map((n) => n.getAttribute('data-cora-chart-description'))
    .filter(Boolean);
}

/** @param {any} svg @returns {string} */
function gridLabels(svg) {
  const grid = find(
    svg,
    (n) => n.getAttribute?.('class') === 'cora-chart__grid'
  )[0];
  return grid.textContent;
}

/** @param {any} svg @returns {number} */
function dotCount(svg) {
  return find(svg, (n) => n._tagName === 'circle').length;
}

/**
 * @param {import('../src/reports/contract.js').ReportPanelSpec} p
 * @returns {any}
 */
function drawn(p) {
  return p.render(600);
}

/** @param {import('../src/reports/contract.js').ReportContent} content @param {string} id */
function panel(content, id) {
  const found = allPanels(content).find((p) => p.id === id);
  assert.ok(found, `panel ${id} is present`);
  return found;
}

/** @param {import('../src/reports/contract.js').ReportContent} content @param {string} key */
function tile(content, key) {
  return content.kpis?.find((t) => t.key === key);
}

/** @param {import('../src/reports/contract.js').ReportPanelSpec} p @param {string} key */
function column(p, key) {
  const found = p.table?.columns.find((c) => c.key === key);
  assert.ok(found, `column ${key} is present`);
  return found;
}

/** @param {any} column @param {any} row */
function cell(column, row) {
  const raw =
    typeof column.value === 'function' ? column.value(row) : row[column.value];
  return column.format ? column.format(raw, row) : raw;
}

test('a report with no figures has no tiles and no panels', () => {
  const content = caseTypeReportContent(model());
  assert.deepEqual(content.kpis, []);
  assert.deepEqual(content.now, []);
  assert.deepEqual(allPanels(content), []);
});

test('each figure the model has gets its own tile, in a fixed order', () => {
  const content = caseTypeReportContent(fullModel());
  assert.deepEqual(
    content.kpis?.map((t) => t.key),
    ['open', 'to-allocate', 'overdue', 'sla']
  );
  for (const t of content.kpis ?? []) {
    assert.ok(t.label.length > 0, t.key);
    assert.ok(t.value.length > 0, t.key);
  }
});

test('a tile is left out when the figure behind it is absent', () => {
  const full = fullModel();
  /** @type {Record<string, Partial<typeof full>>} */
  const without = {
    open: { open: null },
    'to-allocate': { toAllocate: null },
    overdue: { overdue: null },
    sla: { sla: null },
  };
  for (const [key, removal] of Object.entries(without)) {
    const content = caseTypeReportContent({ ...full, ...removal });
    assert.equal(tile(content, key), undefined, key);
    assert.equal(content.kpis?.length, 3, key);
  }
});

test('a rise in the open count against 30 days ago is bad news', () => {
  const content = caseTypeReportContent(
    model({ open: { now: 1200, before: 1000 } })
  );
  assert.deepEqual(tile(content, 'open')?.delta, {
    text: '200 vs 30 days ago',
    direction: 'up',
    tone: 'bad',
  });
  assert.equal(tile(content, 'open')?.value, '1,200');
});

test('a fall in the open count against 30 days ago is good news', () => {
  const content = caseTypeReportContent(
    model({ open: { now: 1000, before: 1234 } })
  );
  assert.deepEqual(tile(content, 'open')?.delta, {
    text: '234 vs 30 days ago',
    direction: 'down',
    tone: 'good',
  });
});

test('an unchanged open count is neither good nor bad', () => {
  const content = caseTypeReportContent(
    model({ open: { now: 500, before: 500 } })
  );
  assert.deepEqual(tile(content, 'open')?.delta, {
    text: '0 vs 30 days ago',
    direction: 'flat',
    tone: 'neutral',
  });
});

test('the to-allocate tile judges its movement the same way', () => {
  const rise = caseTypeReportContent(
    model({ toAllocate: { now: 9, before: 3 } })
  );
  assert.equal(tile(rise, 'to-allocate')?.delta?.tone, 'bad');
  const fall = caseTypeReportContent(
    model({ toAllocate: { now: 3, before: 9 } })
  );
  assert.equal(tile(fall, 'to-allocate')?.delta?.tone, 'good');
  assert.equal(tile(fall, 'to-allocate')?.delta?.text, '6 vs 30 days ago');
});

test('a backlog tile has no movement when there is nothing 30 days back to compare', () => {
  const content = caseTypeReportContent(
    model({
      open: { now: 10, before: null },
      toAllocate: { now: 4, before: null },
    })
  );
  assert.equal(tile(content, 'open')?.delta, undefined);
  assert.equal(tile(content, 'to-allocate')?.delta, undefined);
});

test('the open tile carries the trend the model found, and none when there is none', () => {
  const withTrend = caseTypeReportContent(
    model({ open: { now: 3, before: 1 }, openTrend: [1, 2, 3] })
  );
  assert.deepEqual(tile(withTrend, 'open')?.trend, [1, 2, 3]);
  const without = caseTypeReportContent(
    model({ open: { now: 3, before: 1 }, openTrend: null })
  );
  assert.equal(tile(without, 'open')?.trend, undefined);
});

test('the overdue tile is marked as a danger only when something is overdue', () => {
  const some = caseTypeReportContent(model({ overdue: 1 }));
  assert.equal(tile(some, 'overdue')?.status, 'danger');
  assert.equal(tile(some, 'overdue')?.value, '1');
  const none = caseTypeReportContent(model({ overdue: 0 }));
  assert.equal(tile(none, 'overdue')?.status, undefined);
  assert.equal(tile(none, 'overdue')?.value, '0');
});

test('the SLA tile shows the latest month as a one-decimal percentage', () => {
  const content = caseTypeReportContent(
    model({ sla: [slaMonth('2026-08', 1, 1), slaMonth('2026-09', 912, 88)] })
  );
  const t = tile(content, 'sla');
  assert.equal(t?.value, '91.2');
  assert.equal(t?.unit, '%');
  assert.match(t?.label ?? '', /Sep/);
  assert.doesNotMatch(t?.label ?? '', /Aug/);
});

test('the SLA tile shows a meter against the target only when there is a target', () => {
  const months = [slaMonth('2026-09', 8, 2)];
  const targeted = caseTypeReportContent(
    model({ sla: months, slaTarget: 0.9 })
  );
  assert.deepEqual(tile(targeted, 'sla')?.meter, {
    value: 0.8,
    target: 0.9,
    label: 'a target',
  });
  const untargeted = caseTypeReportContent(model({ sla: months }));
  assert.equal(tile(untargeted, 'sla')?.meter, undefined);
});

test('no SLA tile is drawn for a model with no months', () => {
  const content = caseTypeReportContent(model({ sla: [] }));
  assert.equal(tile(content, 'sla'), undefined);
});

test('the snapshot panels are left out when their data is missing', () => {
  const dueOnly = caseTypeReportContent(model({ due: fullModel().due }));
  assert.deepEqual(
    dueOnly.now?.map((p) => p.id),
    ['due']
  );
  const statusOnly = caseTypeReportContent(
    model({ latest: backlogDay(1, 2, 3) })
  );
  assert.deepEqual(
    statusOnly.now?.map((p) => p.id),
    ['status']
  );
  const both = caseTypeReportContent(fullModel());
  assert.deepEqual(
    both.now?.map((p) => p.id),
    ['due', 'status']
  );
});

test('a section with no panels is left out of the page', () => {
  const content = caseTypeReportContent(model());
  assert.deepEqual(content.sections, []);
});

test('the over-time section offers the range filter and says what it covers', () => {
  const [section] =
    caseTypeReportContent(model({ range: '3m', flow: FLOW })).sections ?? [];
  assert.equal(section.id, 'over-time');
  assert.deepEqual(section.filters, ['range']);
  assert.match(section.scope ?? '', /^3 months to Tue 6 Oct$/);
});

test('the over-time section names its range alone when the feed has no last day', () => {
  const [section] =
    caseTypeReportContent(
      model({ range: '12m', completeThrough: null, flow: FLOW })
    ).sections ?? [];
  assert.equal(section.scope, '12 months');
});

test('a backlog line needs at least two days to be a line', () => {
  const one = caseTypeReportContent(model({ backlog: [backlogDay(1, 1, 1)] }));
  assert.deepEqual(allPanels(one), []);
  const two = caseTypeReportContent(
    model({
      backlog: [backlogDay(1, 1, 1, '2026-10-05'), backlogDay(1, 1, 1)],
    })
  );
  assert.deepEqual(
    allPanels(two).map((p) => p.id),
    ['backlog']
  );
});

test('the SLA line needs at least two months to be a trend', () => {
  const one = caseTypeReportContent(
    model({ sla: [slaMonth('2026-09', 9, 1)] })
  );
  assert.equal(
    allPanels(one).find((p) => p.id === 'sla'),
    undefined
  );
  assert.ok(tile(one, 'sla'), 'the tile still states the one month');
  const two = caseTypeReportContent(
    model({ sla: [slaMonth('2026-08', 9, 1), slaMonth('2026-09', 9, 1)] })
  );
  assert.ok(allPanels(two).find((p) => p.id === 'sla'));
});

test('a flow panel is drawn whenever the model has flow', () => {
  const content = caseTypeReportContent(
    model({ flow: [{ weekEnding: '2026-10-06', arrived: 1, completed: 1 }] })
  );
  assert.deepEqual(
    allPanels(content).map((p) => p.id),
    ['flow']
  );
});

test('panel ids are unique across the page', () => {
  const ids = allPanels(caseTypeReportContent(fullModel())).map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every panel draws an SVG chart at the width it is given', () => {
  for (const p of allPanels(caseTypeReportContent(fullModel()))) {
    const svg = drawn(p);
    assert.equal(svg._tagName, 'svg', p.id);
    assert.ok(
      String(svg.getAttribute('class')).split(/\s+/).includes('cora-chart'),
      p.id
    );
    assert.equal(svg.getAttribute('width'), '600', p.id);
  }
});

test('every panel with a table has rows with distinct keys and cells that read', () => {
  for (const p of allPanels(caseTypeReportContent(fullModel()))) {
    assert.ok(p.table, `${p.id} has a table`);
    assert.ok(p.table.rows.length > 0, p.id);
    const keys = p.table.rows.map((row) => p.table?.rowKey(row));
    assert.equal(new Set(keys).size, keys.length, `${p.id} row keys`);
    for (const key of keys) assert.equal(typeof key, 'string', p.id);
    for (const c of p.table.columns) {
      for (const row of p.table.rows) {
        const shown = cell(c, row);
        assert.notEqual(shown, undefined, `${p.id}/${c.key}`);
        assert.notEqual(String(shown), 'NaN', `${p.id}/${c.key}`);
      }
    }
  }
});

test('due buckets that are overdue are danger rows with a marker', () => {
  const p = panel(caseTypeReportContent(fullModel()), 'due');
  for (const bucket of ['overdue_8_plus', 'overdue_1_7']) {
    const row = p.table?.rows.find((r) => r.bucket === bucket);
    assert.equal(row.role, 'danger', bucket);
    assert.ok(row.marker, `${bucket} carries a marker besides its colour`);
  }
});

test('the bucket due today is a warning row with its own marker', () => {
  const p = panel(caseTypeReportContent(fullModel()), 'due');
  const today = p.table?.rows.find((r) => r.bucket === 'due_today');
  const overdue = p.table?.rows.find((r) => r.bucket === 'overdue_1_7');
  assert.equal(today.role, 'warning');
  assert.ok(today.marker);
  assert.notEqual(today.marker, overdue.marker);
});

test('the buckets not yet due are quiet rows with no marker', () => {
  const p = panel(caseTypeReportContent(fullModel()), 'due');
  for (const bucket of ['due_1_7', 'due_8_plus', 'no_due_date']) {
    const row = p.table?.rows.find((r) => r.bucket === bucket);
    assert.equal(row.role, 'quiet', bucket);
    assert.equal(row.marker, undefined, bucket);
  }
});

test('a bucket the page has no wording for still renders, under its own key', () => {
  const content = caseTypeReportContent(
    model({ due: [{ bucket: 'due_next_quarter', count: 9, onHold: 0 }] })
  );
  const p = panel(content, 'due');
  assert.equal(p.table?.rows[0].label, 'due_next_quarter');
  assert.equal(p.table?.rows[0].role, 'quiet');
  assert.deepEqual(marks(p.render(600)), ['due_next_quarter: 9 Cases']);
});

test('the due chart mentions Cases on hold only for a bucket that has some', () => {
  const p = panel(caseTypeReportContent(fullModel()), 'due');
  const described = marks(p.render(600));
  const held = described.filter((text) => text.includes('on hold'));
  assert.equal(held.length, 1);
  assert.match(held[0], /^Overdue 8\+ days: 3 Cases, 1 on hold$/);
});

test('the due table counts Cases and Cases on hold', () => {
  const p = panel(caseTypeReportContent(fullModel()), 'due');
  const row = p.table?.rows[0];
  assert.equal(cell(column(p, 'label'), row), 'Overdue 8+ days');
  assert.equal(cell(column(p, 'count'), row), 3);
  assert.equal(cell(column(p, 'onHold'), row), 1);
});

test('the status panel splits open Cases across the three statuses', () => {
  const p = panel(caseTypeReportContent(fullModel()), 'status');
  assert.deepEqual(
    p.table?.rows.map((r) => r.value),
    [20, 100, 30]
  );
  assert.equal(p.legend?.length, p.table?.rows.length);
  assert.deepEqual(marks(p.render(600)).length, p.table?.rows.length);
});

test('each status states its share of open Cases as a percentage', () => {
  const p = panel(caseTypeReportContent(fullModel()), 'status');
  const share = column(p, 'share');
  const shown = p.table?.rows.map((row) => cell(share, row));
  assert.deepEqual(shown, ['13%', '67%', '20%']);
});

test('a status share is zero when nothing is open', () => {
  const p = panel(
    caseTypeReportContent(model({ latest: backlogDay(0, 0, 0) })),
    'status'
  );
  const share = column(p, 'share');
  for (const row of p.table?.rows ?? []) {
    assert.equal(cell(share, row), '0%');
  }
});

test('the backlog table lists the newest day first, dated in words', () => {
  const p = panel(caseTypeReportContent(fullModel()), 'backlog');
  const rows = p.table?.rows ?? [];
  assert.equal(rows[0].date, '2026-10-06');
  assert.equal(rows.at(-1).date, '2026-10-04');
  assert.equal(cell(column(p, 'date'), rows[0]), 'Tue 6 Oct');
  assert.equal(cell(column(p, 'open'), rows[0]), 150);
});

test('the backlog chart is described by its first and last day', () => {
  const p = panel(caseTypeReportContent(fullModel()), 'backlog');
  assert.equal(
    drawn(p).getAttribute('aria-label'),
    'Open Cases at close of day, 6 on Sun 4 Oct and 150 on Tue 6 Oct'
  );
});

test('the flow table lists the newest week first and counts both directions', () => {
  const p = panel(caseTypeReportContent(fullModel()), 'flow');
  const rows = p.table?.rows ?? [];
  assert.equal(rows[0].weekEnding, '2026-10-06');
  assert.equal(cell(column(p, 'weekEnding'), rows[0]), 'Tue 6 Oct');
  assert.equal(cell(column(p, 'arrived'), rows[0]), 12);
  assert.equal(cell(column(p, 'completed'), rows[0]), 9);
  assert.equal(p.legend?.length, 2);
});

test('the SLA table lists the newest month first, spelled out', () => {
  const p = panel(caseTypeReportContent(fullModel()), 'sla');
  const rows = p.table?.rows ?? [];
  assert.equal(rows[0].month, '2026-09');
  assert.equal(cell(column(p, 'month'), rows[0]), 'September 2026');
  assert.equal(cell(column(p, 'share'), rows[0]), '90.0%');
  assert.equal(cell(column(p, 'late'), rows[0]), 1);
});

test('the SLA chart is described by its latest month', () => {
  const p = panel(caseTypeReportContent(fullModel()), 'sla');
  assert.equal(
    drawn(p).getAttribute('aria-label'),
    'Review SLA attainment by month, 90.0% in September 2026'
  );
});

test('the SLA chart draws its target line only when there is a target', () => {
  const months = [slaMonth('2026-08', 8, 2), slaMonth('2026-09', 9, 1)];
  const targets = (/** @type {number | null} */ slaTarget) =>
    find(
      panel(
        caseTypeReportContent(model({ sla: months, slaTarget })),
        'sla'
      ).render(600),
      (n) => n.getAttribute?.('class') === 'cora-chart__target'
    ).length;
  assert.equal(targets(0.9), 1);
  assert.equal(targets(null), 0);
});

/**
 * @param {number[]} shares
 * @param {number | null} [slaTarget]
 * @returns {number}
 */
function axisStart(shares, slaTarget = null) {
  const sla = shares.map((share, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    completed: 10,
    onTime: share * 10,
    late: 10 - share * 10,
    share,
  }));
  const labels = gridLabels(
    panel(caseTypeReportContent(model({ sla, slaTarget })), 'sla').render(600)
  );
  return Number.parseInt(labels, 10);
}

test('the SLA axis zooms in a little under the lowest month', () => {
  assert.equal(axisStart([0.3, 0.35]), 20);
  const start = axisStart([0.8, 0.85]);
  assert.ok(start > 0 && start < 80, `starts at ${start}%`);
});

test('the SLA axis never starts above sixty percent, nor below zero', () => {
  assert.equal(axisStart([0.96, 0.97]), 60);
  assert.equal(axisStart([0.02, 0.03]), 0);
});

test('the SLA axis leaves room for a target below the lowest month', () => {
  assert.equal(axisStart([0.9, 0.95], 0.3), 20);
  assert.equal(axisStart([0.5, 0.95], 0.9), axisStart([0.5, 0.95], null));
});

test('the SLA line marks each month with a dot only while there are few', () => {
  const dots = (/** @type {number} */ months) =>
    dotCount(
      panel(
        caseTypeReportContent(
          model({
            sla: Array.from({ length: months }, (_, i) =>
              slaMonth(`2026-${String(i + 1).padStart(2, '0')}`, 8, 2)
            ),
          })
        ),
        'sla'
      ).render(600)
    );
  assert.ok(dots(6) > dots(7));
});

/** @type {Record<string, Partial<ReturnType<typeof fullModel>>>} */
const NEW_FIGURES = {
  legs: { legs: legFigures() },
  outcomes: { outcomes: outcomeMix(3) },
  remediation: { remediation: questionFigures() },
  posting: { posting: postingGrid() },
};

/** @param {import('../src/reports/contract.js').ReportContent} content @param {string} id */
function sectionOf(content, id) {
  return content.sections?.find((section) => section.id === id);
}

test('each new panel appears only when its figure exists', () => {
  for (const [id, figure] of Object.entries(NEW_FIGURES)) {
    const present = caseTypeReportContent(model(figure));
    assert.deepEqual(
      allPanels(present).map((p) => p.id),
      [id],
      id
    );
    const absent = caseTypeReportContent({
      ...fullModel(),
      ...nullOut(figure),
    });
    assert.equal(
      allPanels(absent).find((p) => p.id === id),
      undefined,
      id
    );
  }
});

/** @param {Record<string, unknown>} figure */
function nullOut(figure) {
  return Object.fromEntries(Object.keys(figure).map((key) => [key, null]));
}

test('stage durations and outcomes sit with the over-time panels', () => {
  const content = caseTypeReportContent(fullModel());
  const ids = sectionOf(content, 'over-time')?.panels.map((p) => p.id) ?? [];

  assert.ok(ids.includes('legs'));
  assert.ok(ids.includes('outcomes'));
  assert.ok(ids.indexOf('legs') < ids.indexOf('outcomes'));
});

test('remediation and posting sit in a section about all current Cases', () => {
  const content = caseTypeReportContent(fullModel());
  const section = sectionOf(content, 'all-current');

  assert.equal(section?.title, 'Across all current Cases');
  assert.deepEqual(
    section?.panels.map((p) => p.id),
    ['remediation', 'posting']
  );
  assert.equal(section?.filters, undefined);
  assert.ok((section?.scope ?? '').length > 0);
});

test('the all-current section follows the over-time section', () => {
  assert.deepEqual(
    caseTypeReportContent(fullModel()).sections?.map((s) => s.id),
    ['over-time', 'all-current']
  );
});

test('the all-current section is left out when it has no panels', () => {
  const content = caseTypeReportContent(model({ flow: FLOW }));

  assert.deepEqual(
    content.sections?.map((s) => s.id),
    ['over-time']
  );
});

test('the over-time section is left out when only all-current figures exist', () => {
  const content = caseTypeReportContent(model({ posting: postingGrid() }));

  assert.deepEqual(
    content.sections?.map((s) => s.id),
    ['all-current']
  );
});

test('an empty list of remediation questions draws no panel', () => {
  const content = caseTypeReportContent(model({ remediation: [] }));

  assert.deepEqual(allPanels(content), []);
  assert.deepEqual(content.sections, []);
});

test('every new panel draws an SVG chart at the width it is given', () => {
  for (const id of Object.keys(NEW_FIGURES)) {
    const svg = drawn(panel(caseTypeReportContent(fullModel()), id));
    assert.equal(svg._tagName, 'svg', id);
    assert.ok(
      String(svg.getAttribute('class')).split(/\s+/).includes('cora-chart'),
      id
    );
    assert.equal(svg.getAttribute('width'), '600', id);
  }
});

test('the stage chart names median, 90th percentile and Case count for each stage', () => {
  const svg = drawn(panel(caseTypeReportContent(fullModel()), 'legs'));

  assert.deepEqual(marks(svg), [
    'Allocation: median 1.0 d, 90th percentile 2.3 d, over 10 Cases',
    'Review: median 5.1 d, 90th percentile 12.0 d, over 1,200 Cases',
    'mystery: median 3.0 d, 90th percentile 3.0 d, over 4 Cases',
  ]);
});

test('the stage table writes durations in days and names a stage the page does not know by its key', () => {
  const legs = panel(caseTypeReportContent(fullModel()), 'legs');
  const rows = legs.table?.rows ?? [];

  assert.deepEqual(
    rows.map((row) => cell(column(legs, 'label'), row)),
    ['Allocation', 'Review', 'mystery']
  );
  assert.deepEqual(
    rows.map((row) => cell(column(legs, 'p50'), row)),
    ['1.0 d', '5.1 d', '3.0 d']
  );
  assert.deepEqual(
    rows.map((row) => cell(column(legs, 'p90'), row)),
    ['2.3 d', '12.0 d', '3.0 d']
  );
  assert.deepEqual(
    rows.map((row) => cell(column(legs, 'count'), row)),
    [10, 1200, 4]
  );
});

test('the stage panel says which range it covers and explains the legend', () => {
  const three = panel(
    caseTypeReportContent(model({ range: '3m', legs: legFigures() })),
    'legs'
  );

  assert.match(three.subtitle ?? '', /last 3 months/);
  assert.deepEqual(
    three.legend?.map((entry) => entry.label),
    ['Median', 'Median to 90th percentile']
  );
});

test('outcomes are coloured from the best to the worst for two to five outcomes', () => {
  for (const count of [2, 3, 4, 5]) {
    const outcomes = panel(
      caseTypeReportContent(model({ outcomes: outcomeMix(count) })),
      'outcomes'
    );
    const roles = outcomes.legend?.map((entry) => entry.role) ?? [];

    assert.equal(roles.length, count, String(count));
    assert.equal(roles[0], 's1', String(count));
    assert.equal(roles.at(-1), 'danger', String(count));
    assert.equal(new Set(roles).size, count, `${count} roles are distinct`);
    assert.deepEqual(
      outcomes.legend?.map((entry) => entry.label),
      outcomeOrder(count).map((entry) => entry.label),
      String(count)
    );
  }
});

test('the outcome chart paints its segments in the legend roles', () => {
  const outcomes = panel(
    caseTypeReportContent(model({ outcomes: outcomeMix(2, ['2026-09']) })),
    'outcomes'
  );

  const fills = find(
    drawn(outcomes),
    (n) => n.getAttribute?.('class') === 'cora-stack-columns__segment'
  ).map((n) => n.getAttribute('fill'));
  assert.deepEqual(fills, [
    'var(--cora-viz-series-1)',
    'var(--cora-color-danger)',
  ]);
});

test('outcomes with one, or more than five, outcomes leave the panel out', () => {
  for (const count of [0, 1, 6, 7]) {
    const content = caseTypeReportContent(
      model({ outcomes: outcomeMix(count), flow: FLOW })
    );
    assert.equal(
      allPanels(content).find((p) => p.id === 'outcomes'),
      undefined,
      String(count)
    );
  }
});

test('outcomes with no months leave the panel out', () => {
  const content = caseTypeReportContent(
    model({ outcomes: outcomeMix(3, []), flow: FLOW })
  );

  assert.equal(
    allPanels(content).find((p) => p.id === 'outcomes'),
    undefined
  );
});

test('the outcome chart is described month by month in words', () => {
  const svg = drawn(
    panel(caseTypeReportContent(model({ outcomes: outcomeMix(2) })), 'outcomes')
  );

  const [august, september] = marks(svg);
  assert.match(String(august), /^August 2026: /);
  assert.match(String(september), /^September 2026: /);
  assert.match(String(august), /Outcome 0 33% \(1\), Outcome 1 67% \(2\)/);
});

test('the outcome table lists the newest month first, spelled out, one column per outcome', () => {
  const outcomes = panel(
    caseTypeReportContent(model({ outcomes: outcomeMix(3) })),
    'outcomes'
  );
  const rows = outcomes.table?.rows ?? [];

  assert.deepEqual(
    rows.map((row) => cell(column(outcomes, 'month'), row)),
    ['September 2026', 'August 2026']
  );
  assert.deepEqual(
    outcomes.table?.columns.map((c) => c.label),
    ['Month', 'Outcome 0', 'Outcome 1', 'Outcome 2']
  );
  assert.deepEqual(
    rows.map((row) => cell(column(outcomes, 'o2'), row)),
    [6, 3]
  );
});

test('an outcome with no Cases in a month reads as zero in the table', () => {
  const mix = outcomeMix(2, ['2026-09']);
  mix.months[0].counts = { o0: 4 };
  const outcomes = panel(
    caseTypeReportContent(model({ outcomes: mix })),
    'outcomes'
  );

  assert.equal(cell(column(outcomes, 'o1'), outcomes.table?.rows[0]), 0);
});

test('the remediation chart reads as shares of Cases with their counts', () => {
  const svg = drawn(panel(caseTypeReportContent(fullModel()), 'remediation'));

  const said = marks(svg).join(' | ');
  assert.match(said, /Is the file complete\?/);
  assert.match(said, /26%/);
  assert.match(said, /1,234 Cases/);
});

test('the remediation table lists the questions with their share as a percentage', () => {
  const remediation = panel(caseTypeReportContent(fullModel()), 'remediation');
  const rows = remediation.table?.rows ?? [];

  assert.deepEqual(
    rows.map((row) => cell(column(remediation, 'label'), row)),
    ['Is the file complete?', 'Was the customer told?']
  );
  assert.deepEqual(
    rows.map((row) => cell(column(remediation, 'share'), row)),
    ['26%', '5%']
  );
  assert.deepEqual(
    rows.map((row) => cell(column(remediation, 'caseCount'), row)),
    [1234, 40]
  );
});

test('the posting chart describes each cell by weekday and hour with its message count', () => {
  const svg = drawn(panel(caseTypeReportContent(fullModel()), 'posting'));

  const said = marks(svg);
  assert.equal(said.length, 7 * 24);
  assert.equal(said[0], 'Mon 00:00–01:00: 0 messages');
  assert.equal(said[9], 'Mon 09:00–10:00: 9 messages');
  assert.equal(said[6 * 24 + 23], 'Sun 23:00–00:00: 0 messages');
});

test('the posting chart labels a few hours along its axis', () => {
  const svg = drawn(panel(caseTypeReportContent(fullModel()), 'posting'));

  const axis = find(
    svg,
    (n) => n.getAttribute?.('class') === 'cora-chart__x-axis'
  )[0];
  assert.deepEqual(
    axis.querySelectorAll('text').map((/** @type {any} */ t) => t.textContent),
    ['00', '06', '12', '18', '23']
  );
});

test('the posting table has a Day column, 24 hour columns and a Total', () => {
  const posting = panel(caseTypeReportContent(fullModel()), 'posting');
  const labels = posting.table?.columns.map((c) => c.label) ?? [];

  assert.equal(labels.length, 26);
  assert.equal(labels[0], 'Day');
  assert.equal(labels.at(-1), 'Total');
  assert.deepEqual(labels.slice(1, 4), ['00:00', '01:00', '02:00']);
  assert.equal(labels[24], '23:00');
});

test('the posting table has a row for each weekday, Monday first, with its hours and total', () => {
  const grid = postingGrid();
  const posting = panel(
    caseTypeReportContent(model({ posting: grid })),
    'posting'
  );
  const rows = posting.table?.rows ?? [];

  assert.deepEqual(
    rows.map((row) => cell(column(posting, 'day'), row)),
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  );
  rows.forEach((row, day) => {
    assert.equal(cell(column(posting, 'h9'), row), grid[day][9]);
    assert.equal(cell(column(posting, 'h23'), row), 0);
    assert.equal(
      cell(column(posting, 'total'), row),
      grid[day].reduce((a, b) => a + b, 0)
    );
  });
});
