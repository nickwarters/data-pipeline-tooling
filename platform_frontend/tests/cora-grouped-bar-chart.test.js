// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, walk } from './_dom-stub.js';

installDom();

const { GroupedBarChart } =
  await import('../src/components/base/cora-grouped-bar-chart.js');
const { render } = await import('../src/core/render.js');

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** @type {import('../src/components/base/cora-grouped-bar-chart.js').GroupedBarChartData} */
const data = {
  groups: [
    {
      key: 'week-one',
      label: 'Week <one>',
      marks: [
        { key: 'settled', label: 'Settled', value: 8, tone: 'success' },
        {
          key: 'provisional',
          label: 'Provisional',
          value: 4,
          provisional: true,
          tone: 'warning',
        },
      ],
    },
    {
      key: 'week-two',
      label: 'Week two',
      marks: [{ key: 'settled', label: 'Settled', value: 2, tone: 'success' }],
    },
  ],
};

/** @type {import('../src/components/base/cora-grouped-bar-chart.js').GroupedBarChartConfig} */
const config = {
  width: 360,
  height: 280,
  ariaLabel: 'Review counts',
  margin: { top: 20, right: 20, bottom: 52, left: 48 },
  yMax: 10,
  tickCount: 3,
  xAxisLabel: 'Period',
  yAxisLabel: 'Cases',
  formatValue: (value) => `${value} cases`,
  formatGroupLabel: (label) => `Group: ${label}`,
};

/** @param {any} root @param {string} selector */
function all(root, selector) {
  if (selector.startsWith('.')) {
    const wanted = selector.slice(1);
    /** @type {any[]} */
    const matches = [];
    walk(root, (node) => {
      if (node.getAttribute('class')?.split(/\s+/).includes(wanted)) {
        matches.push(node);
      }
    });
    return matches;
  }
  return [...root.querySelectorAll(selector)];
}

/** @param {any} root */
function bars(root) {
  return all(root, '.cora-grouped-bar-chart__bar');
}

/** @param {any} root @param {string} key */
function keyed(root, key) {
  return root.childNodes.find(
    (/** @type {any} */ child) => child.getAttribute?.('key') === key
  );
}

/** @param {any} node @param {string} attribute */
function numberAttribute(node, attribute) {
  return Number(node.getAttribute(attribute));
}

test('GroupedBarChart returns a detached, named SVG tree', () => {
  const root = GroupedBarChart({ data, config });

  assert.equal(root.namespaceURI, SVG_NAMESPACE);
  assert.equal(root.tagName, 'svg');
  assert.equal(root.getAttribute('viewBox'), '0 0 360 280');
  assert.equal(root.getAttribute('width'), '360');
  assert.equal(root.getAttribute('height'), '280');
  assert.equal(root.getAttribute('role'), 'group');
  assert.equal(root.getAttribute('aria-label'), 'Review counts');
  assert.equal(root.parentNode, null);
  assert.equal(
    all(root, 'svg').every((node) => node.namespaceURI === SVG_NAMESPACE),
    true
  );
});

test('GroupedBarChart lays out grouped bars, axes, legend, and value labels', () => {
  const root = GroupedBarChart({ data, config });
  const groupNodes = all(root, '.cora-grouped-bar-chart__group');
  const barNodes = bars(root);

  assert.equal(groupNodes.length, 2);
  assert.equal(barNodes.length, 3);
  assert.equal(all(root, '.cora-grouped-bar-chart__y-tick').length, 3);
  assert.equal(all(root, '.cora-grouped-bar-chart__x-tick').length, 2);
  assert.equal(all(root, '.cora-grouped-bar-chart__group-label').length, 2);
  assert.equal(all(root, '.cora-grouped-bar-chart__value-label').length, 3);
  assert.equal(all(root, '.cora-grouped-bar-chart__legend-item').length, 2);
  assert.equal(all(root, '.cora-grouped-bar-chart__grid-line').length, 3);
  assert.equal(all(root, '.cora-grouped-bar-chart__tick-line').length, 2);
  assert.deepEqual(
    Array.from(root.childNodes, (/** @type {any} */ child) =>
      child.getAttribute('class')
    ),
    [
      'cora-grouped-bar-chart__legend',
      'cora-grouped-bar-chart__y-axis',
      'cora-grouped-bar-chart__bars',
      'cora-grouped-bar-chart__x-axis',
    ]
  );
  assert.equal(
    all(root, '.cora-grouped-bar-chart__x-axis-label')[0].textContent,
    'Period'
  );
  assert.equal(
    all(root, '.cora-grouped-bar-chart__y-axis-label')[0].textContent,
    'Cases'
  );

  const firstGroupBars = bars(groupNodes[0]);
  assert.notEqual(
    numberAttribute(firstGroupBars[0], 'x'),
    numberAttribute(firstGroupBars[1], 'x')
  );
  const settledBar = firstGroupBars.find(
    (bar) => bar.getAttribute('fill') === 'var(--cora-color-success)'
  );
  assert.equal(settledBar?.getAttribute('stroke'), 'var(--cora-color-success)');
  assert.equal(
    all(root, '.cora-grouped-bar-chart__value-label')[0].textContent,
    '8 cases'
  );
  assert.equal(
    all(root, '.cora-grouped-bar-chart__group-label')[0].textContent,
    'Group: Week <one>'
  );
  assert.equal(
    new Set(
      all(root, '.cora-grouped-bar-chart__group-label').map(
        (label) => label.textContent
      )
    ).size,
    2
  );
});

