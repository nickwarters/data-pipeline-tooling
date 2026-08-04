// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';
import { searchCases, SEARCH_PAGE_SIZE } from '../src/services/case-search.js';
import { withAbortSignal } from '../src/services/abortable-client.js';
import { makeCaseRow } from './helpers/fixtures.js';

// Capability: one bounded lookup across every Case Type list the viewer holds.

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/setup/resolve-eligible-case-types.js').CaseSource} CaseSource */

const PERSONAS = { reviewer: { groups: ['Reviewers'] } };

/** @type {any[]} */
const SOURCES = [
  {
    slug: 'complaints',
    listName: 'Cases-Complaints',
    displayName: 'Complaints',
  },
  {
    slug: 'example-review',
    listName: 'Cases-ExampleReview',
    displayName: 'Example Review',
  },
];

/**
 * @param {Record<string, CaseRow[]>} lists
 * @returns {{ client: any, calls: Array<{ filter: any, opts: any }> }}
 */
function recordingClient(lists) {
  /** @type {Array<{ filter: any, opts: any }>} */
  const calls = [];
  const inner = new MockSharePointClient({ lists, personas: PERSONAS });
  const client = {
    /** @param {any} filter @param {any} opts */
    listCases(filter, opts) {
      calls.push({ filter, opts });
      return inner.listCases(filter, opts);
    },
  };
  return { client, calls };
}

/**
 * `n` Cases in one list, ids `'1'`…`'n'`. SharePoint's `Id` is a counter carried
 * as a string, and these are shaped like it: unpadded, so a lexicographic sort
 * and a numeric one disagree the moment the row count reaches ten.
 *
 * @param {string} slug @param {number} n
 */
function rows(slug, n) {
  return Array.from({ length: n }, (_, i) =>
    makeCaseRow({
      id: String(i + 1),
      caseType: slug,
      title: `CR-${slug}-${i + 1}`,
      etag: `e-${slug}-${i + 1}`,
    })
  );
}

test('searchCases: with no Case Type filter, reads every source once and merges', async () => {
  const { client, calls } = recordingClient({
    'Cases-Complaints': rows('complaints', 2),
    'Cases-ExampleReview': rows('example-review', 1),
  });

  const result = await searchCases(client, {}, SOURCES);

  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.opts.listName),
    ['Cases-Complaints', 'Cases-ExampleReview']
  );
  assert.equal(result.rows.length, 3);
  assert.equal(result.capped, false);
});

test('searchCases: a Case Type filter scopes the read to that one list', async () => {
  const { client, calls } = recordingClient({
    'Cases-Complaints': rows('complaints', 2),
    'Cases-ExampleReview': rows('example-review', 3),
  });

  const result = await searchCases(
    client,
    { caseType: 'example-review' },
    SOURCES
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.listName, 'Cases-ExampleReview');
  assert.equal(result.rows.length, 3);
});

test('searchCases: passes the caller filters through and scopes each read to its own source', async () => {
  const { client, calls } = recordingClient({
    'Cases-Complaints': [],
    'Cases-ExampleReview': [],
  });

  await searchCases(
    client,
    {
      titlePrefix: 'CR-1',
      assignedReviewer: 'rev-a',
      reportableAfter: '2026-07-01T00:00:00.000Z',
      reportableBefore: '2026-07-08T00:00:00.000Z',
    },
    SOURCES
  );

  assert.deepEqual(calls[0].filter, {
    titlePrefix: 'CR-1',
    assignedReviewer: 'rev-a',
    reportableAfter: '2026-07-01T00:00:00.000Z',
    reportableBefore: '2026-07-08T00:00:00.000Z',
    caseType: 'complaints',
  });
  assert.equal(calls[1].filter.caseType, 'example-review');
});

test('searchCases: reads one row past the window so saturation is detectable', async () => {
  const { client, calls } = recordingClient({ 'Cases-Complaints': [] });

  await searchCases(client, {}, [SOURCES[0]]);

  assert.deepEqual(calls[0].opts, {
    listName: 'Cases-Complaints',
    top: SEARCH_PAGE_SIZE + 1,
    orderBy: 'id',
    orderDir: 'desc',
  });
});

test('searchCases: more matches than the window are capped and reported as capped', async () => {
  const { client } = recordingClient({
    'Cases-Complaints': rows('complaints', SEARCH_PAGE_SIZE + 1),
  });

  const result = await searchCases(client, {}, [SOURCES[0]]);

  assert.equal(result.rows.length, SEARCH_PAGE_SIZE);
  assert.equal(result.capped, true);
  // The numerically highest ids, most recent first — so the window holds the
  // newest matches, and the row dropped is the oldest rather than whichever one
  // a string comparison happened to rank last.
  assert.deepEqual(
    result.rows.map((row) => row.id),
    Array.from({ length: SEARCH_PAGE_SIZE }, (_, i) =>
      String(SEARCH_PAGE_SIZE + 1 - i)
    )
  );
});

test('searchCases: exactly a full window is not capped', async () => {
  const { client } = recordingClient({
    'Cases-Complaints': rows('complaints', SEARCH_PAGE_SIZE),
  });

  const result = await searchCases(client, {}, [SOURCES[0]]);

  assert.equal(result.rows.length, SEARCH_PAGE_SIZE);
  assert.equal(result.capped, false);
});

test('searchCases: one failing source fails the whole search', async () => {
  const client = {
    /** @param {any} _filter @param {any} opts */
    listCases(_filter, opts) {
      if (opts.listName === 'Cases-ExampleReview')
        return Promise.reject(new Error('403'));
      return Promise.resolve([]);
    },
  };

  // A quietly-missing Case reads as "not found", which is the one answer a
  // lookup must never give wrongly.
  await assert.rejects(
    () => searchCases(/** @type {any} */ (client), {}, SOURCES),
    /403/
  );
});

test('searchCases: the mount lifetime bound to the client reaches every per-source read', async () => {
  const controller = new AbortController();
  controller.abort();
  /** @type {any[]} */
  const seen = [];
  const client = {
    /** @param {any} _filter @param {any} opts */
    listCases(_filter, opts) {
      seen.push(opts.signal);
      return opts.signal?.aborted
        ? Promise.reject(opts.signal.reason)
        : Promise.resolve([]);
    },
  };

  await assert.rejects(() =>
    searchCases(
      withAbortSignal(/** @type {any} */ (client), controller.signal),
      {},
      SOURCES
    )
  );
  assert.deepEqual(seen, [controller.signal, controller.signal]);
});
