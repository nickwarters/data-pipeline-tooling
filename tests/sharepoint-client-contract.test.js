// @ts-check
/**
 * MAINT-14: a shared behavioural contract test for every SharePointClient
 * implementation. MockSharePointClient and HttpSharePointClient are
 * unrelated classes that each satisfy the `SharePointClient` typedef
 * (src/sharepoint-client.js:279-292) independently; this suite asserts they
 * actually *behave* the same for the handful of edge cases production code
 * depends on (null-vs-throw, filter semantics, conflict shape, etc).
 *
 * Structure: `for (const [name, makeClient] of clients) describe(name, ...)`
 * so a third implementation joins the contract by adding one factory to
 * `clients` below — no test bodies change.
 *
 * The HTTP side stubs `fetch` via the `fetchImpl` constructor option (the
 * same mechanism tests/http-sharepoint-client.test.js already uses) backed
 * by `makeSpBackend`, a tiny in-memory fake SharePoint REST endpoint that
 * understands just enough OData ($filter eq/and, $count, ETag/If-Match) to
 * exercise the same seed data the Mock client is constructed with.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').PersonResult} PersonResult */

const WEB_URL = 'https://sp.example.com/sites/casereview';

// --- seed data ---------------------------------------------------------

/** @returns {CaseRow[]} */
function seedCases() {
  return [
    {
      id: 'case-1',
      caseType: 'example-review',
      title: 'Example Review #1',
      status: 'In-progress',
      assignedReviewer: 'user-1',
      responsibleParty: 'user-2',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      etag: 'etag-1',
    },
    {
      id: 'case-2',
      caseType: 'example-review',
      title: 'Example Review #2',
      status: 'In-progress',
      assignedReviewer: 'user-2',
      responsibleParty: 'user-3',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: null,
      etag: 'etag-2',
    },
    {
      id: 'case-3',
      caseType: 'example-review',
      title: 'Example Review #3',
      status: 'Completed',
      assignedReviewer: 'user-1',
      responsibleParty: 'user-4',
      answers: {},
      conversation: [],
      notes: '',
      completedAt: '2026-05-07T00:00:00Z',
      etag: 'etag-3',
    },
  ];
}

/** @returns {PersonResult[]} */
function seedPeople() {
  return [{ loginName: 'user-1', displayName: 'Reviewer One' }];
}

// --- fake SharePoint REST backend for the HTTP side ---------------------

/** @param {CaseRow} row */
function toSpItem(row) {
  return {
    Id: row.id,
    Title: row.title,
    Status: row.status,
    CaseType: row.caseType,
    AssignedReviewerId: row.assignedReviewer,
    ResponsiblePartyId: row.responsibleParty,
    Answers: JSON.stringify(row.answers ?? {}),
    Conversation: JSON.stringify(row.conversation ?? []),
    Notes: row.notes ?? '',
    CompletedAt: row.completedAt ?? null,
  };
}

/**
 * Evaluate a `$filter` expression this suite's `listCases`/`countCases`
 * calls can produce: `Field eq 'value'` clauses ANDed with ` and `.
 * @param {string} expr
 * @param {Record<string, unknown>} item
 */
function matchesFilterExpr(expr, item) {
  if (!expr) return true;
  return expr.split(' and ').every((cond) => {
    const m = cond.match(/^(\w+) eq '([^']*)'$/);
    if (!m) {
      throw new Error(
        `sharepoint-client-contract test backend: unsupported $filter clause "${cond}"`
      );
    }
    const [, field, value] = m;
    return String(item[field] ?? '') === value;
  });
}

/**
 * @param {RequestInit | undefined} init
 * @param {string} name
 */
function readHeader(init, name) {
  const h = /** @type {any} */ (init?.headers);
  if (!h) return undefined;
  if (h instanceof Headers) return h.get(name) ?? undefined;
  return h[name];
}

/**
 * A minimal in-memory fake of the SharePoint REST endpoints
 * HttpSharePointClient calls, backed by the same seed shape used to
 * construct MockSharePointClient, so both implementations can be driven
 * through identical scenarios.
 *
 * @param {{ cases?: CaseRow[], people?: PersonResult[], exportHashes?: Record<string,string>, versionedExports?: Record<string, unknown> }} seed
 */