test('x-axis selection is bounded and does not render duplicate labels', () => {
  const groups = Array.from({ length: 62 }, (_, index) => ({
    key: `day-${index + 1}`,
    label: `Day ${index + 1}`,
    marks: [{ key: 'settled', label: 'Settled', value: index }],
  }));
  const daily = GroupedBarChart({
    data: { groups },
    config: { width: 900, height: 280, ariaLabel: 'Daily review counts' },
  });

  assert.equal(all(daily, '.cora-grouped-bar-chart__x-tick').length, 12);
  assert.equal(all(daily, '.cora-grouped-bar-chart__group-label').length, 12);
  assert.equal(
    all(daily, '.cora-grouped-bar-chart__group-label')[0].textContent,
    'Day 1'
  );
  assert.equal(
    all(daily, '.cora-grouped-bar-chart__group-label').at(-1).textContent,
    'Day 62'
  );

  const repeated = GroupedBarChart({
    data: {
      groups: ['Mon', 'Mon', 'Tue', 'Tue', 'Wed', 'Wed'].map(
        (label, index) => ({
          key: `group-${index}`,
          label,
          marks: [],
        })
      ),
    },
    config: { width: 360, height: 220, ariaLabel: 'Repeated labels' },
  });
  const labels = all(repeated, '.cora-grouped-bar-chart__group-label').map(
    (label) => label.textContent
  );
  assert.deepEqual(labels, ['Mon', 'Tue', 'Wed']);
});

test('series slots are sorted by key and remain stable for sparse marks', () => {
  const sparse = GroupedBarChart({
    data: {
      groups: [
        {
          key: 'first',
          label: 'First',
          marks: [
            { key: 'beta', label: 'Beta', value: 6 },
            { key: 'alpha', label: 'Alpha', value: 4 },
          ],
        },
        {
          key: 'second',
          label: 'Second',
          marks: [{ key: 'beta', label: 'Beta', value: 5 }],
        },
        {
          key: 'third',
          label: 'Third',
          marks: [
            { key: 'alpha', label: 'Alpha', value: 2 },
            { key: 'beta', label: 'Beta', value: 3 },
          ],
        },
      ],
    },
    config: {
      width: 360,
      height: 240,
      ariaLabel: 'Sparse series',
      tickCount: 2,
    },
  });
  const groups = all(sparse, '.cora-grouped-bar-chart__group');
  const secondBars = bars(groups[1]);
  const thirdBars = bars(groups[2]);
  const alphaOffset = numberAttribute(bars(keyed(groups[0], 'alpha'))[0], 'x');
  const betaOffset = numberAttribute(bars(keyed(groups[0], 'beta'))[0], 'x');

  assert.equal(
    all(sparse, '.cora-grouped-bar-chart__legend-label')[0].textContent,
    'Alpha'
  );
  assert.equal(
    all(sparse, '.cora-grouped-bar-chart__legend-label')[1].textContent,
    'Beta'
  );
  const groupBand = (360 - 52 - 20) / 3;
  assert.equal(numberAttribute(secondBars[0], 'x') - groupBand, betaOffset);
  assert.equal(numberAttribute(thirdBars[0], 'x') - groupBand * 2, alphaOffset);
  assert.equal(numberAttribute(thirdBars[1], 'x') - groupBand * 2, betaOffset);
});

