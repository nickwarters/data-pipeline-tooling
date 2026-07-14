// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

// ===== IMPORTS (after stubs) =====
const { CORAAllocation, getUnassignedCases, orderCandidatesByAge } =
  await import('../src/components/sections/cora-allocation.js');

// ===== HELPERS =====

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/setup/resolve-eligible-case-types.js').AllocationSource} AllocationSource */

/**
 * A fake client backed by a map of listName -> rows, so different
 * allocation sources can be genuinely different "lists". Records every
 * `listCases`/`patchCase` call (including the `opts` passed) for assertions.
 *
 * @param {Record<string, CaseRow[]>} listsByName
 */
function makeClient(listsByName) {
  /** @type {{ filter: any, opts: any }[]} */
  const listCalls = [];
  /** @type {{ id: string, fields: any, etag: string, opts: any }[]} */
  const patchCalls = [];
  return {
    listCalls,
    patchCalls,
    async listCases(
      /** @type {import('../src/sharepoint-client.js').ListCasesFilter} */ filter,
      /** @type {any} */ opts = {}
    ) {
      listCalls.push({ filter, opts });
      const rows = listsByName[opts.listName] ?? [];
      return rows
        .filter((c) => {
          if (filter.status !== undefined && c.status !== filter.status)
            return false;
          if (filter.caseType !== undefined && c.caseType !== filter.caseType)
            return false;
          return true;
        })
        .map((c) => ({ ...c }));
    },
    async patchCase(
      /** @type {string} */ id,
      /** @type {Partial<CaseRow>} */ fields,
      /** @type {string} */ etag,
      /** @type {any} */ opts = {}
    ) {
      patchCalls.push({ id, fields, etag, opts });
      for (const listName of Object.keys(listsByName)) {
        const rows = listsByName[listName];
        const c = rows.find((c) => c.id === id);
        if (!c) continue;
        if (c.etag !== etag) return { ok: false, status: 412 };
        c.assignedReviewer = /** @type {string} */ (
          fields.assignedReviewer ?? c.assignedReviewer
        );
        const newEtag = etag + '-patched';
        c.etag = newEtag;
        return { ok: true, status: 200, data: { ...c, etag: newEtag } };
      }
      return { ok: false, status: 404 };
    },
  };
}

/**
 * Unassigned case with a given `created` timestamp.
 * @param {string} id
 * @param {string} created
 * @param {string} caseType
 */
function unassignedCase(
  id = 'c1',
  created = '2026-01-01T00:00:00Z',
  caseType = 'example-review'
) {
  /** @type {CaseRow} */
  const c = {
    id,
    caseType,
    title: `Case ${id}`,
    status: 'In-progress',
    assignedReviewer: '',
    responsibleParty: 'rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    created,
    etag: `etag-${id}`,
  };
  return c;
}

/** @param {string} slug @param {string} listName @returns {AllocationSource} */
function source(slug, listName) {
  return { slug, listName };
}

// ===== orderCandidatesByAge (pure helper) =====

test('orderCandidatesByAge: sorts ascending by created', () => {
  const older = unassignedCase('c-older', '2026-01-01T00:00:00Z');
  const newer = unassignedCase('c-newer', '2026-06-01T00:00:00Z');
  const result = orderCandidatesByAge(
    /** @type {any} */ ([newer, older]),
    () => 0.5
  );
  assert.deepEqual(
    result.map((c) => c.id),
    ['c-older', 'c-newer']
  );
});

test('orderCandidatesByAge: falls back to empty string for null/missing created', () => {
  const noCreated = /** @type {any} */ (unassignedCase('c-none', ''));
  noCreated.created = null;
  const withCreated = unassignedCase('c-has', '2026-01-01T00:00:00Z');
  const result = orderCandidatesByAge(
    /** @type {any} */ ([withCreated, noCreated]),
    () => 0.5
  );
  assert.equal(result[0].id, 'c-none', 'null created sorts first as ""');
});

