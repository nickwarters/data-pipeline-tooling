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
      marks: [
        {
          key: 'settled',
          label: 'Other settled',
          value: 2,
          tone: 'danger',
        },
      ],
    },
  ],
};

/** @type {import('../src/components/base/cora-grouped-bar-chart.js').GroupedBarChartConfig} */
const config = {
  width: 360,
  height: 240,
  ariaLabel: 'Review counts',
  margin: { top: 20, right: 20, bottom: 48, left: 48 },
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

test('GroupedBarChart returns a detached SVG tree with accessible named root', () => {
  const root = GroupedBarChart({ data, config });

  assert.equal(root.namespaceURI, SVG_NAMESPACE);
  assert.equal(root.tagName, 'svg');
  assert.equal(root.getAttribute('viewBox'), '0 0 360 240');
  assert.equal(root.getAttribute('width'), '360');
  assert.equal(root.getAttribute('height'), '240');
  assert.equal(root.getAttribute('role'), 'group');
  assert.equal(root.getAttribute('aria-label'), 'Review counts');
  assert.equal(root.parentNode, null);
  assert.equal(
    all(root, 'svg').every((node) => node.namespaceURI === SVG_NAMESPACE),
    true
  );
});

test('GroupedBarChart lays out grouped side-by-side bars, axes, ticks, and labels', () => {
  const root = GroupedBarChart({ data, config });
  const groupNodes = all(root, '.cora-grouped-bar-chart__group');
  const barNodes = bars(root);

  assert.equal(groupNodes.length, 2);
  assert.equal(barNodes.length, 3);
  assert.equal(all(root, '.cora-grouped-bar-chart__y-tick').length, 3);
  assert.equal(all(root, '.cora-grouped-bar-chart__x-tick').length, 2);
  assert.equal(all(root, '.cora-grouped-bar-chart__group-label').length, 2);
  assert.equal(all(root, '.cora-grouped-bar-chart__value-label').length, 3);
  assert.equal(
    all(root, '.cora-grouped-bar-chart__x-axis-label')[0].textContent,
    'Period'
  );
  assert.equal(
    all(root, '.cora-grouped-bar-chart__y-axis-label')[0].textContent,
    'Cases'
  );

  const firstGroupBars = all(groupNodes[0], '.cora-grouped-bar-chart__bar');
  assert.ok(
    Number(firstGroupBars[0].getAttribute('x')) <
      Number(firstGroupBars[1].getAttribute('x'))
  );
  assert.equal(firstGroupBars[0].getAttribute('height'), '118.4');
  assert.equal(firstGroupBars[1].getAttribute('height'), '59.2');
  assert.equal(firstGroupBars[0].getAttribute('y'), '73.6');
  assert.equal(
    firstGroupBars[0].getAttribute('fill'),
    'var(--cora-color-success)'
  );
  assert.equal(
    firstGroupBars[0].getAttribute('stroke'),
    'var(--cora-color-success)'
  );
  assert.equal(
    all(root, '.cora-grouped-bar-chart__value-label')[0].textContent,
    '8 cases'
  );
  assert.equal(
    all(root, '.cora-grouped-bar-chart__group-label')[0].textContent,
    'Group: Week <one>'
  );
  assert.equal(
    all(root, '.cora-grouped-bar-chart__x-tick').every(
      (tick) => all(tick, '.cora-grouped-bar-chart__tick-label').length === 0
    ),
    true
  );
});

test('GroupedBarChart sparsifies visible x ticks and keeps one group-label layer', () => {
  const groups = Array.from({ length: 62 }, (_, index) => ({
    key: `day-${index + 1}`,
    label: `Day ${index + 1}`,
    marks: [{ key: 'settled', label: 'Settled', value: index }],
  }));
  const root = GroupedBarChart({
    data: { groups },
    config: { width: 900, height: 240, ariaLabel: 'Daily review counts' },
  });

  assert.equal(all(root, '.cora-grouped-bar-chart__x-tick').length, 12);
  assert.equal(all(root, '.cora-grouped-bar-chart__group-label').length, 12);
  assert.equal(all(root, '.cora-grouped-bar-chart__group-labels').length, 1);
  assert.equal(
    all(root, '.cora-grouped-bar-chart__group-label')[0].textContent,
    'Day 1'
  );
  assert.equal(
    all(root, '.cora-grouped-bar-chart__group-label').at(-1).textContent,
    'Day 62'
  );
});

test('GroupedBarChart exposes a visible token-backed series key', () => {
  const root = GroupedBarChart({ data, config });
  const legend = all(root, '.cora-grouped-bar-chart__legend')[0];
  const items = all(legend, '.cora-grouped-bar-chart__legend-item');

  assert.equal(legend.getAttribute('role'), 'group');
  assert.equal(legend.getAttribute('aria-label'), 'Chart series');
  assert.deepEqual(
    all(legend, '.cora-grouped-bar-chart__legend-label').map(
      (label) => label.textContent
    ),
    ['Settled', 'Provisional']
  );
  assert.equal(items.length, 2);
  assert.equal(
    all(items[0], '.cora-grouped-bar-chart__legend-swatch')[0].getAttribute(
      'fill'
    ),
    'var(--cora-color-success)'
  );
  assert.equal(
    all(items[1], '.cora-grouped-bar-chart__legend-swatch')[0].getAttribute(
      'fill'
    ),
    'var(--cora-color-warning)'
  );
});

test('GroupedBarChart uses the first series identity for every occurrence', () => {
  const root = GroupedBarChart({ data, config });
  const secondGroup = all(root, '.cora-grouped-bar-chart__group')[1];
  const settled = bars(secondGroup)[0];

  assert.equal(settled.getAttribute('fill'), 'var(--cora-color-success)');
  assert.match(settled.getAttribute('aria-label'), /Settled/);
  assert.doesNotMatch(settled.getAttribute('aria-label'), /Other settled/);
});

test('GroupedBarChart reserves plot space for the legend', () => {
  const chartData = {
    groups: [
      {
        key: 'one',
        label: 'One',
        marks: [{ key: 'count', label: 'Count', value: 10 }],
      },
    ],
  };
  const defaultMargin = GroupedBarChart({
    data: chartData,
    config: { width: 200, height: 160, ariaLabel: 'Default margin' },
  });
  const zeroTopMargin = GroupedBarChart({
    data: chartData,
    config: {
      width: 200,
      height: 160,
      ariaLabel: 'Zero top margin',
      margin: { top: 0, right: 16, bottom: 48, left: 48 },
    },
  });

  for (const root of [defaultMargin, zeroTopMargin]) {
    const legendLabel = all(root, '.cora-grouped-bar-chart__legend-label')[0];
    const bar = bars(root)[0];
    assert.ok(
      Number(bar.getAttribute('y')) > Number(legendLabel.getAttribute('y'))
    );
  }
});

test('GroupedBarChart wraps and truncates long legend labels with full names', () => {
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
    config: { width: 220, height: 240, ariaLabel: 'Long series' },
  });
  const items = all(root, '.cora-grouped-bar-chart__legend-item');
  const visibleLabels = all(root, '.cora-grouped-bar-chart__legend-label');

  assert.equal(items.length, labels.length);
  assert.ok(visibleLabels[0].textContent.endsWith('…'));
  assert.equal(items[0].getAttribute('aria-label'), labels[0]);
  assert.ok(
    Number(visibleLabels[1].getAttribute('y')) >
      Number(visibleLabels[0].getAttribute('y'))
  );
});