test('seriesOrder keeps a preferred status order ahead of alphabetical order', () => {
  const ordered = GroupedBarChart({
    data: {
      groups: [
        {
          key: 'one',
          label: 'One',
          marks: [
            { key: 'pending', label: 'Pending', value: 2 },
            { key: 'completed', label: 'Completed', value: 4 },
          ],
        },
      ],
    },
    config: {
      width: 320,
      height: 240,
      ariaLabel: 'Completion counts',
      seriesOrder: ['completed', 'pending'],
    },
  });

  assert.deepEqual(
    all(ordered, '.cora-grouped-bar-chart__legend-label').map(
      (label) => label.textContent
    ),
    ['Completed', 'Pending']
  );
  const [pending, completed] = bars(
    all(ordered, '.cora-grouped-bar-chart__group')[0]
  );
  assert.ok(numberAttribute(completed, 'x') < numberAttribute(pending, 'x'));
});

test('legend and value-label bands stay above the plot with zero top margin', () => {
  const chartData = {
    groups: [
      {
        key: 'one',
        label: 'One',
        marks: [{ key: 'count', label: 'Count', value: 10 }],
      },
    ],
  };
  for (const margin of [
    undefined,
    { top: 0, right: 16, bottom: 52, left: 48 },
  ]) {
    const root = GroupedBarChart({
      data: chartData,
      config: {
        width: 220,
        height: 220,
        ariaLabel: 'Bands',
        ...(margin ? { margin } : {}),
      },
    });
    const legendLabel = all(root, '.cora-grouped-bar-chart__legend-label')[0];
    const valueLabel = all(root, '.cora-grouped-bar-chart__value-label')[0];
    const bar = bars(root)[0];
    assert.ok(
      numberAttribute(valueLabel, 'y') > numberAttribute(legendLabel, 'y')
    );
    assert.ok(numberAttribute(bar, 'y') > numberAttribute(legendLabel, 'y'));
    assert.ok(numberAttribute(valueLabel, 'y') < numberAttribute(bar, 'y'));
  }
});

test('zero axis margins are raised enough to keep labels inside the viewBox', () => {
  const root = GroupedBarChart({
    data: {
      groups: [
        {
          key: 'one',
          label: 'One',
          marks: [{ key: 'count', label: 'Count', value: 10 }],
        },
      ],
    },
    config: {
      width: 220,
      height: 220,
      ariaLabel: 'Safe margins',
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      xAxisLabel: 'Period',
      yAxisLabel: 'Count',
    },
  });

  assert.ok(
    numberAttribute(
      all(root, '.cora-grouped-bar-chart__group-label')[0],
      'y'
    ) <= 220
  );
  assert.ok(
    numberAttribute(
      all(root, '.cora-grouped-bar-chart__x-axis-label')[0],
      'y'
    ) <= 220
  );
  assert.ok(
    numberAttribute(all(root, '.cora-grouped-bar-chart__tick-label')[0], 'x') >=
      0
  );
});

test('legend labels wrap into rows, retain full accessible names, and reject overflow', () => {
  const labels = [
    'A very long settled series',
    'Another long provisional series',
    'A third long series',
  ];
  const root = GroupedBarChart({
    data: {
      groups: [
        {
          key: 'one',
          label: 'One',
          marks: labels.map((label, index) => ({
            key: `series-${index}`,
            label,
            value: index + 1,
          })),
        },
      ],
    },
    config: { width: 220, height: 320, ariaLabel: 'Long series' },
  });
  const items = all(root, '.cora-grouped-bar-chart__legend-item');
  const visibleLabels = all(root, '.cora-grouped-bar-chart__legend-label');

  assert.equal(items.length, labels.length);
  assert.ok(visibleLabels.some((label) => label.textContent.endsWith('…')));
  assert.deepEqual(
    items.map((item) => item.getAttribute('aria-label')),
    labels
  );
  assert.ok(
    numberAttribute(visibleLabels[1], 'y') >
      numberAttribute(visibleLabels[0], 'y')
  );

  const tooMany = Array.from({ length: 20 }, (_, index) => ({
    key: `series-${index}`,
    label: `Series ${index}`,
    value: 1,
  }));
  assert.throws(
    () =>
      GroupedBarChart({
        data: { groups: [{ key: 'one', label: 'One', marks: tooMany }] },
        config: { width: 220, height: 320, ariaLabel: 'Too many series' },
      }),
    /20 series.*20 legend rows/
  );
});

