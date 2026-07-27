// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';

// Capability: the mount-lifetime AbortSignal reaches fetch on Case reads (#545).

const WEB_URL = 'https://sp.example.com/sites/cora';

/**
 * A fetch double that records the `RequestInit` it was handed and answers a
 * single empty page.
 */
function makeRecordingFetch() {
  /** @type {RequestInit[]} */
  const inits = [];
  return {
    inits,
    /** @type {(input: any, init?: RequestInit) => Promise<Response>} */
    fetch: async (_input, init) => {
      inits.push(init ?? {});
      return new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
}

test('HttpSharePointClient: listCases passes the caller signal to fetch', async () => {
  const { fetch, inits } = makeRecordingFetch();
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  const controller = new AbortController();

  await client.listCases(
    { status: 'In-progress' },
    { listName: 'Cases-Complaints', signal: controller.signal }
  );

  assert.equal(inits[0].signal, controller.signal);
});

test('HttpSharePointClient: a paged listCases read carries the signal too', async () => {
  const { fetch, inits } = makeRecordingFetch();
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  const controller = new AbortController();

  await client.listCases(
    {},
    { listName: 'Cases-Complaints', top: 25, signal: controller.signal }
  );

  assert.equal(inits[0].signal, controller.signal);
});

test('HttpSharePointClient: countCases and getCase pass the signal to fetch', async () => {
  const { fetch, inits } = makeRecordingFetch();
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  const controller = new AbortController();

  await client.countCases(
    {},
    { listName: 'Cases-Complaints', signal: controller.signal }
  );
  await client.getCase('c1', {
    listName: 'Cases-Complaints',
    signal: controller.signal,
  });

  assert.equal(inits[0].signal, controller.signal);
  assert.equal(inits[1].signal, controller.signal);
});

test('HttpSharePointClient: a read with no signal sends no signal key at all', async () => {
  const { fetch, inits } = makeRecordingFetch();
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await client.listCases({}, { listName: 'Cases-Complaints' });

  assert.equal('signal' in inits[0], false);
});

test('HttpSharePointClient: an aborted fetch rejection is not swallowed as a 404', async () => {
  const controller = new AbortController();
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async () => {
      controller.abort();
      throw controller.signal.reason;
    },
  });

  await assert.rejects(
    client.getCase('c1', {
      listName: 'Cases-Complaints',
      signal: controller.signal,
    }),
    { name: 'AbortError' }
  );
});

test('HttpSharePointClient: patchCase never sends a signal', async () => {
  /** @type {RequestInit[]} */
  const inits = [];
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async (_input, init) => {
      inits.push(init ?? {});
      if (/** @type {any} */ (init)?.method === 'POST') {
        return new Response(JSON.stringify({ FormDigestValue: 'digest' }), {
          status: 200,
        });
      }
      return new Response(null, { status: 204 });
    },
  });

  await client.patchCase(
    'c1',
    { notes: 'x' },
    '"1"',
    /** @type {any} */ ({
      listName: 'Cases-Complaints',
      signal: new AbortController().signal,
    })
  );

  assert.equal(
    inits.every((init) => !('signal' in init)),
    true,
    'no write request carries an AbortSignal'
  );
});

test('HttpSharePointClient: a 429 retry rechecks the signal instead of re-fetching a dead route (#545)', async () => {
  const controller = new AbortController();
  let fetches = 0;
  let slept = 0;
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async () => {
      fetches += 1;
      // Bounded so a regression fails the assertion rather than spinning: the
      // 429 loop only exits on a non-429 or a throw.
      if (fetches > 3)
        throw new Error('retried a request the caller abandoned');
      return new Response('', {
        status: 429,
        headers: { 'Retry-After': '30' },
      });
    },
    // The wait is where an abort is most likely to land: 30s of Retry-After
    // against a page the user has already left.
    sleep: async () => {
      slept += 1;
      controller.abort();
    },
  });

  await assert.rejects(
    client.listCases(
      {},
      { listName: 'Cases-Complaints', signal: controller.signal }
    ),
    { name: 'AbortError' }
  );
  assert.equal(fetches, 1, 'the retry after the abort is never issued');
  assert.equal(slept, 1);
});

test('HttpSharePointClient: a 429 retry with no signal still retries (#545)', async () => {
  let fetches = 0;
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async () => {
      fetches += 1;
      if (fetches === 1) {
        return new Response('', {
          status: 429,
          headers: { 'Retry-After': '1' },
        });
      }
      return new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    sleep: async () => {},
  });

  assert.deepEqual(
    await client.listCases({}, { listName: 'Cases-Complaints' }),
    []
  );
  assert.equal(fetches, 2);
});