test('GroupedBarChart rounds default fractional tick labels', () => {
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
      width: 200,
      height: 180,
      ariaLabel: 'Rounded ticks',
      yMax: 10,
      tickCount: 4,
    },
  });

  assert.deepEqual(
    all(root, '.cora-grouped-bar-chart__tick-label').map(
      (label) => label.textContent
    ),
    ['0', '3.33', '6.67', '10']
  );
});

test('GroupedBarChart gives every mark an accessible name and escapes labels as text', () => {
  const root = GroupedBarChart({ data, config });
  const bar = bars(root)[0];
  const title = bar.childNodes.find(
    (/** @type {any} */ child) => child.tagName === 'title'
  );

  assert.equal(bar.getAttribute('role'), 'img');
  assert.equal(
    bar.getAttribute('aria-label'),
    'Group: Week <one>: Settled, 8 cases'
  );
  assert.equal(title?.textContent, 'Group: Week <one>: Settled, 8 cases');
  assert.equal(bar.querySelector('script'), null);
});

test('GroupedBarChart renders provisional marks hollow while retaining their token stroke', () => {
  const root = GroupedBarChart({ data, config });
  const provisional = all(root, '.cora-grouped-bar-chart__bar--provisional')[0];

  assert.ok(provisional);
  assert.equal(provisional.getAttribute('fill'), 'none');
  assert.equal(provisional.getAttribute('stroke'), 'var(--cora-color-warning)');
  assert.equal(provisional.getAttribute('stroke-width'), '2');
  assert.match(provisional.getAttribute('aria-label'), /provisional/);
});