test('default formatting keeps subunit values nonzero and constant domains useful', () => {
  const subunit = GroupedBarChart({
    data: {
      groups: [
        {
          key: 'tiny',
          label: 'Tiny',
          marks: [{ key: 'rate', label: 'Rate', value: 0.004 }],
        },
      ],
    },
    config: { width: 240, height: 220, ariaLabel: 'Tiny values' },
  });
  const subunitLabels = all(subunit, '.cora-grouped-bar-chart__tick-label').map(
    (label) => label.textContent
  );
  assert.ok(subunitLabels.includes('0.001'));
  assert.equal(
    all(subunit, '.cora-grouped-bar-chart__value-label')[0].textContent,
    '0.004'
  );
  assert.notEqual(
    all(subunit, '.cora-grouped-bar-chart__value-label')[0].textContent,
    '0'
  );

  const constant = GroupedBarChart({
    data: {
      groups: [
        {
          key: 'constant',
          label: 'Constant',
          marks: [{ key: 'count', label: 'Count', value: 3.333 }],
        },
      ],
    },
    config: { width: 240, height: 220, ariaLabel: 'Constant values' },
  });
  assert.equal(
    all(constant, '.cora-grouped-bar-chart__value-label')[0].textContent,
    '3.33'
  );
  assert.equal(
    all(constant, '.cora-grouped-bar-chart__tick-label').at(-1).textContent,
    '4'
  );
  assert.ok(numberAttribute(bars(constant)[0], 'height') > 0);
});

test('finite extreme values keep the derived domain and SVG geometry finite', () => {
  const root = GroupedBarChart({
    data: {
      groups: [
        {
          key: 'extreme',
          label: 'Extreme',
          marks: [{ key: 'count', label: 'Count', value: Number.MAX_VALUE }],
        },
      ],
    },
    config: { width: 240, height: 220, ariaLabel: 'Extreme values' },
  });

  const numericAttributes = [
    ...all(root, '.cora-grouped-bar-chart__bar'),
    ...all(root, '.cora-grouped-bar-chart__y-tick'),
  ].flatMap((node) =>
    ['x', 'y', 'width', 'height'].flatMap((attribute) => {
      const value = node.getAttribute(attribute);
      return value === null ? [] : [Number(value)];
    })
  );
  assert.ok(numericAttributes.every(Number.isFinite));
});

test('all-zero and empty data use finite positive geometry', () => {
  const empty = GroupedBarChart({
    data: { groups: [] },
    config: { width: 200, height: 160, ariaLabel: 'Empty chart' },
  });
  const zero = GroupedBarChart({
    data: {
      groups: [
        {
          key: 'zero',
          label: 'Zero',
          marks: [{ key: 'count', label: 'Count', value: 0 }],
        },
      ],
    },
    config: { width: 200, height: 160, ariaLabel: 'Zero chart' },
  });

  assert.equal(bars(empty).length, 0);
  assert.equal(bars(zero).length, 1);
  assert.equal(bars(zero)[0].getAttribute('height'), '0');
  assert.equal(all(zero, '.cora-grouped-bar-chart__tick-label').length, 5);
  assert.equal(
    all(zero, '.cora-grouped-bar-chart__tick-label').at(-1).textContent,
    '1'
  );
  for (const bar of bars(zero)) {
    assert.equal(Number.isFinite(numberAttribute(bar, 'y')), true);
  }
});