function makeSpBackend(seed) {
  const store = new Map((seed.cases ?? []).map((c) => [c.id, { ...c }]));
  const people = new Map((seed.people ?? []).map((p) => [p.loginName, p]));
  const exportHashes = seed.exportHashes ?? {};
  const versionedExports = seed.versionedExports ?? {};
  let etagCounter = 1000;

  /**
   * @param {RequestInfo | URL} input
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}
   */
  async function fetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init.method ?? 'GET').toUpperCase();

    if (url.endsWith('/_api/contextinfo')) {
      return new Response(JSON.stringify({ FormDigestValue: 'test-digest' }), {
        status: 200,
      });
    }

    const propsMatch = url.match(
      /GetPropertiesFor\(accountName=@v\)\?@v=(.+)$/
    );
    if (propsMatch) {
      const login = decodeURIComponent(propsMatch[1]).replace(/^'|'$/g, '');
      // login is the reattached claims login (i:0#.w|CONTOSO\bare); recover
      // the bare account the same way HttpSharePointClient's callers do.
      const bare = login.slice(login.lastIndexOf('\\') + 1);
      const person = people.get(bare);
      if (!person) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify({ DisplayName: person.displayName }), {
        status: 200,
      });
    }

    const exportMatch = url.match(/case-types\/([^./]+)\.json$/);
    if (exportMatch) {
      const slug = decodeURIComponent(exportMatch[1]);
      const hash = exportHashes[slug];
      if (hash === undefined) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify({ hash }), { status: 200 });
    }

    const versionedMatch = url.match(/case-types\/([^./]+)\.([^./]+)\.json$/);
    if (versionedMatch) {
      const hash = decodeURIComponent(versionedMatch[2]);
      const body = versionedExports[hash];
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }

    const itemMatch = url.match(/items\('([^']+)'\)/);
    if (itemMatch) {
      const id = decodeURIComponent(itemMatch[1]);
      const row = store.get(id);
      if (method === 'GET') {
        if (!row) return new Response('not found', { status: 404 });
        return new Response(JSON.stringify(toSpItem(row)), {
          status: 200,
          headers: { ETag: `"${row.etag}"` },
        });
      }
      if (method === 'PATCH') {
        if (!row) return new Response('not found', { status: 404 });
        const ifMatch = readHeader(init, 'If-Match');
        if (ifMatch !== `"${row.etag}"`) {
          return new Response('precondition failed', { status: 412 });
        }
        const body = init.body ? JSON.parse(String(init.body)) : {};
        if (body.Title !== undefined) row.title = body.Title;
        if (body.Status !== undefined) row.status = body.Status;
        if (body.Notes !== undefined) row.notes = body.Notes;
        row.etag = String(++etagCounter);
        return new Response(null, {
          status: 204,
          headers: { ETag: `"${row.etag}"` },
        });
      }
    }

    const countMatch = url.match(/\/items\/\$count(\?.*)?$/);
    if (countMatch) {
      const filterExpr = decodeFilterExpr(url);
      const n = [...store.values()].filter((row) =>
        matchesFilterExpr(filterExpr, toSpItem(row))
      ).length;
      return new Response(JSON.stringify(n), { status: 200 });
    }

    if (url.includes('/items') && method === 'GET') {
      const filterExpr = decodeFilterExpr(url);
      const rows = [...store.values()].filter((row) =>
        matchesFilterExpr(filterExpr, toSpItem(row))
      );
      return new Response(JSON.stringify({ value: rows.map(toSpItem) }), {
        status: 200,
      });
    }

    throw new Error(
      `sharepoint-client-contract test backend: no route for ${method} ${url}`
    );
  }

  return { fetch };
}