test('GroupedBarChart supports empty and all-zero data without invalid geometry', () => {
  const empty = GroupedBarChart({
    data: { groups: [] },
    config: { width: 200, height: 120, ariaLabel: 'Empty chart' },
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
    config: { width: 200, height: 120, ariaLabel: 'Zero chart' },
  });

  assert.equal(bars(empty).length, 0);
  assert.equal(bars(zero).length, 1);
  assert.equal(bars(zero)[0].getAttribute('height'), '0');
  assert.equal(bars(zero)[0].getAttribute('y'), '72');
  assert.equal(all(zero, '.cora-grouped-bar-chart__tick-label').length, 5);
  assert.equal(
    all(zero, '.cora-grouped-bar-chart__tick-label').at(-1).textContent,
    '1'
  );
});

test('GroupedBarChart does not mutate caller data or config', () => {
  const inputData = structuredClone(data);
  const inputConfig = { ...config, margin: { ...config.margin } };
  const beforeData = structuredClone(inputData);
  const beforeConfig = { ...inputConfig, margin: { ...inputConfig.margin } };

  GroupedBarChart({ data: inputData, config: inputConfig });

  assert.deepEqual(inputData, beforeData);
  assert.deepEqual(inputConfig, beforeConfig);
});

test('render preserves keyed groups and marks when their order changes', () => {
  const rootContainer = document.createElement('div');
  const first = GroupedBarChart({ data, config });
  render(rootContainer, first);

  const mounted = rootContainer.childNodes[0];
  const firstGroups = all(mounted, '.cora-grouped-bar-chart__group');
  const firstBars = bars(mounted);
  const firstSettled = keyed(firstGroups[0], 'settled');

  /** @type {import('../src/components/base/cora-grouped-bar-chart.js').GroupedBarChartData} */
  const reorderedData = {
    groups: [
      {
        key: 'week-two',
        label: 'Week two',
        marks: [{ key: 'settled', label: 'Settled', value: 3 }],
      },
      {
        key: 'week-one',
        label: 'Week <one>',
        marks: [
          {
            key: 'provisional',
            label: 'Provisional',
            value: 5,
            provisional: true,
            tone: 'warning',
          },
          { key: 'settled', label: 'Settled', value: 9, tone: 'success' },
        ],
      },
    ],
  };
  render(rootContainer, GroupedBarChart({ data: reorderedData, config }));

  const nextGroups = all(rootContainer, '.cora-grouped-bar-chart__group');
  const nextBars = bars(rootContainer);
  const nextWeekOne = nextGroups[1];

  assert.equal(nextGroups[0], firstGroups[1]);
  assert.equal(nextGroups[1], firstGroups[0]);
  assert.equal(keyed(nextWeekOne, 'settled'), firstSettled);
  assert.equal(nextBars.includes(firstBars[0]), true);
  assert.equal(nextBars.length, 3);
});

test('GroupedBarChart aligns sparse and reordered marks by their series key', () => {
  /** @type {import('../src/components/base/cora-grouped-bar-chart.js').GroupedBarChartData} */
  const sparseData = {
    groups: [
      {
        key: 'first',
        label: 'First',
        marks: [
          { key: 'alpha', label: 'Alpha', value: 4 },
          { key: 'beta', label: 'Beta', value: 6 },
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
          { key: 'beta', label: 'Beta', value: 3 },
          { key: 'alpha', label: 'Alpha', value: 2 },
        ],
      },
    ],
  };
  const sparseConfig = {
    width: 360,
    height: 240,
    ariaLabel: 'Sparse series',
    tickCount: 2,
  };
  const root = GroupedBarChart({ data: sparseData, config: sparseConfig });
  const groups = all(root, '.cora-grouped-bar-chart__group');
  const groupLabels = all(root, '.cora-grouped-bar-chart__group-label');
  const groupBand =
    Number(groupLabels[1].getAttribute('x')) -
    Number(groupLabels[0].getAttribute('x'));
  const firstStart = Number(groupLabels[0].getAttribute('x')) - groupBand / 2;
  const secondStart = Number(groupLabels[1].getAttribute('x')) - groupBand / 2;
  const thirdStart = Number(groupLabels[2].getAttribute('x')) - groupBand / 2;
  const firstBars = bars(groups[0]);
  const secondBars = bars(groups[1]);
  const thirdAlpha = bars(keyed(groups[2], 'alpha'))[0];
  const thirdBeta = bars(keyed(groups[2], 'beta'))[0];
  const alphaOffset = Number(firstBars[0].getAttribute('x')) - firstStart;
  const betaOffset = Number(firstBars[1].getAttribute('x')) - firstStart;

  assert.equal(secondBars.length, 1);
  assert.ok(
    Math.abs(
      Number(secondBars[0].getAttribute('x')) - secondStart - betaOffset
    ) < 0.000001
  );
  assert.ok(
    Math.abs(Number(thirdAlpha.getAttribute('x')) - thirdStart - alphaOffset) <
      0.000001
  );
  assert.ok(
    Math.abs(Number(thirdBeta.getAttribute('x')) - thirdStart - betaOffset) <
      0.000001
  );
});