test('each mark carries its own accessible identity and provisional hollow encoding', () => {
  const root = GroupedBarChart({ data, config });
  const provisional = all(root, '.cora-grouped-bar-chart__bar--provisional')[0];
  /** @type {any[]} */
  const markTitles = [];
  /** @type {any[]} */
  const legendTitles = [];
  walk(provisional, (node) => {
    if (node.tagName === 'title') markTitles.push(node);
  });
  walk(/** @type {any} */ (root), (node) => {
    if (node.tagName === 'title') legendTitles.push(node);
  });

  assert.ok(provisional);
  assert.equal(provisional.getAttribute('role'), 'img');
  assert.equal(provisional.getAttribute('data-cora-chart-mark'), 'true');
  assert.equal(
    provisional.getAttribute('data-cora-chart-description'),
    'Group: Week <one>: Provisional, 4 cases, provisional'
  );
  assert.equal(provisional.getAttribute('tabindex'), '0');
  assert.equal(provisional.getAttribute('fill'), 'none');
  assert.equal(provisional.getAttribute('stroke'), 'var(--cora-color-warning)');
  assert.equal(provisional.getAttribute('stroke-width'), '2');
  assert.equal(
    provisional.getAttribute('aria-label'),
    'Group: Week <one>: Provisional, 4 cases, provisional'
  );
  assert.equal(markTitles.length, 0);
  assert.equal(legendTitles.length, 2);
  assert.deepEqual(
    legendTitles.map((title) => title.textContent),
    ['Provisional', 'Settled']
  );
  assert.equal(provisional.querySelector('script'), null);
});

test('provisional metadata can use a solid theme-colored bar', () => {
  const root = GroupedBarChart({
    data: {
      groups: [
        {
          key: 'one',
          label: 'One',
          marks: [
            {
              key: 'pending',
              label: 'Pending',
              value: 2,
              provisional: true,
              hollow: false,
              tone: 'danger',
            },
          ],
        },
      ],
    },
    config: { width: 240, height: 220, ariaLabel: 'Pending counts' },
  });
  const pending = bars(root)[0];

  assert.equal(pending.getAttribute('fill'), 'var(--cora-color-danger)');
  assert.equal(pending.getAttribute('stroke-width'), '1');
  assert.match(pending.getAttribute('aria-label'), /provisional/);
  assert.equal(
    pending.getAttribute('class'),
    'cora-grouped-bar-chart__bar cora-grouped-bar-chart__bar--provisional'
  );
});

test('repeated mark keys must keep one label and tone identity', () => {
  assert.throws(
    () =>
      GroupedBarChart({
        data: {
          groups: [
            {
              key: 'one',
              label: 'One',
              marks: [
                { key: 'count', label: 'Count', value: 1, tone: 'success' },
              ],
            },
            {
              key: 'two',
              label: 'Two',
              marks: [
                {
                  key: 'count',
                  label: 'Other count',
                  value: 2,
                  tone: 'success',
                },
              ],
            },
          ],
        },
        config: { width: 240, height: 220, ariaLabel: 'Conflict' },
      }),
    /series identity.*count/i
  );
  assert.throws(
    () =>
      GroupedBarChart({
        data: {
          groups: [
            {
              key: 'one',
              label: 'One',
              marks: [{ key: 'count', label: 'Count', value: 1 }],
            },
            {
              key: 'two',
              label: 'Two',
              marks: [
                { key: 'count', label: 'Count', value: 2, tone: 'danger' },
              ],
            },
          ],
        },
        config: { width: 240, height: 220, ariaLabel: 'Tone conflict' },
      }),
    /series identity.*count/i
  );
});

test('formatters and custom labels must produce usable text', () => {
  const valid = {
    data: {
      groups: [
        {
          key: 'one',
          label: 'One',
          marks: [{ key: 'count', label: 'Count', value: 1 }],
        },
      ],
    },
    config: { width: 200, height: 180, ariaLabel: 'Valid' },
  };

  assert.throws(
    () =>
      GroupedBarChart(
        /** @type {any} */ ({
          ...valid,
          config: { ...valid.config, formatValue: 'bad' },
        })
      ),
    /formatValue/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        ...valid,
        config: { ...valid.config, formatValue: () => ' ' },
      }),
    /non-empty/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        ...valid,
        config: {
          ...valid.config,
          formatValue: (value) => String(Math.round(value)),
        },
      }),
    /tickCount.*yMax.*distinct labels/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        ...valid,
        config: { ...valid.config, formatGroupLabel: () => '' },
      }),
    /formatGroupLabel.*non-empty/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        ...valid,
        config: { ...valid.config, xAxisLabel: '' },
      }),
    /xAxisLabel/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        ...valid,
        config: { ...valid.config, yAxisLabel: '' },
      }),
    /yAxisLabel/
  );
});