/** @param {string} url */
function decodeFilterExpr(url) {
  const m = url.match(/\$filter=([^&]*)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// --- the two implementations under test ---------------------------------

/**
 * @typedef {{ cases?: CaseRow[], people?: PersonResult[], exportHashes?: Record<string,string>, versionedExports?: Record<string, unknown> }} Seed
 */

// Every Case lives in a named per-Case-Type list store on both
// implementations post-strictness-flip; 'Cases-Test' is this suite's
// standard list name so every contract test targets the same store.
const LIST = 'Cases-Test';

/** @type {Array<[string, (seed: Seed) => import('../src/sharepoint-client.js').SharePointClient]>} */
const clients = [
  [
    'MockSharePointClient',
    (seed) =>
      new MockSharePointClient({
        lists: { [LIST]: seed.cases ?? [] },
        personas: { reviewer: { groups: [] } },
        people: seed.people ?? [],
        exportHashes: seed.exportHashes ?? {},
        versionedExports: /** @type {any} */ (seed.versionedExports ?? {}),
      }),
  ],
  [
    'HttpSharePointClient',
    (seed) => {
      const { fetch } = makeSpBackend(seed);
      return new HttpSharePointClient({ webUrl: WEB_URL, fetchImpl: fetch });
    },
  ],
];

for (const [name, makeClient] of clients) {
  describe(`SharePointClient contract: ${name}`, () => {
    test('getCase: unknown id resolves to null, never throws', async () => {
      const client = makeClient({ cases: seedCases() });
      const row = await client.getCase('does-not-exist', { listName: LIST });
      assert.equal(row, null);
    });

    test('patchCase: stale ETag returns a {ok:false, status:412} conflict, no data field', async () => {
      const client = makeClient({ cases: seedCases() });
      const result = await client.patchCase(
        'case-1',
        { title: 'Attempted update' },
        '"stale-etag-does-not-match"',
        { listName: LIST }
      );
      assert.equal(result.ok, false);
      assert.equal(result.status, 412);
      assert.equal(result.data, undefined);

      // the write must not have applied
      const unchanged = await client.getCase('case-1', { listName: LIST });
      assert.equal(unchanged?.title, 'Example Review #1');
    });

    test('patchCase: matching ETag succeeds with an {ok:true, status, data} result', async () => {
      const client = makeClient({ cases: seedCases() });
      const before = await client.getCase('case-1', { listName: LIST });
      const result = await client.patchCase(
        'case-1',
        { title: 'Updated title' },
        /** @type {string} */ (before?.etag),
        { listName: LIST }
      );
      assert.equal(result.ok, true);
      assert.equal(result.data?.title, 'Updated title');
    });

    test('listCases: status filter returns the same row-id set from equivalent seed data', async () => {
      const client = makeClient({ cases: seedCases() });
      const rows = await client.listCases(
        { status: 'In-progress' },
        { listName: LIST }
      );
      assert.deepEqual(rows.map((r) => r.id).sort(), ['case-1', 'case-2']);
    });

    test('listCases: assignedReviewer filter returns the same row-id set from equivalent seed data', async () => {
      const client = makeClient({ cases: seedCases() });
      const rows = await client.listCases(
        { assignedReviewer: 'user-1' },
        { listName: LIST }
      );
      assert.deepEqual(rows.map((r) => r.id).sort(), ['case-1', 'case-3']);
    });

    test('listCases: combined status + assignedReviewer filter ANDs the conditions identically', async () => {
      const client = makeClient({ cases: seedCases() });
      const rows = await client.listCases(
        {
          status: 'In-progress',
          assignedReviewer: 'user-1',
        },
        { listName: LIST }
      );
      assert.deepEqual(
        rows.map((r) => r.id),
        ['case-1']
      );
    });

    test('countCases: stays consistent with listCases(...).length for the same filter', async () => {
      const client = makeClient({ cases: seedCases() });
      const filter = { status: 'In-progress' };
      const rows = await client.listCases(filter, { listName: LIST });
      const count = await client.countCases(filter, { listName: LIST });
      assert.equal(count, rows.length);
    });

    test('resolveUsers: an unknown account resolves to a present key with a null value, never a missing key', async () => {
      const client = makeClient({ cases: seedCases(), people: seedPeople() });
      const result = await client.resolveUsers(['user-1', 'ghost-account']);
      assert.equal(result['user-1'], 'Reviewer One');
      assert.ok(
        Object.prototype.hasOwnProperty.call(result, 'ghost-account'),
        'unknown account must be a present key, not omitted'
      );
      assert.equal(result['ghost-account'], null);
    });

    test('resolveUsers: an account name that collides with an Object.prototype key still resolves to a present null key', async () => {
      // Divergence found by this ticket: MockSharePointClient previously
      // guarded its dedupe with `account in out`, which is true for
      // Object.prototype members (e.g. "toString", "constructor") even
      // before that key is ever assigned — so an unlucky account name would
      // silently skip the assignment and leave the key "missing" (reading
      // it returned the inherited function, not `null`). Fixed in this
      // ticket by checking `Object.prototype.hasOwnProperty.call` instead.
      const client = makeClient({ cases: seedCases(), people: seedPeople() });
      const result = await client.resolveUsers(['toString', 'constructor']);
      assert.ok(
        Object.prototype.hasOwnProperty.call(result, 'toString'),
        '"toString" must be a present own key'
      );
      assert.equal(result['toString'], null);
      assert.ok(
        Object.prototype.hasOwnProperty.call(result, 'constructor'),
        '"constructor" must be a present own key'
      );
      assert.equal(result['constructor'], null);
    });

    test('getExportHash: missing export resolves to null, never throws', async () => {
      const client = makeClient({ cases: seedCases(), exportHashes: {} });
      const hash = await client.getExportHash('unknown-slug');
      assert.equal(hash, null);
    });

    test('getVersionedExport: missing export resolves to null, never throws', async () => {
      const client = makeClient({ cases: seedCases(), versionedExports: {} });
      const result = await client.getVersionedExport(
        'unknown-slug',
        'no-such-hash'
      );
      assert.equal(result, null);
    });
  });
}

// --- known, documented divergences (not fixed in this ticket) -----------
//
// 0. RESOLVED by the strictness flip: `listCases`/`countCases`/`getCase`/
//    `patchCase` now require `opts.listName` on both implementations, and
//    MockSharePointClient scopes strictly to the named list store (no more
//    default-store aggregation via the old `_allCases()`). `?mock=1` now
//    catches a page passing the wrong `listName` to a list-scoped query,
//    same as the real HTTP client. See tests/mock-sharepoint-client.test.js
//    for the scoping coverage.
//
// 1. `patchCase` against an id that does not exist at all: both
//    implementations return `{ ok: false, status: 404 }` today (verified by
//    reading both call paths), but this is not exercised above because
//    simulating a real SharePoint 404-on-PATCH-of-a-missing-item precisely
//    (vs. a stale-ETag 412) requires assumptions about server behaviour this
//    suite cannot verify without a real SharePoint list. Follow-up: verify
//    against a real SP Online/SE list and lock the behaviour down here.
//
// 2. `MockSharePointClient.inject412()` is a test-only hook with no
//    HTTP-side equivalent (the HTTP side is driven entirely by what the
//    stubbed `fetch` returns, per `patchCase: stale ETag ...` above) — this
//    is intentional test ergonomics, not a production behavioural
//    difference, so it is not asserted as a contract case.
