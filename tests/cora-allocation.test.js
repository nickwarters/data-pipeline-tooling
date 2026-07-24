// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';

installDom();

const {
  Allocation,
  getAllocationAvailability,
  getUnassignedCases,
  orderCandidatesByAge,
} = await import('../src/components/sections/cora-allocation.js');

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
  const view = Allocation({
    isEmpty: true,
    isAtCapacity: false,
    onRequestNextCase() {},
  });
  assert.equal(view.className, 'cora-empty cora-allocation-empty');
  assert.equal(view.textContent, 'No Cases available');
});

test('Allocation distinguishes a capacity limit from an empty candidate pool', () => {
  const view = Allocation({
    isEmpty: false,
    isAtCapacity: true,
    onRequestNextCase() {},
  });
  assert.equal(view.className, 'cora-empty cora-allocation-empty');
  assert.equal(view.textContent, 'Maximum active Cases reached');
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

test('getAllocationAvailability skips at-limit sources and counts only non-held In-progress Cases', async () => {
  /** @type {any[]} */
  const counts = [];
  /** @type {any[]} */
  const reads = [];
  const availability = await getAllocationAvailability({
    client: /** @type {any} */ ({
      async countCases(/** @type {any} */ filter, /** @type {any} */ options) {
        counts.push([filter, options]);
        return options.listName === 'Cases-A' ? 3 : 2;
      },
      async listCases(/** @type {any} */ filter, /** @type {any} */ options) {
        reads.push([filter, options]);
        return [
          {
            id: 'available-b',
            created: '2026-01-01',
            assignedReviewer: '',
            etag: '"1"',
          },
        ];
      },
    }),
    allocationSources: [
      { slug: 'a', listName: 'Cases-A', maxInProgressCases: 3 },
      { slug: 'b', listName: 'Cases-B', maxInProgressCases: 3 },
    ],
    currentUserId: 'reviewer-1',
    random: () => 0,
  });

  assert.deepEqual(counts, [
    [
      {
        status: 'In-progress',
        assignedReviewer: 'reviewer-1',
        onHold: false,
      },
      { listName: 'Cases-A' },
    ],
    [
      {
        status: 'In-progress',
        assignedReviewer: 'reviewer-1',
        onHold: false,
      },
      { listName: 'Cases-B' },
    ],
  ]);
  assert.deepEqual(reads, [
    [{ status: 'In-progress', caseType: 'b' }, { listName: 'Cases-B' }],
  ]);
  assert.deepEqual(
    availability.candidates.map((candidate) => candidate.id),
    ['available-b']
  );
  assert.equal(availability.isAtCapacity, false);
});

test('getAllocationAvailability reports capacity when every limited source is at or over its limit', async () => {
  let reads = 0;
  const availability = await getAllocationAvailability({
    client: /** @type {any} */ ({
      async countCases() {
        return 4;
      },
      async listCases() {
        reads += 1;
        return [];
      },
    }),
    allocationSources: [
      { slug: 'a', listName: 'Cases-A', maxInProgressCases: 3 },
      { slug: 'b', listName: 'Cases-B', maxInProgressCases: 2 },
    ],
    currentUserId: 'reviewer-1',
  });

  assert.deepEqual(availability.candidates, []);
  assert.equal(availability.isAtCapacity, true);
  assert.equal(reads, 0);
});

test('getAllocationAvailability reports capacity when capped sources are mixed with empty sources', async () => {
  const availability = await getAllocationAvailability({
    client: /** @type {any} */ ({
      async countCases(/** @type {any} */ _filter, /** @type {any} */ options) {
        return options.listName === 'Cases-A' ? 3 : 0;
      },
      async listCases() {
        return [];
      },
    }),
    allocationSources: [
      { slug: 'a', listName: 'Cases-A', maxInProgressCases: 3 },
      { slug: 'b', listName: 'Cases-B', maxInProgressCases: 3 },
    ],
    currentUserId: 'reviewer-1',
  });

  assert.deepEqual(availability.candidates, []);
  assert.equal(availability.isAtCapacity, true);
});

test('getAllocationAvailability leaves unconfigured sources unlimited', async () => {
  let counts = 0;
  const availability = await getAllocationAvailability({
    client: /** @type {any} */ ({
      async countCases() {
        counts += 1;
        return 99;
      },
      async listCases() {
        return [];
      },
    }),
    allocationSources: [{ slug: 'a', listName: 'Cases-A' }],
    currentUserId: 'reviewer-1',
  });

  assert.equal(counts, 0);
  assert.equal(availability.isAtCapacity, false);
});