test('data and geometry validation rejects ambiguous or impossible input', () => {
  const valid = {
    data: { groups: [] },
    config: { width: 100, height: 100, ariaLabel: 'Chart' },
  };
  /** @type {Array<[any, RegExp]>} */
  const invalid = [
    [{ ...valid, config: { ...valid.config, width: 0 } }, /width/],
    [{ ...valid, config: { ...valid.config, height: Number.NaN } }, /height/],
    [{ ...valid, config: { ...valid.config, yMax: 0 } }, /yMax/],
    [
      {
        data: {
          groups: [
            {
              key: 'one',
              label: 'One',
              marks: [{ key: 'count', label: 'Count', value: 2 }],
            },
          ],
        },
        config: { ...valid.config, yMax: 1 },
      },
      /yMax/,
    ],
    [{ ...valid, config: { ...valid.config, tickCount: 1 } }, /tickCount/],
    [
      {
        ...valid,
        config: { ...valid.config, margin: { left: 100, right: 1 } },
      },
      /plot area/,
    ],
  ];
  for (const [input, message] of invalid) {
    assert.throws(() => GroupedBarChart(input), message);
  }

  /** @type {Array<[any, RegExp]>} */
  const badData = [
    [{ groups: [{ key: '', label: 'One', marks: [] }] }, /group.key/],
    [{ groups: [{ key: 'one', label: '', marks: [] }] }, /group.label/],
    [
      {
        groups: [
          {
            key: 'one',
            label: 'One',
            marks: [{ key: '', label: 'Count', value: 1 }],
          },
        ],
      },
      /mark.key/,
    ],
    [
      {
        groups: [
          {
            key: 'one',
            label: 'One',
            marks: [{ key: 'count', label: '', value: 1 }],
          },
        ],
      },
      /mark.label/,
    ],
    [
      {
        groups: [
          {
            key: 'one',
            label: 'One',
            marks: [{ key: 'count', label: 'Count', value: -1 }],
          },
        ],
      },
      /non-negative/,
    ],
    [
      {
        groups: [
          {
            key: 'one',
            label: 'One',
            marks: [{ key: 'count', label: 'Count', value: Infinity }],
          },
        ],
      },
      /finite/,
    ],
    [
      {
        groups: [
          {
            key: 'one',
            label: 'One',
            marks: [
              {
                key: 'count',
                label: 'Count',
                value: 1,
                tone: /** @type {any} */ ('purple'),
              },
            ],
          },
        ],
      },
      /tone/,
    ],
    [
      {
        groups: [
          { key: 'one', label: 'One', marks: [] },
          { key: 'one', label: 'Other', marks: [] },
        ],
      },
      /group.key.*unique/,
    ],
    [
      {
        groups: [
          {
            key: 'one',
            label: 'One',
            marks: [
              { key: 'count', label: 'Count', value: 1 },
              { key: 'count', label: 'Count', value: 2 },
            ],
          },
        ],
      },
      /mark.key.*unique/,
    ],
  ];
  for (const [input, message] of badData) {
    assert.throws(
      () => GroupedBarChart({ data: input, config: valid.config }),
      message
    );
  }
});

test('GroupedBarChart does not mutate caller data or config and keyed render keeps groups', () => {
  const inputData = structuredClone(data);
  const inputConfig = { ...config, margin: { ...config.margin } };
  const beforeData = structuredClone(inputData);
  const beforeConfig = { ...inputConfig, margin: { ...inputConfig.margin } };
  GroupedBarChart({ data: inputData, config: inputConfig });
  assert.deepEqual(inputData, beforeData);
  assert.deepEqual(inputConfig, beforeConfig);

  const container = document.createElement('div');
  render(container, GroupedBarChart({ data, config }));
  const firstGroups = all(container, '.cora-grouped-bar-chart__group');
  const firstBars = bars(container);
  const firstSettled = keyed(firstGroups[0], 'settled');
  const reordered = {
    groups: [data.groups[1], data.groups[0]],
  };
  render(container, GroupedBarChart({ data: reordered, config }));
  const nextGroups = all(container, '.cora-grouped-bar-chart__group');
  assert.equal(nextGroups[0], firstGroups[1]);
  assert.equal(nextGroups[1], firstGroups[0]);
  assert.equal(keyed(nextGroups[1], 'settled'), firstSettled);
  assert.equal(bars(container).includes(firstBars[0]), true);
});
