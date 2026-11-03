// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  getByText,
  queryAllByTag,
  queryByRole,
  tableHeaders,
  textContent,
} from './helpers/semantic-dom.js';

installDom();

const { ReportPanel } =
  await import('../src/components/report/report-panel.js');

/** @typedef {import('../src/reports/contract.js').ReportPanelSpec} ReportPanelSpec */

/** @param {Partial<ReportPanelSpec>} [overrides] @returns {ReportPanelSpec} */
function spec(overrides = {}) {
  return {
    id: 'backlog',
    title: 'Backlog by age',
    render: (width) => {
      const body = document.createElement('div');
      body.className = 'test-chart';
      body.textContent = `chart at ${width}`;
      return body;
    },
    ...overrides,
  };
}

const TABLE = {
  columns: [
    { key: 'name', label: 'Team', value: 'name' },
    { key: 'count', label: 'Open', value: 'count' },
  ],
  rows: [
    { name: 'Alpha', count: 5 },
    { name: 'Bravo', count: 9 },
    { name: 'Charlie', count: 2 },
  ],
  rowKey: (/** @type {{ name: string }} */ row) => row.name,
};

/**
 * @param {ReportPanelSpec} panel
 * @param {Partial<Parameters<typeof ReportPanel>[1]>} [options]
 */
function draw(panel, options = {}) {
  return ReportPanel(panel, {
    width: 400,
    span: 12,
    showTable: false,
    sort: null,
    onToggleTable: () => {},
    onSort: () => {},
    ...options,
  });
}

/** @param {any} panel @returns {string[]} the first cell of each body row */
function firstColumn(panel) {
  return queryAllByTag(panel, 'tbody')
    .flatMap((body) => queryAllByTag(body, 'tr'))
    .map((row) => textContent(queryAllByTag(row, 'td')[0]));
}

test('a panel is a section named by its title', () => {
  const panel = draw(spec());

  assert.equal(panel.tagName, 'SECTION');
  const heading = getByRole(panel, 'heading', { name: 'Backlog by age' });
  assert.equal(
    panel.getAttribute('aria-labelledby'),
    heading.getAttribute('id')
  );
});

test('a panel shows its subtitle, chips and note only when it has them', () => {
  const full = draw(
    spec({
      subtitle: 'Days since the Case was opened',
      chips: ['Snapshot', 'Live'],
      note: 'Excludes withdrawn Cases',
    })
  );
  const bare = draw(spec());

  assert.ok(getByText(full, 'Days since the Case was opened'));
  assert.ok(getByText(full, 'Snapshot'));
  assert.ok(getByText(full, 'Live'));
  assert.ok(getByText(full, 'Excludes withdrawn Cases'));
  assert.equal(bare.querySelector('.cora-report-panel__subtitle'), null);
  assert.equal(bare.querySelector('.cora-report-panel__chip'), null);
  assert.equal(bare.querySelector('.cora-report-panel__note'), null);
});

test('the panel body is drawn at the width the engine gives it', () => {
  const panel = draw(spec(), { width: 517 });

  assert.equal(getByText(panel, 'chart at 517').className, 'test-chart');
});

test('a panel spans the columns it asks for, and a span the grid cannot hold takes the full row', () => {
  for (const span of [3, 4, 5, 6, 7, 8, 9, 12]) {
    assert.match(draw(spec(), { span }).className, new RegExp(`span-${span}$`));
  }
  for (const span of [0, 1, 2, 10, 11, 13, 6.5]) {
    assert.match(draw(spec(), { span }).className, /span-12$/, String(span));
  }
});

test('a panel with no table offers no way to switch to one', () => {
  const panel = draw(spec());

  assert.equal(queryByRole(panel, 'button'), null);
});

test('a panel with a table offers a Table button that is not pressed while the chart shows', () => {
  const panel = draw(spec({ table: TABLE }));

  const toggle = getByRole(panel, 'button', { name: 'Table' });
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.ok(getByText(panel, 'chart at 400'));
  assert.equal(queryAllByTag(panel, 'table').length, 0);
});

test('choosing the toggle asks to switch that panel, by its id', () => {
  /** @type {string[]} */
  const toggled = [];
  const panel = draw(spec({ table: TABLE }), {
    onToggleTable: (id) => toggled.push(id),
  });

  fireEvent(getByRole(panel, 'button', { name: 'Table' }), 'click');

  assert.deepEqual(toggled, ['backlog']);
});

test('while its table shows, a panel offers the Chart button, pressed, and draws rows instead of the chart', () => {
  const panel = draw(spec({ table: TABLE }), { showTable: true });

  const toggle = getByRole(panel, 'button', { name: 'Chart' });
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(firstColumn(panel), ['Alpha', 'Bravo', 'Charlie']);
  assert.throws(() => getByText(panel, 'chart at 400'));
});

test('asking for a table the panel does not have still draws the chart', () => {
  const panel = draw(spec(), { showTable: true });

  assert.ok(getByText(panel, 'chart at 400'));
  assert.equal(queryAllByTag(panel, 'table').length, 0);
});

test('a legend names each series and is hidden while the table shows', () => {
  const legend = [
    { label: 'Within target', role: /** @type {const} */ ('s1') },
    {
      label: 'Target',
      role: /** @type {const} */ ('danger'),
      shape: /** @type {const} */ ('line'),
    },
  ];
  const chart = draw(spec({ legend, table: TABLE }));
  const table = draw(spec({ legend, table: TABLE }), { showTable: true });

  assert.deepEqual(queryAllByTag(chart, 'li').map(textContent), [
    'Within target',
    'Target',
  ]);
  const keys = chart.querySelectorAll('.cora-report-legend__key');
  assert.match(keys[0].className, /--swatch$/);
  assert.match(keys[1].className, /--line$/);
  assert.equal(table.querySelector('.cora-report-legend'), null);
});

test('an empty legend draws nothing', () => {
  const panel = draw(spec({ legend: [] }));

  assert.equal(panel.querySelector('.cora-report-legend'), null);
});

test('table columns are sortable unless a column opts out', () => {
  const panel = draw(
    spec({
      table: {
        ...TABLE,
        columns: [
          { key: 'name', label: 'Team', value: 'name' },
          { key: 'count', label: 'Open', value: 'count', sortable: false },
        ],
      },
    }),
    { showTable: true }
  );

  assert.deepEqual(tableHeaders(panel), [
    ['Team', 'none', true],
    ['Open', 'none', false],
  ]);
});

test('choosing a sortable heading reports the panel and the column', () => {
  /** @type {[string, string][]} */
  const sorted = [];
  const panel = draw(spec({ table: TABLE }), {
    showTable: true,
    onSort: (id, key) => sorted.push([id, key]),
  });

  fireEvent(getByRole(panel, 'button', { name: 'Open' }), 'click');

  assert.deepEqual(sorted, [['backlog', 'count']]);
});

test('the table is ordered by the sort the engine holds for the panel', () => {
  const panel = draw(spec({ table: TABLE }), {
    showTable: true,
    sort: { key: 'count', dir: 'desc' },
  });

  assert.deepEqual(firstColumn(panel), ['Bravo', 'Alpha', 'Charlie']);
  assert.deepEqual(
    tableHeaders(panel).map(([, ariaSort]) => ariaSort),
    ['none', 'descending']
  );
});

test('a table with no rows says so rather than drawing empty headings', () => {
  const panel = draw(spec({ table: { ...TABLE, rows: [] } }), {
    showTable: true,
  });

  assert.ok(getByText(panel, 'No rows.'));
  assert.equal(queryAllByTag(panel, 'table').length, 0);
});
