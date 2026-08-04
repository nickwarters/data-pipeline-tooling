// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { MockSharePointClient } =
  await import('../src/services/mock-sharepoint-client.js');

/** @param {string} id */
function row(id) {
  return /** @type {any} */ ({
    id,
    caseType: 'complaints',
    title: `Case ${id}`,
    status: 'In-progress',
    assignedReviewer: 'r',
    responsibleParty: 'rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'e1',
  });
}

function client() {
  return new MockSharePointClient({
    personas: { reviewer: { groups: [] } },
    lists: { 'Cases-Complaints': [row('c1')] },
  });
}

test('mock client: a read aborted while in flight rejects instead of resolving', async () => {
  const mock = client();
  const controller = new AbortController();

  const pending = mock.listCases(
    {},
    { listName: 'Cases-Complaints', signal: controller.signal }
  );
  controller.abort();

  await assert.rejects(pending, (error) => {
    assert.equal(/** @type {any} */ (error).name, 'AbortError');
    return true;
  });
});

test('mock client: getCase and countCases honour the signal too', async () => {
  const mock = client();
  const controller = new AbortController();

  const cases = mock.getCase('c1', {
    listName: 'Cases-Complaints',
    signal: controller.signal,
  });
  const count = mock.countCases(
    {},
    { listName: 'Cases-Complaints', signal: controller.signal }
  );
  controller.abort();

  await assert.rejects(cases, { name: 'AbortError' });
  await assert.rejects(count, { name: 'AbortError' });
});

test('mock client: a read that starts already-aborted never returns data', async () => {
  const mock = client();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    mock.listCases(
      {},
      { listName: 'Cases-Complaints', signal: controller.signal }
    ),
    { name: 'AbortError' }
  );
});

test('mock client: an un-aborted signal changes nothing about the result', async () => {
  const mock = client();
  const controller = new AbortController();

  const rows = await mock.listCases(
    {},
    { listName: 'Cases-Complaints', signal: controller.signal }
  );

  assert.deepEqual(
    rows.map((r) => r.id),
    ['c1']
  );
});

test('mock client: a write is never cancelled by an aborted signal', async () => {
  const mock = client();
  const controller = new AbortController();
  controller.abort();

  const result = await mock.patchCase(
    'c1',
    { notes: 'survives' },
    'e1',
    /** @type {any} */ ({
      listName: 'Cases-Complaints',
      signal: controller.signal,
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.data?.notes, 'survives');
});
