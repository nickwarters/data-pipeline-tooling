// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';

installDom();

const {
  Allocation,
  getAllocationAvailability,
  getUnallocatedCases,
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

test('orderCandidatesByAge orders by relatedDate in preference to created', () => {
  const rows = /** @type {any} */ ([
    { id: 'newest-related', relatedDate: '2026-03-01', created: '2025-01-01' },
    { id: 'oldest-related', relatedDate: '2026-01-01', created: '2026-12-01' },
    { id: 'middle-related', relatedDate: '2026-02-01', created: '2024-01-01' },
  ]);
  assert.deepEqual(
    orderCandidatesByAge(rows, () => 0).map((row) => row.id),
    ['oldest-related', 'middle-related', 'newest-related']
  );
});

test('orderCandidatesByAge falls back to created when a Case has no relatedDate', () => {
  const rows = /** @type {any} */ ([
    { id: 'dated', relatedDate: '2026-02-01', created: '2020-01-01' },
    { id: 'null-related', relatedDate: null, created: '2026-01-01' },
    { id: 'blank-related', relatedDate: '', created: '2026-03-01' },
    { id: 'undated', created: null },
  ]);
  assert.deepEqual(
    orderCandidatesByAge(rows, () => 0).map((row) => row.id),
    ['undated', 'null-related', 'dated', 'blank-related']
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

test('the candidate read asks each configured source for To-allocate Cases and carries the listName it read them from', async () => {
  /** @type {any[]} */
  const calls = [];
  const rows = await getUnallocatedCases({
    client: /** @type {any} */ ({
      async listCases(/** @type {any} */ filter, /** @type {any} */ options) {
        calls.push([filter, options]);
        return options.listName === 'Cases-A'
          ? [
              {
                id: 'a',
                created: '2026-01-01',
                status: 'To-allocate',
                assignedReviewer: '',
                etag: '"1"',
              },
            ]
          : [
              {
                id: 'b',
                created: '2026-02-01',
                status: 'To-allocate',
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
    [{ status: 'To-allocate' }, { listName: 'Cases-A' }],
    [{ status: 'To-allocate' }, { listName: 'Cases-B' }],
  ]);
});

test('a Case a Reviewer is already working is never offered, because the pot read never asks for one', async () => {
  /** @type {any[]} */
  const filters = [];
  const rows = await getUnallocatedCases({
    client: /** @type {any} */ ({
      async listCases(/** @type {any} */ filter) {
        filters.push(filter);
        // Answer the question actually asked, as the list would: a status
        // filter returns only rows in that status.
        return [
          {
            id: 'unclaimed',
            created: '2026-01-01',
            status: 'To-allocate',
            assignedReviewer: '',
            etag: '"1"',
          },
          {
            id: 'being-reviewed',
            created: '2025-01-01',
            status: 'In-progress',
            assignedReviewer: 'u2',
            etag: '"2"',
          },
        ].filter((row) => row.status === filter.status);
      },
    }),
    allocationSources: [{ slug: 'a', listName: 'Cases-A' }],
    random: () => 0,
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['unclaimed']
  );
  assert.deepEqual(filters, [{ status: 'To-allocate' }]);
});

test('the candidate read returns no candidates without a client', async () => {
  assert.deepEqual(
    await getUnallocatedCases({ client: null, allocationSources: [] }),
    []
  );
});

test('getAllocationAvailability applies one overall limit to non-held In-progress Cases across sources', async () => {
  /** @type {any[]} */
  const counts = [];
  /** @type {any[]} */
  const reads = [];
  const availability = await getAllocationAvailability({
    client: /** @type {any} */ ({
      async countCases(/** @type {any} */ filter, /** @type {any} */ options) {
        counts.push([filter, options]);
        return options.listName === 'Cases-A' ? 1 : 2;
      },
      async listCases(/** @type {any} */ filter, /** @type {any} */ options) {
        reads.push([filter, options]);
        return [
          {
            id: 'available-b',
            created: '2026-01-01',
            status: 'To-allocate',
            assignedReviewer: '',
            etag: '"1"',
          },
        ];
      },
    }),
    allocationSources: [
      { slug: 'a', listName: 'Cases-A' },
      { slug: 'b', listName: 'Cases-B' },
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
  assert.deepEqual(reads, []);
  assert.deepEqual(availability.candidates, []);
  assert.equal(availability.isAtCapacity, true);
});

test('getAllocationAvailability reads candidates from every source when the overall total is below three', async () => {
  let reads = 0;
  const availability = await getAllocationAvailability({
    client: /** @type {any} */ ({
      async countCases(/** @type {any} */ _filter, /** @type {any} */ options) {
        return options.listName === 'Cases-A' ? 1 : 0;
      },
      async listCases() {
        reads += 1;
        return [];
      },
    }),
    allocationSources: [
      { slug: 'a', listName: 'Cases-A' },
      { slug: 'b', listName: 'Cases-B' },
    ],
    currentUserId: 'reviewer-1',
  });

  assert.deepEqual(availability.candidates, []);
  assert.equal(availability.isAtCapacity, false);
  assert.equal(reads, 2);
});

test('getAllocationAvailability does not count Actions In Progress toward the overall limit', async () => {
  /** @type {any[]} */
  const filters = [];
  const availability = await getAllocationAvailability({
    client: /** @type {any} */ ({
      async countCases(/** @type {any} */ filter) {
        filters.push(filter);
        return 0;
      },
      async listCases() {
        return [];
      },
    }),
    allocationSources: [{ slug: 'a', listName: 'Cases-A' }],
    currentUserId: 'reviewer-1',
  });

  assert.deepEqual(filters, [
    {
      status: 'In-progress',
      assignedReviewer: 'reviewer-1',
      onHold: false,
    },
  ]);
  assert.deepEqual(availability.candidates, []);
  assert.equal(availability.isAtCapacity, false);
});