test('orderCandidatesByAge: falls back to empty string for null/missing created — swapped comparator order', () => {
  // Same scenario with the null-created candidate first in the input, so the
  // internal comparator exercises the `?? ''` fallback for both left- and
  // right-hand sides of the comparison, not just one.
  const noCreated = /** @type {any} */ (unassignedCase('c-none', ''));
  noCreated.created = null;
  const withCreated = unassignedCase('c-has', '2026-01-01T00:00:00Z');
  const result = orderCandidatesByAge(
    /** @type {any} */ ([noCreated, withCreated]),
    () => 0.5
  );
  assert.equal(result[0].id, 'c-none', 'null created sorts first as ""');
});

test('orderCandidatesByAge: exact created ties broken by random — stub selects candidate X', () => {
  const x = unassignedCase('c-x', '2026-01-01T00:00:00Z');
  const y = unassignedCase('c-y', '2026-01-01T00:00:00Z');
  // x is drawn first (lower tie-break value) so x sorts first.
  const values = [0.1, 0.9];
  let i = 0;
  const result = orderCandidatesByAge(
    /** @type {any} */ ([x, y]),
    () => values[i++]
  );
  assert.equal(result[0].id, 'c-x');
});

test('orderCandidatesByAge: exact created ties broken by random — stub selects candidate Y', () => {
  const x = unassignedCase('c-x', '2026-01-01T00:00:00Z');
  const y = unassignedCase('c-y', '2026-01-01T00:00:00Z');
  // y is drawn first (lower tie-break value) so y sorts first.
  const values = [0.9, 0.1];
  let i = 0;
  const result = orderCandidatesByAge(
    /** @type {any} */ ([x, y]),
    () => values[i++]
  );
  assert.equal(result[0].id, 'c-y');
});

test('orderCandidatesByAge: defaults to Math.random when no random supplied', () => {
  const a = unassignedCase('c-a', '2026-01-01T00:00:00Z');
  const b = unassignedCase('c-b', '2026-02-01T00:00:00Z');
  const result = orderCandidatesByAge(/** @type {any} */ ([b, a]));
  assert.deepEqual(
    result.map((c) => c.id),
    ['c-a', 'c-b']
  );
});

// ===== getUnassignedCases (fan-out across sources) =====

test('getUnassignedCases: returns empty array when client is null', async () => {
  const result = await getUnassignedCases({
    client: null,
    allocationSources: [source('example-review', 'Cases-ExampleReview')],
  });
  assert.deepEqual(result, []);
});

test('getUnassignedCases: no sources means no client calls and an empty result', async () => {
  const client = makeClient({});
  const result = await getUnassignedCases({
    client: /** @type {any} */ (client),
    allocationSources: [],
  });
  assert.deepEqual(result, []);
  assert.equal(client.listCalls.length, 0);
});

test('getUnassignedCases: issues one listCases call per source with explicit filter and listName', async () => {
  const a = unassignedCase('a1', '2026-01-05T00:00:00Z', 'example-review');
  const b = unassignedCase('b1', '2026-01-03T00:00:00Z', 'product-sale-review');
  const client = makeClient({
    'Cases-ExampleReview': [a],
    'Cases-ProductSaleReview': [b],
  });
  const sources = [
    source('example-review', 'Cases-ExampleReview'),
    source('product-sale-review', 'Cases-ProductSaleReview'),
  ];

  await getUnassignedCases({
    client: /** @type {any} */ (client),
    allocationSources: sources,
  });

  assert.equal(client.listCalls.length, 2);
  assert.deepEqual(client.listCalls[0].filter, {
    status: 'In-progress',
    caseType: 'example-review',
  });
  assert.deepEqual(client.listCalls[0].opts, {
    listName: 'Cases-ExampleReview',
  });
  assert.deepEqual(client.listCalls[1].filter, {
    status: 'In-progress',
    caseType: 'product-sale-review',
  });
  assert.deepEqual(client.listCalls[1].opts, {
    listName: 'Cases-ProductSaleReview',
  });
});

test('getUnassignedCases: oldest created across DIFFERENT lists wins', async () => {
  const a = unassignedCase('a1', '2026-01-05T00:00:00Z', 'example-review');
  const b = unassignedCase('b1', '2026-01-03T00:00:00Z', 'product-sale-review');
  const client = makeClient({
    'Cases-ExampleReview': [a],
    'Cases-ProductSaleReview': [b],
  });
  const sources = [
    source('example-review', 'Cases-ExampleReview'),
    source('product-sale-review', 'Cases-ProductSaleReview'),
  ];

  const result = await getUnassignedCases({
    client: /** @type {any} */ (client),
    allocationSources: sources,
  });

  assert.equal(result[0].id, 'b1', 'the older case (list B) should sort first');
  assert.equal(result[1].id, 'a1');
});

