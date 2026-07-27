// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { withAbortSignal } = await import('../src/services/abortable-client.js');

function recordingClient() {
  /** @type {any[]} */
  const calls = [];
  return {
    calls,
    client: /** @type {any} */ ({
      async getCase(/** @type {any} */ id, /** @type {any} */ opts) {
        calls.push(['getCase', id, opts]);
        return null;
      },
      async listCases(/** @type {any} */ filter, /** @type {any} */ opts) {
        calls.push(['listCases', filter, opts]);
        return [];
      },
      async countCases(/** @type {any} */ filter, /** @type {any} */ opts) {
        calls.push(['countCases', filter, opts]);
        return 0;
      },
      async patchCase(
        /** @type {any} */ id,
        /** @type {any} */ fields,
        /** @type {any} */ etag,
        /** @type {any} */ opts
      ) {
        calls.push(['patchCase', id, fields, etag, opts]);
        return { ok: true, status: 200 };
      },
      async searchPeople(/** @type {any} */ query) {
        calls.push(['searchPeople', query]);
        return [];
      },
    }),
  };
}

test('abortable client: the mount signal rides every Case read', async () => {
  const { client, calls } = recordingClient();
  const controller = new AbortController();
  const bound = withAbortSignal(client, controller.signal);

  await bound.getCase('c1', { listName: 'Cases-Complaints' });
  await bound.listCases({ status: 'In-progress' }, { listName: 'L', top: 10 });
  await bound.countCases({ status: 'In-progress' }, { listName: 'L' });

  assert.deepEqual(calls[0], [
    'getCase',
    'c1',
    { listName: 'Cases-Complaints', signal: controller.signal },
  ]);
  assert.deepEqual(calls[1], [
    'listCases',
    { status: 'In-progress' },
    { listName: 'L', top: 10, signal: controller.signal },
  ]);
  assert.deepEqual(calls[2], [
    'countCases',
    { status: 'In-progress' },
    { listName: 'L', signal: controller.signal },
  ]);
});

test('abortable client: a read called with no options still carries the signal', async () => {
  const { client, calls } = recordingClient();
  const controller = new AbortController();

  await withAbortSignal(client, controller.signal).listCases({});

  assert.deepEqual(calls[0], ['listCases', {}, { signal: controller.signal }]);
});

test('abortable client: writes are never given the signal', async () => {
  const { client, calls } = recordingClient();
  const controller = new AbortController();

  await withAbortSignal(client, controller.signal).patchCase(
    'c1',
    { notes: 'x' },
    'etag-1',
    { listName: 'L' }
  );

  assert.deepEqual(calls[0], [
    'patchCase',
    'c1',
    { notes: 'x' },
    'etag-1',
    { listName: 'L' },
  ]);
});

test('abortable client: non-Case reads are forwarded untouched', async () => {
  const { client, calls } = recordingClient();
  const controller = new AbortController();

  await withAbortSignal(client, controller.signal).searchPeople('ann');

  assert.deepEqual(calls[0], ['searchPeople', 'ann']);
});

test('abortable client: a missing method stays missing, so capability probes still work', () => {
  const controller = new AbortController();
  const bound = withAbortSignal(
    /** @type {any} */ ({ listCases: async () => [] }),
    controller.signal
  );

  assert.equal(typeof (/** @type {any} */ (bound).countCases), 'undefined');
  assert.equal(typeof bound.listCases, 'function');
});

test('abortable client: with no signal the original client is returned unchanged', () => {
  const { client } = recordingClient();
  assert.equal(withAbortSignal(client, undefined), client);
});

test('abortable client: a class-based client keeps working through the wrapper', async () => {
  const { MockSharePointClient } =
    await import('../src/services/mock-sharepoint-client.js');
  const controller = new AbortController();
  const mock = new MockSharePointClient({
    personas: { reviewer: { groups: [] } },
    lists: { L: [] },
  });

  const bound = withAbortSignal(/** @type {any} */ (mock), controller.signal);
  assert.deepEqual(await bound.listCases({}, { listName: 'L' }), []);
});

test('abortable client: a falsy client is returned unchanged rather than proxied (#545)', () => {
  const controller = new AbortController();
  // `new Proxy(null, …)` throws synchronously; inside a route effect's start()
  // that would turn a client-less mount into a route failure.
  assert.equal(
    withAbortSignal(/** @type {any} */ (null), controller.signal),
    null
  );
  assert.equal(
    withAbortSignal(/** @type {any} */ (undefined), controller.signal),
    undefined
  );
});
