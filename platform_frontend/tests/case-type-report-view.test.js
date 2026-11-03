// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { caseTypeReportContent } =
  await import('../src/reports/case-type/case-type-report-view.js');

/**
 * A model with every figure absent, then overridden.
 *
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

/** A model with every figure present. */
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

/** @param {any} svg @returns {string[]} what each mark says on hover */
function marks(svg) {
  return find(svg, (n) => n.getAttribute?.('data-cora-chart-mark') === 'true')
    .map((n) => n.getAttribute('data-cora-chart-description'))
    .filter(Boolean);
}

/** @param {any} svg @returns {string} the y axis labels */
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
 * A panel's chart at a typical width, as the DOM stub's element.
 *
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

test('the over-time panels are left out when their data is missing', () => {
  const content = caseTypeReportContent(model());
  assert.equal(content.sections?.length, 1);
  assert.deepEqual(content.sections?.[0].panels, []);
});

test('the over-time section offers the range filter and says what it covers', () => {
  const [section] =
    caseTypeReportContent(model({ range: '3m' })).sections ?? [];
  assert.deepEqual(section.filters, ['range']);
  assert.match(section.scope ?? '', /^3 months to Tue 6 Oct$/);
});

test('the over-time section names its range alone when the feed has no last day', () => {
  const [section] =
    caseTypeReportContent(model({ range: '12m', completeThrough: null }))
      .sections ?? [];
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
  // 20, 100 and 30 of 150.
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
 * Where the SLA chart's value axis starts, in percent.
 *
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
