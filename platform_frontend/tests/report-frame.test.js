// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  getByTag,
  queryAllByRole,
  queryAllByTag,
  queryByRole,
  queryByTag,
  textContent,
} from './helpers/semantic-dom.js';

installDom();

const { ReportFrame } =
  await import('../src/components/report/report-frame.js');

/** @typedef {import('../src/components/report/report-frame.js').ReportFrameProps} ReportFrameProps */
/** @typedef {import('../src/reports/contract.js').ReportPanelSpec} ReportPanelSpec */

/**
 * @param {string} zone
 * @param {() => void} body
 */
function inZone(zone, body) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    body();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

/**
 * @param {string} id
 * @param {Partial<ReportPanelSpec>} [overrides]
 * @returns {ReportPanelSpec}
 */
function panel(id, overrides = {}) {
  return {
    id,
    title: `Panel ${id}`,
    render: (width) => {
      const body = document.createElement('div');
      body.className = 'test-chart';
      body.textContent = `${id} at ${width}`;
      return body;
    },
    ...overrides,
  };
}

/** @param {Partial<ReportFrameProps>} [overrides] @returns {ReportFrameProps} */
function props(overrides = {}) {
  return {
    reportId: 'queues',
    layout: 'stacked',
    width: 1088,
    eyebrow: 'Case Type report',
    title: 'Complaints',
    completeThrough: '2026-10-06',
    generatedAt: '2026-10-07',
    scopes: [{ kind: 'case-type', key: 'complaints', label: 'Complaints' }],
    scopeKey: 'complaints',
    banner: null,
    content: {
      sections: [{ id: 'main', title: 'Queues', panels: [panel('a')] }],
    },
    filterSpecs: {},
    filters: {},
    tables: [],
    sorts: {},
    onFilter: () => {},
    onToggleTable: () => {},
    onSort: () => {},
    ...overrides,
  };
}

/** @param {any} root @param {string} id @returns {number} */
function widthOf(root, id) {
  const match = queryAllByTag(root, 'div')
    .map(textContent)
    .find((text) => text.startsWith(`${id} at `));
  assert.ok(match, `panel ${id} was drawn`);
  return Number(match.slice(`${id} at `.length));
}

/** @param {any} root @param {string} id @returns {string} */
function spanOf(root, id) {
  const section = queryAllByTag(root, 'section').find((candidate) =>
    textContent(candidate).startsWith(`Panel ${id}`)
  );
  assert.ok(section, `panel ${id} was drawn`);
  return section.className;
}

/** @param {any} root @returns {string[]} */
function headings(root) {
  return queryAllByRole(root, 'heading').map(textContent);
}

const KPI = { key: 'open', label: 'Open Cases', value: '42' };
const FILTERS = {
  range: {
    label: 'Date range',
    initial: 'week',
    options: [
      { key: 'week', label: 'Last 7 days' },
      { key: 'month', label: 'Last 30 days' },
    ],
  },
};

test('the header names the kind of report and which scope it is about', () => {
  const frame = ReportFrame(props());

  assert.equal(
    textContent(getByRole(frame, 'banner')).startsWith(
      'Case Type report Complaints'
    ),
    true
  );
  assert.equal(
    getByRole(frame, 'heading', { name: 'Complaints' }).tagName,
    'H1'
  );
});

test('the freshness line states what the report is complete through and when it was published', () => {
  inZone('UTC', () => {
    const frame = ReportFrame(
      props({
        completeThrough: '2026-10-06',
        generatedAt: '2026-10-07T08:05:00Z',
      })
    );

    const line = frame.querySelector('.cora-report__freshness');
    assert.equal(
      textContent(line),
      'Complete through Tue 6 Oct · published 7 Oct 2026, 08:05'
    );
  });
});

test('the freshness line says so when completeness is not stated or the publish time is unknown', () => {
  const frame = ReportFrame(
    props({ completeThrough: null, generatedAt: null })
  );

  const line = frame.querySelector('.cora-report__freshness');
  assert.equal(textContent(line), 'Completeness not stated');
});

test('the freshness line can state completeness without a publish time and the reverse', () => {
  const completeOnly = ReportFrame(props({ generatedAt: null }));
  const publishedOnly = ReportFrame(
    props({ completeThrough: null, generatedAt: '2026-10-07' })
  );

  assert.equal(
    textContent(completeOnly.querySelector('.cora-report__freshness')),
    'Complete through Tue 6 Oct'
  );
  assert.equal(
    textContent(publishedOnly.querySelector('.cora-report__freshness')),
    'Completeness not stated · published 7 Oct 2026'
  );
});