test('getUnassignedCases: excludes already-assigned cases', async () => {
  const assigned = { ...unassignedCase('c1'), assignedReviewer: 'someone' };
  const unassigned = unassignedCase('c2');
  const client = makeClient({ 'Cases-ExampleReview': [assigned, unassigned] });

  const result = await getUnassignedCases({
    client: /** @type {any} */ (client),
    allocationSources: [source('example-review', 'Cases-ExampleReview')],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'c2');
});

test('getUnassignedCases: empty pool across all sources yields empty result', async () => {
  const client = makeClient({ 'Cases-ExampleReview': [] });
  const result = await getUnassignedCases({
    client: /** @type {any} */ (client),
    allocationSources: [source('example-review', 'Cases-ExampleReview')],
  });
  assert.deepEqual(result, []);
});

test('getUnassignedCases: candidates carry their source list options', async () => {
  const a = unassignedCase('a1', '2026-01-01T00:00:00Z', 'example-review');
  const client = makeClient({ 'Cases-ExampleReview': [a] });

  const result = await getUnassignedCases({
    client: /** @type {any} */ (client),
    allocationSources: [source('example-review', 'Cases-ExampleReview')],
  });

  assert.deepEqual(result[0]._listOptions, { listName: 'Cases-ExampleReview' });
});

// ===== CORAAllocation component =====

test('CORAAllocation: constructor initializes with default values', () => {
  const el = new CORAAllocation();
  assert.equal(el.client, null);
  assert.equal(el.currentUserId, '');
  assert.deepEqual(el.allocationSources, []);
  assert.equal(typeof el.random, 'function');
});

test('CORAAllocation: connectedCallback renders "Request next Case" button', async () => {
  const el = new CORAAllocation();
  el.client = /** @type {any} */ (makeClient({}));
  el.currentUserId = 'user-reviewer';
  el.allocationSources = [source('example-review', 'Cases-ExampleReview')];
  el.connectedCallback();
  const btn = /** @type {any} */ (el)._children[0];
  assert.ok(btn, 'should have a child element');
  assert.equal(btn.textContent, 'Request next Case');
});

test('CORAAllocation: disconnectedCallback is callable', () => {
  const el = new CORAAllocation();
  el.disconnectedCallback();
  // Should not throw
});

test('CORAAllocation: _requestNextCase assigns the oldest unassigned case and dispatches cora-allocated', async () => {
  const older = unassignedCase('c-older', '2026-01-01T00:00:00Z');
  const newer = unassignedCase('c-newer', '2026-06-01T00:00:00Z');
  const client = makeClient({ 'Cases-ExampleReview': [older, newer] });

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.allocationSources = [source('example-review', 'Cases-ExampleReview')];

  /** @type {any[]} */
  const dispatched = [];
  el.addEventListener('cora-allocated', (e) => dispatched.push(e));

  /** @type {any} */ (globalThis).location.hash = '';
  await el._requestNextCase();

  assert.equal(client.patchCalls.length, 1, 'should patch exactly once');
  assert.equal(
    client.patchCalls[0].id,
    'c-older',
    'should assign the oldest case first'
  );
  assert.deepEqual(client.patchCalls[0].fields, {
    assignedReviewer: 'user-reviewer',
  });
  assert.equal(
    /** @type {any} */ (globalThis).location.hash,
    '',
    'should not navigate away'
  );
  assert.equal(dispatched.length, 1, 'should dispatch cora-allocated');
  assert.equal(dispatched[0].detail.caseId, 'c-older');
});

test('CORAAllocation: patchCase carries the winning candidate listName', async () => {
  const c = unassignedCase('c1', '2026-01-01T00:00:00Z');
  const client = makeClient({ 'Cases-ExampleReview': [c] });

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.allocationSources = [source('example-review', 'Cases-ExampleReview')];

  await el._requestNextCase();

  assert.deepEqual(client.patchCalls[0].opts, {
    listName: 'Cases-ExampleReview',
  });
});

test('CORAAllocation: 412 on the oldest falls through to next-oldest on a DIFFERENT list, patched with that list name', async () => {
  const a = unassignedCase('a1', '2026-01-01T00:00:00Z', 'example-review'); // oldest, list A
  const b = unassignedCase('b1', '2026-01-05T00:00:00Z', 'product-sale-review'); // second, list B
  const client = makeClient({
    'Cases-ExampleReview': [a],
    'Cases-ProductSaleReview': [b],
  });

  // Force a to lose the race after being read (simulate another reviewer
  // winning it) by mutating its etag between read and patch.
  const originalListCases = client.listCases.bind(client);
  client.listCases = async (
    /** @type {any} */ filter,
    /** @type {any} */ opts
  ) => {
    const rows = await originalListCases(filter, opts);
    if (opts.listName === 'Cases-ExampleReview') {
      // Simulate the row being claimed by someone else right after the read.
      a.etag = 'raced-away';
    }
    return rows;
  };

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.allocationSources = [
    source('example-review', 'Cases-ExampleReview'),
    source('product-sale-review', 'Cases-ProductSaleReview'),
  ];

  /** @type {any[]} */
  const dispatched = [];
  el.addEventListener('cora-allocated', (e) => dispatched.push(e));

  await el._requestNextCase();

  assert.equal(client.patchCalls.length, 2, 'should attempt two patches');
  assert.equal(client.patchCalls[0].id, 'a1', 'first attempt is oldest case');
  assert.deepEqual(client.patchCalls[0].opts, {
    listName: 'Cases-ExampleReview',
  });
  assert.equal(
    client.patchCalls[1].id,
    'b1',
    'second attempt is next case, different list'
  );
  assert.deepEqual(client.patchCalls[1].opts, {
    listName: 'Cases-ProductSaleReview',
  });
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].detail.caseId, 'b1');
});

