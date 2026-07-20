// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';

installDom();

const { Allocation, getUnassignedCases, orderCandidatesByAge } =
  await import('../src/components/sections/cora-allocation.js');

test('Allocation renders the request action and reports clicks', () => {
  let clicks = 0;
  const view = Allocation({
    isEmpty: false,
    onRequestNextCase: () => {
      clicks += 1;
    },
  });
  assert.equal(view.textContent, 'Request next Case');
  fireEvent(view, 'click');
  assert.equal(clicks, 1);
});

test('Allocation renders the empty state after the route exhausts candidates', () => {
  const view = Allocation({ isEmpty: true, onRequestNextCase() {} });
  assert.equal(view.className, 'cora-empty cora-allocation-empty');
  assert.equal(view.textContent, 'No Cases available');
});

test('orderCandidatesByAge sorts oldest first and uses one stable tie-break draw per candidate', () => {
  const draws = [0.9, 0.1, 0.5];
  const rows = /** @type {any} */ ([
    { id: 'later-tie', created: '2026-01-02' },
    { id: 'earlier-tie', created: '2026-01-02' },
    { id: 'oldest', created: null },
  ]);
  assert.deepEqual(
    orderCandidatesByAge(rows, () => /** @type {number} */ (draws.shift())).map(
      (row) => row.id
    ),
    ['oldest', 'earlier-tie', 'later-tie']
  );
});

test('orderCandidatesByAge accepts its production random source', () => {
  assert.deepEqual(
    orderCandidatesByAge(/** @type {any} */ ([{ id: 'only' }])).map(
      (row) => row.id
    ),
    ['only']
  );
  assert.deepEqual(
    orderCandidatesByAge(
      /** @type {any} */ ([
        { id: 'undated', created: null },
        { id: 'later', created: '2026-01-01' },
      ]),
      () => 0
    ).map((row) => row.id),
    ['undated', 'later']
  );
});

test('getUnassignedCases reads only configured sources, filters assigned rows, and carries listName', async () => {
  /** @type {any[]} */
  const calls = [];
  const rows = await getUnassignedCases({
    client: /** @type {any} */ ({
      async listCases(/** @type {any} */ filter, /** @type {any} */ options) {
        calls.push([filter, options]);
        return options.listName === 'Cases-A'
          ? [
              {
                id: 'a',
                created: '2026-01-01',
                assignedReviewer: '',
                etag: '"1"',
              },
              {
                id: 'taken',
                created: '2025-01-01',
                assignedReviewer: 'u2',
                etag: '"2"',
              },
            ]
          : [
              {
                id: 'b',
                created: '2026-02-01',
                assignedReviewer: '',
                etag: '"3"',
              },
            ];
      },
    }),
    allocationSources: [
      { slug: 'a', listName: 'Cases-A' },
      { slug: 'b', listName: 'Cases-B' },
    ],
    random: () => 0,
  });
  assert.deepEqual(
    rows.map((row) => [row.id, row._listOptions.listName]),
    [
      ['a', 'Cases-A'],
      ['b', 'Cases-B'],
    ]
  );
  assert.deepEqual(calls, [
    [{ status: 'In-progress', caseType: 'a' }, { listName: 'Cases-A' }],
    [{ status: 'In-progress', caseType: 'b' }, { listName: 'Cases-B' }],
  ]);
});

test('getUnassignedCases returns no candidates without a client', async () => {
  assert.deepEqual(
    await getUnassignedCases({ client: null, allocationSources: [] }),
    []
  );
});