test('a banner is announced as a status, and absent when there is nothing to say', () => {
  const withBanner = ReportFrame(
    props({ banner: "Showing yesterday's figures" })
  );
  const without = ReportFrame(props());

  assert.equal(
    textContent(getByRole(withBanner, 'status')),
    "Showing yesterday's figures"
  );
  assert.equal(queryByRole(without, 'status'), null);
});

test('a single scope offers no switcher', () => {
  const frame = ReportFrame(props());

  assert.equal(queryByRole(frame, 'combobox'), null);
});

test('several scopes offer a switcher listing each, with the current one selected', () => {
  const frame = ReportFrame(
    props({
      scopes: [
        { kind: 'case-type', key: 'complaints', label: 'Complaints' },
        { kind: 'case-type', key: 'claims', label: 'Claims' },
      ],
      scopeKey: 'claims',
    })
  );

  const select = getByRole(frame, 'combobox');
  assert.deepEqual(queryAllByRole(select, 'option').map(textContent), [
    'Complaints',
    'Claims',
  ]);
  assert.equal(select.value, 'claims');
});

test('choosing another scope opens that scope of the same report', () => {
  const frame = ReportFrame(
    props({
      scopes: [
        { kind: 'case-type', key: 'complaints', label: 'Complaints' },
        { kind: 'case-type', key: 'motor claims', label: 'Motor claims' },
      ],
    })
  );
  const select = getByRole(frame, 'combobox');

  location.hash = '';
  select.value = 'motor claims';
  fireEvent(select, 'change', { currentTarget: select });

  assert.equal(location.hash, '#/reports/queues/motor%20claims');
});

test('the stacked layout leads with a Right now section holding the headline figures', () => {
  const frame = ReportFrame(props({ content: { kpis: [KPI], sections: [] } }));

  assert.deepEqual(headings(frame), ['Complaints', 'Right now']);
  assert.ok(frame.querySelector('.cora-report-kpis'));
  assert.equal(frame.querySelector('.cora-report-kpis--stacked'), null);
  assert.equal(
    textContent(frame.querySelector('.cora-report-section__scope')),
    'As at close of Tue 6 Oct'
  );
});

test('the stacked layout gives snapshot panels the Right now section even with no headline figures', () => {
  const frame = ReportFrame(
    props({ content: { now: [panel('snap')], sections: [] } })
  );

  assert.deepEqual(headings(frame).slice(0, 2), ['Complaints', 'Right now']);
  assert.equal(frame.querySelector('.cora-report-kpis'), null);
  assert.ok(widthOf(frame, 'snap') > 0);
});

test('the stacked layout has no Right now section when there is nothing to put in it', () => {
  const frame = ReportFrame(props());

  assert.ok(!headings(frame).includes('Right now'));
});

test('a report that supplies only headline figures still draws, with no sections after them', () => {
  const frame = ReportFrame(props({ content: { kpis: [KPI] } }));

  assert.deepEqual(headings(frame), ['Complaints', 'Right now']);
  assert.equal(queryAllByRole(frame, 'heading', { name: 'Queues' }).length, 0);
});

test('Right now does not claim a day the report does not state', () => {
  const frame = ReportFrame(
    props({ completeThrough: null, content: { kpis: [KPI], sections: [] } })
  );

  assert.ok(headings(frame).includes('Right now'));
  assert.equal(frame.querySelector('.cora-report-section__scope'), null);
});

test("Right now comes before the report's own sections", () => {
  const frame = ReportFrame(
    props({
      content: {
        kpis: [KPI],
        sections: [{ id: 'main', title: 'Queues', panels: [panel('a')] }],
      },
    })
  );

  assert.deepEqual(headings(frame), [
    'Complaints',
    'Right now',
    'Queues',
    'Panel a',
  ]);
});

test('a section can say what it covers', () => {
  const frame = ReportFrame(
    props({
      content: {
        sections: [
          {
            id: 's',
            title: 'Trends',
            scope: 'Last 12 weeks',
            panels: [panel('a')],
          },
        ],
      },
    })
  );

  assert.equal(
    textContent(frame.querySelector('.cora-report-section__scope')),
    'Last 12 weeks'
  );
});

test('the rail layout puts the header, banner and headline figures in a side rail', () => {
  const frame = ReportFrame(
    props({
      layout: 'rail',
      width: 1360,
      banner: 'Late data',
      content: {
        kpis: [KPI],
        sections: [{ id: 'main', title: 'Queues', panels: [panel('a')] }],
      },
    })
  );

  const rail = getByTag(frame, 'aside');
  assert.ok(getByRole(rail, 'banner'));
  assert.equal(textContent(getByRole(rail, 'status')), 'Late data');
  assert.ok(getByRole(rail, 'heading', { name: 'Right now' }));
  assert.ok(rail.querySelector('.cora-report-kpis--stacked'));
  assert.equal(
    textContent(rail.querySelector('.cora-report-section__scope')),
    'As at close of Tue 6 Oct'
  );
  assert.equal(
    queryByRole(frame.querySelector('.cora-report__main'), 'heading', {
      name: 'Right now',
    }),
    null
  );
});