test('CORAAllocation: _requestNextCase shows "No Cases available" when no unassigned cases exist', async () => {
  const client = makeClient({ 'Cases-ExampleReview': [] });
  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.allocationSources = [source('example-review', 'Cases-ExampleReview')];

  await el._requestNextCase();

  const msg = /** @type {any} */ (el)._children[0];
  assert.ok(msg, 'should have a child element');
  assert.equal(msg.textContent, 'No Cases available');
});

test('CORAAllocation: no allocation sources shows "No Cases available" and makes no client calls', async () => {
  const client = makeClient({});
  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.allocationSources = [];

  await el._requestNextCase();

  const msg = /** @type {any} */ (el)._children[0];
  assert.equal(msg.textContent, 'No Cases available');
  assert.equal(client.listCalls.length, 0);
  assert.equal(client.patchCalls.length, 0);
});

test('CORAAllocation: _requestNextCase shows "No Cases available" when all retries receive 412', async () => {
  const first = unassignedCase('c-first', '2026-01-01T00:00:00Z');
  const second = unassignedCase('c-second', '2026-06-01T00:00:00Z');

  const client = {
    async listCases() {
      return [{ ...first }, { ...second }];
    },
    async patchCase() {
      return { ok: false, status: 412 };
    },
  };

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.allocationSources = [source('example-review', 'Cases-ExampleReview')];

  await el._requestNextCase();

  const msg = /** @type {any} */ (el)._children[0];
  assert.equal(msg.textContent, 'No Cases available');
});

test('CORAAllocation: only considers configured allocation sources', async () => {
  const eligibleCase = unassignedCase(
    'c-eligible',
    '2026-01-01T00:00:00Z',
    'example-review'
  );
  const client = makeClient({
    'Cases-ExampleReview': [eligibleCase],
    'Cases-OtherReview': [
      unassignedCase('c-other', '2025-12-01T00:00:00Z', 'other-review'),
    ],
  });

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.allocationSources = [source('example-review', 'Cases-ExampleReview')]; // only this source configured

  /** @type {any} */ (globalThis).location.hash = '';
  await el._requestNextCase();

  assert.equal(
    client.patchCalls.length,
    1,
    'should only patch the configured source case'
  );
  assert.equal(client.patchCalls[0].id, 'c-eligible');
});