test('GroupedBarChart validates geometry, keys, values, formatters, and tones explicitly', () => {
  const valid = {
    data: { groups: [] },
    config: { width: 100, height: 100, ariaLabel: 'Chart' },
  };

  assert.throws(
    () => GroupedBarChart({ ...valid, config: { ...valid.config, width: 0 } }),
    /width/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        ...valid,
        config: { ...valid.config, height: Number.NaN },
      }),
    /height/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        ...valid,
        config: {
          ...valid.config,
          margin: { top: 60, right: 20, bottom: 50, left: 20 },
        },
      }),
    /drawable area/
  );
  assert.throws(
    () => GroupedBarChart({ ...valid, config: { ...valid.config, yMax: -1 } }),
    /yMax/
  );
  assert.throws(
    () => GroupedBarChart({ ...valid, config: { ...valid.config, yMax: 0 } }),
    /yMax/
  );
  assert.throws(
    () =>
      GroupedBarChart({ ...valid, config: { ...valid.config, tickCount: 0 } }),
    /tickCount/
  );
  assert.throws(
    () =>
      GroupedBarChart({ ...valid, config: { ...valid.config, tickCount: 1 } }),
    /tickCount/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        ...valid,
        config: /** @type {any} */ ({ ...valid.config, formatValue: 'nope' }),
      }),
    /formatValue/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        data: { groups: [{ key: 'g', label: 'G', marks: [] }] },
        config: /** @type {any} */ ({
          ...valid.config,
          formatGroupLabel: () => 1,
        }),
      }),
    /formatGroupLabel/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        data: { groups: [{ key: 'g', label: '', marks: [] }] },
        config: valid.config,
      }),
    /group.label/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        data: {
          groups: [
            {
              key: 'g',
              label: 'G',
              marks: [{ key: 'm', label: '', value: 1 }],
            },
          ],
        },
        config: valid.config,
      }),
    /mark.label/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        data: {
          groups: [
            {
              key: 'g',
              label: 'G',
              marks: [{ key: 'm', label: 'M', value: 1 }],
            },
          ],
        },
        config: { ...valid.config, formatValue: () => '' },
      }),
    /non-empty/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        data: {
          groups: [
            {
              key: 'g',
              label: 'G',
              marks: [{ key: 'm', label: 'M', value: 1 }],
            },
          ],
        },
        config: { ...valid.config, formatGroupLabel: () => '' },
      }),
    /non-empty/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        data: {
          groups: [
            {
              key: 'g',
              label: 'G',
              marks: [{ key: 'm', label: 'M', value: -1 }],
            },
          ],
        },
        config: valid.config,
      }),
    /non-negative/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        data: {
          groups: [
            {
              key: 'g',
              label: 'G',
              marks: [{ key: 'm', label: 'M', value: Infinity }],
            },
          ],
        },
        config: valid.config,
      }),
    /finite/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        data: {
          groups: [
            {
              key: 'g',
              label: 'G',
              marks: [{ key: 'm', label: 'M', value: 2 }],
            },
            { key: 'g', label: 'Other', marks: [] },
          ],
        },
        config: valid.config,
      }),
    /unique/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        data: {
          groups: [
            {
              key: 'g',
              label: 'G',
              marks: [
                {
                  key: 'm',
                  label: 'M',
                  value: 2,
                  tone: /** @type {any} */ ('purple'),
                },
              ],
            },
          ],
        },
        config: valid.config,
      }),
    /tone/
  );
  assert.throws(
    () =>
      GroupedBarChart({
        data: {
          groups: [
            {
              key: 'g',
              label: 'G',
              marks: [{ key: 'm', label: 'M', value: 2 }],
            },
          ],
        },
        config: { ...valid.config, yMax: 1 },
      }),
    /yMax/
  );
});