test('the rail has no Right now block when there are no headline figures', () => {
  const frame = ReportFrame(
    props({ layout: 'rail', width: 1360, completeThrough: null })
  );

  const rail = getByTag(frame, 'aside');
  assert.equal(queryByRole(rail, 'heading', { name: 'Right now' }), null);
  assert.ok(getByRole(rail, 'banner'));
});

test('the rail Right now block omits the day when the report states none', () => {
  const frame = ReportFrame(
    props({
      layout: 'rail',
      width: 1360,
      completeThrough: null,
      content: { kpis: [KPI], sections: [] },
    })
  );

  assert.equal(frame.querySelector('.cora-report-section__scope'), null);
});

test('in the rail layout, snapshot panels and sections fill the main column', () => {
  const frame = ReportFrame(
    props({
      layout: 'rail',
      width: 1360,
      content: {
        kpis: [KPI],
        now: [panel('snap')],
        sections: [{ id: 'main', title: 'Queues', panels: [panel('a')] }],
      },
    })
  );

  const main = frame.querySelector('.cora-report__main');
  assert.deepEqual(headings(main), ['Panel snap', 'Queues', 'Panel a']);
  assert.equal(queryByTag(main, 'aside'), null);
});

test('the rail layout folds into the stacked layout on a page too narrow for it', () => {
  const props899 = props({
    layout: 'rail',
    width: 899,
    content: { kpis: [KPI], sections: [] },
  });
  const props900 = { ...props899, width: 900 };

  const narrow = ReportFrame(props899);
  const wide = ReportFrame(props900);

  assert.equal(queryByTag(narrow, 'aside'), null);
  assert.match(narrow.className, /--stacked/);
  assert.ok(getByTag(wide, 'aside'));
  assert.match(wide.className, /--rail/);
});

test('the stacked layout stays stacked however wide the page', () => {
  const frame = ReportFrame(props({ layout: 'stacked', width: 2000 }));

  assert.equal(queryByTag(frame, 'aside'), null);
  assert.match(frame.className, /--stacked/);
});

test("a panel is drawn at the width its columns allow, less the panel's own padding", () => {
  const frame = ReportFrame(
    props({
      width: 1088,
      content: {
        sections: [
          {
            id: 's',
            title: 'S',
            panels: [
              panel('full'),
              panel('half', { span: 6 }),
              panel('quarter', { span: 3 }),
            ],
          },
        ],
      },
    })
  );

  assert.equal(widthOf(frame, 'full'), 1088 - 30);
  assert.equal(widthOf(frame, 'half'), 76 * 6 + 16 * 5 - 30);
  assert.equal(widthOf(frame, 'quarter'), 76 * 3 + 16 * 2 - 30);
  assert.match(spanOf(frame, 'half'), /span-6$/);
  assert.match(spanOf(frame, 'full'), /span-12$/);
});

test('in the rail layout, panels are sized to the main column beside the rail', () => {
  const frame = ReportFrame(
    props({
      layout: 'rail',
      width: 1088 + 248 + 24,
      content: {
        sections: [{ id: 's', title: 'S', panels: [panel('full')] }],
      },
    })
  );

  assert.equal(widthOf(frame, 'full'), 1088 - 30);
});

test('below 640px every panel takes the whole row', () => {
  const frame = ReportFrame(
    props({
      width: 632,
      content: {
        sections: [
          { id: 's', title: 'S', panels: [panel('half', { span: 6 })] },
        ],
      },
    })
  );

  assert.match(spanOf(frame, 'half'), /span-12$/);
  assert.equal(widthOf(frame, 'half'), 632 - 30);
});

test('a rail page just wide enough for the rail leaves a main column too narrow for side-by-side panels', () => {
  const frame = ReportFrame(
    props({
      layout: 'rail',
      width: 900,
      content: {
        sections: [
          { id: 's', title: 'S', panels: [panel('half', { span: 6 })] },
        ],
      },
    })
  );

  assert.match(getByTag(frame, 'aside').className, /rail/);
  assert.match(spanOf(frame, 'half'), /span-12$/);
});

test('a chart is never drawn narrower than a readable minimum', () => {
  const frame = ReportFrame(props({ width: 100 }));

  assert.equal(widthOf(frame, 'a'), 160);
});