test('CORAAllocation: patchCase is called with the correct etag', async () => {
  const c = unassignedCase('c1', '2026-01-01T00:00:00Z');
  c.etag = 'specific-etag';
  const client = makeClient({ 'Cases-ExampleReview': [c] });

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.allocationSources = [source('example-review', 'Cases-ExampleReview')];

  await el._requestNextCase();

  assert.equal(client.patchCalls[0].etag, 'specific-etag');
});

test('CORAAllocation: _requestNextCase does not navigate and dispatches cora-allocated event with caseId', async () => {
  const c = unassignedCase('c-nav', '2026-01-01T00:00:00Z');
  const client = makeClient({ 'Cases-ExampleReview': [c] });

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.allocationSources = [source('example-review', 'Cases-ExampleReview')];

  /** @type {any[]} */
  const dispatched = [];
  el.addEventListener('cora-allocated', (e) => dispatched.push(e));

  /** @type {any} */ (globalThis).location.hash = '';
  await el._requestNextCase();

  assert.equal(
    /** @type {any} */ (globalThis).location.hash,
    '',
    'should NOT navigate away from dashboard'
  );
  assert.equal(
    dispatched.length,
    1,
    'should dispatch cora-allocated event once'
  );
  assert.equal(
    dispatched[0].detail.caseId,
    'c-nav',
    'event detail should carry the allocated case id'
  );
});

test('CORAAllocation: _getUnassignedCases returns empty array when client is null', async () => {
  const el = new CORAAllocation();
  el.client = null;
  el.allocationSources = [source('example-review', 'Cases-ExampleReview')];
  const result = await el._getUnassignedCases();
  assert.deepEqual(result, []);
});

test('CORAAllocation: _requestNextCase returns early when client is null', async () => {
  const el = new CORAAllocation();
  el.client = null;
  await el._requestNextCase();
  // No error should occur
});

test('CORAAllocation: _getUnassignedCases filters out assigned cases', async () => {
  const c1 = unassignedCase('c1');
  const c2 = unassignedCase('c2');
  c2.assignedReviewer = 'someone';
  const client = makeClient({ 'Cases-ExampleReview': [c1, c2] });
  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.allocationSources = [source('example-review', 'Cases-ExampleReview')];
  const result = await el._getUnassignedCases();
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'c1');
});

test('CORAAllocation: _getUnassignedCases uses the injectable random seam for tie-breaks', async () => {
  const x = unassignedCase('c-x', '2026-01-01T00:00:00Z');
  const y = unassignedCase('c-y', '2026-01-01T00:00:00Z');
  const client = makeClient({ 'Cases-ExampleReview': [x, y] });
  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.allocationSources = [source('example-review', 'Cases-ExampleReview')];

  const values = [0.9, 0.1];
  let i = 0;
  el.random = () => values[i++];

  const result = await el._getUnassignedCases();
  assert.equal(result[0].id, 'c-y', 'lower tie-break draw sorts first');
});

test('CORAAllocation: _renderEmpty shows "No Cases available"', () => {
  const el = new CORAAllocation();
  el._renderEmpty();
  const msg = /** @type {any} */ (el)._children[0];
  assert.equal(msg.textContent, 'No Cases available');
});

test('CORAAllocation: button click triggers _requestNextCase', async () => {
  const c = unassignedCase('c-btn', '2026-01-01T00:00:00Z');
  const client = makeClient({ 'Cases-ExampleReview': [c] });

  const el = new CORAAllocation();
  el.client = /** @type {any} */ (client);
  el.currentUserId = 'user-reviewer';
  el.allocationSources = [source('example-review', 'Cases-ExampleReview')];
  el.connectedCallback();

  /** @type {any[]} */
  const dispatched = [];
  el.addEventListener('cora-allocated', (e) => dispatched.push(e));

  const btn = /** @type {any} */ (el)._children[0];
  await btn._listeners['click'][0]();

  assert.equal(dispatched.length, 1, 'button click must trigger allocation');
  assert.equal(dispatched[0].detail.caseId, 'c-btn');
});