test('a section shows each filter it names as a group with one option pressed', () => {
  const frame = ReportFrame(
    props({
      filterSpecs: FILTERS,
      filters: { range: 'month' },
      content: {
        sections: [
          { id: 's', title: 'S', filters: ['range'], panels: [panel('a')] },
        ],
      },
    })
  );

  const group = getByRole(frame, 'group', { name: 'Date range' });
  const options = queryAllByRole(group, 'button');
  assert.deepEqual(
    options.map((option) => [
      textContent(option),
      option.getAttribute('aria-pressed'),
    ]),
    [
      ['Last 7 days', 'false'],
      ['Last 30 days', 'true'],
    ]
  );
});

test('a filter whose value is not an option leaves every option unpressed', () => {
  const frame = ReportFrame(
    props({
      filterSpecs: FILTERS,
      filters: {},
      content: {
        sections: [
          { id: 's', title: 'S', filters: ['range'], panels: [panel('a')] },
        ],
      },
    })
  );

  for (const option of queryAllByRole(frame, 'button')) {
    assert.equal(option.getAttribute('aria-pressed'), 'false');
  }
});

test('choosing a filter option reports the filter and the option', () => {
  /** @type {[string, string][]} */
  const chosen = [];
  const frame = ReportFrame(
    props({
      filterSpecs: FILTERS,
      filters: { range: 'week' },
      onFilter: (name, key) => chosen.push([name, key]),
      content: {
        sections: [
          { id: 's', title: 'S', filters: ['range'], panels: [panel('a')] },
        ],
      },
    })
  );

  fireEvent(getByRole(frame, 'button', { name: 'Last 30 days' }), 'click');

  assert.deepEqual(chosen, [['range', 'month']]);
});

test('a section that names no filters draws no filter controls', () => {
  const frame = ReportFrame(props({ filterSpecs: FILTERS }));

  assert.equal(queryByRole(frame, 'group'), null);
});

test('a section naming a filter the report never declared is refused', () => {
  const draw = () =>
    ReportFrame(
      props({
        content: {
          sections: [
            { id: 's', title: 'S', filters: ['cohort'], panels: [panel('a')] },
          ],
        },
      })
    );

  assert.throws(draw, {
    name: 'TypeError',
    message: /undeclared filter: cohort/,
  });
});

test('a panel shows its table when the engine lists it, and the chart otherwise', () => {
  const table = {
    columns: [{ key: 'n', label: 'Count', value: 'n' }],
    rows: [{ n: 3 }],
    rowKey: (/** @type {{ n: number }} */ row) => String(row.n),
  };
  const content = {
    sections: [
      {
        id: 's',
        title: 'S',
        panels: [panel('a', { table }), panel('b', { table })],
      },
    ],
  };

  const frame = ReportFrame(props({ content, tables: ['b'] }));

  assert.equal(queryAllByTag(frame, 'table').length, 1);
  assert.ok(widthOf(frame, 'a') > 0);
  assert.throws(() => widthOf(frame, 'b'));
});

test("toggling a panel table and sorting it are reported with the panel's id", () => {
  /** @type {string[]} */
  const toggled = [];
  /** @type {[string, string][]} */
  const sorted = [];
  const table = {
    columns: [{ key: 'n', label: 'Count', value: 'n' }],
    rows: [{ n: 3 }, { n: 1 }],
    rowKey: (/** @type {{ n: number }} */ row) => String(row.n),
  };
  const frame = ReportFrame(
    props({
      tables: ['a'],
      onToggleTable: (id) => toggled.push(id),
      onSort: (id, key) => sorted.push([id, key]),
      content: {
        sections: [{ id: 's', title: 'S', panels: [panel('a', { table })] }],
      },
    })
  );

  fireEvent(getByRole(frame, 'button', { name: 'Chart' }), 'click');
  fireEvent(getByRole(frame, 'button', { name: 'Count' }), 'click');

  assert.deepEqual(toggled, ['a']);
  assert.deepEqual(sorted, [['a', 'n']]);
});

test('each panel table is ordered by the sort held for that panel alone', () => {
  const table = {
    columns: [{ key: 'n', label: 'Count', value: 'n' }],
    rows: [{ n: 2 }, { n: 9 }, { n: 5 }],
    rowKey: (/** @type {{ n: number }} */ row) => String(row.n),
  };
  const frame = ReportFrame(
    props({
      tables: ['a', 'b'],
      sorts: { a: { key: 'n', dir: 'desc' } },
      content: {
        sections: [
          {
            id: 's',
            title: 'S',
            panels: [panel('a', { table }), panel('b', { table })],
          },
        ],
      },
    })
  );

  const [sortedPanel, unsortedPanel] = queryAllByTag(frame, 'tbody').map(
    (body) => queryAllByTag(body, 'td').map(textContent)
  );
  assert.deepEqual(sortedPanel, ['9', '5', '2']);
  assert.deepEqual(unsortedPanel, ['2', '9', '5']);
});
