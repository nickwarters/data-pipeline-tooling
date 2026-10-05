// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';
import { withAbortSignal } from '../src/services/abortable-client.js';
import {
  WEB_URL,
  digestResponse,
  makeFetch,
} from './helpers/http-sharepoint-client.js';

// Capability: the Support Log is read per Case and appended to, never edited.

/** @typedef {import('../src/sharepoint-client.js').SupportLogEntry} SupportLogEntry */

/** @param {Partial<SupportLogEntry>} [overrides] @returns {SupportLogEntry} */
function entry(overrides = {}) {
  return {
    id: '1',
    caseType: 'complaints',
    caseId: '7',
    caseReference: 'CR-7',
    action: 'reassign',
    reason: 'Reviewer on leave.',
    changes: [{ field: 'assignedReviewer', before: 'a', after: 'b' }],
    outcome: 'recorded',
    relatesTo: null,
    createdAt: '2026-10-01T09:00:00Z',
    createdBy: 'Robin Maintainer',
    ...overrides,
  };
}

/** @param {Record<string, unknown>} [overrides] */
function logItem(overrides = {}) {
  return {
    Id: 3,
    Title: 'CR-7',
    CaseType: 'complaints',
    CaseId: '7',
    SupportAction: 'reassign',
    Reason: 'Reviewer on leave.',
    Changes: JSON.stringify([
      { field: 'assignedReviewer', before: 'a', after: 'b' },
    ]),
    Outcome: 'recorded',
    RelatesTo: null,
    Created: '2026-10-01T09:00:00Z',
    Author: { Title: 'Robin Maintainer', Name: 'i:0#.w|corp\\robin' },
    ...overrides,
  };
}

test('HttpSharePointClient: reads one Case’s Support Log from the prefixed list, newest first', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ value: [logItem()] }), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    listPrefix: 'uat_',
    fetchImpl: fetch,
  });

  const rows = await client.listSupportLog({
    caseType: 'complaints',
    caseId: "7'1",
  });

  const url = decodeURIComponent(calls[0].url);
  assert.match(url, /getbytitle\('uat_CaseSupportLog'\)\/items/);
  assert.match(url, /\$filter=CaseType eq 'complaints' and CaseId eq '7''1'/);
  assert.match(url, /\$expand=Author/);
  assert.match(url, /\$orderby=Created desc,Id desc/);
  assert.deepEqual(rows, [entry({ id: '3' })]);
});

test('HttpSharePointClient: a log entry with unreadable Changes is shown without them', async () => {
  const warn = console.warn;
  /** @type {unknown[][]} */
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    for (const Changes of ['{not json', '{"field":"x"}']) {
      const client = new HttpSharePointClient({
        webUrl: WEB_URL,
        fetchImpl: async () =>
          new Response(JSON.stringify({ value: [logItem({ Changes })] }), {
            status: 200,
          }),
      });
      const [row] = await client.listSupportLog({
        caseType: 'complaints',
        caseId: '7',
      });
      assert.deepEqual(row.changes, [], Changes);
    }
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 2);
  assert.match(String(warnings[0][0]), /Support Log entry "3"/);
});

test('HttpSharePointClient: a failure entry keeps its outcome and what it relates to', async () => {
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          value: [
            logItem({ Outcome: 'not-applied', RelatesTo: '2' }),
            // A hand-edited outcome is still an action that was taken.
            logItem({ Id: 2, Outcome: 'something else', Author: null }),
          ],
        }),
        { status: 200 }
      ),
  });

  const [failed, other] = await client.listSupportLog({
    caseType: 'complaints',
    caseId: '7',
  });
  assert.equal(failed.outcome, 'not-applied');
  assert.equal(failed.relatesTo, '2');
  assert.equal(other.outcome, 'recorded');
  assert.equal(other.relatesTo, null);
  assert.equal(other.createdBy, '');
});

test('HttpSharePointClient: appending posts the entry, never who or when, and returns its id', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
    },
    {
      when: (c) => c.method === 'POST',
      respond: () => new Response(JSON.stringify({ Id: 11 }), { status: 201 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    listPrefix: 'uat_',
    fetchImpl: fetch,
  });
  const { id: _id, createdAt: _at, createdBy: _by, ...written } = entry();

  const id = await client.addSupportLogEntry(written);

  assert.equal(id, '11');
  const post = calls.find(
    (c) => c.method === 'POST' && !c.url.endsWith('/_api/contextinfo')
  );
  assert.ok(post);
  assert.match(
    decodeURIComponent(post.url),
    /getbytitle\('uat_CaseSupportLog'\)\/items$/
  );
  assert.equal(post.headers['x-requestdigest'], 'd');
  assert.deepEqual(JSON.parse(String(post.body)), {
    Title: 'CR-7',
    CaseType: 'complaints',
    CaseId: '7',
    SupportAction: 'reassign',
    Reason: 'Reviewer on leave.',
    Changes: JSON.stringify(written.changes),
    Outcome: 'recorded',
    RelatesTo: '',
  });
});

test('HttpSharePointClient: an append the list does not acknowledge with an id fails', async () => {
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async (input) =>
      String(input).endsWith('/_api/contextinfo')
        ? digestResponse('d')
        : new Response(JSON.stringify({}), { status: 201 }),
  });
  const { id: _id, createdAt: _at, createdBy: _by, ...written } = entry();
  await assert.rejects(
    client.addSupportLogEntry({ ...written, relatesTo: '4' }),
    /did not return an id/
  );
});

test('MockSharePointClient: an appended entry is stamped with who and when, and read back newest first', async () => {
  const client = new MockSharePointClient({
    personas: { maintainer: { groups: [], displayName: 'Robin Maintainer' } },
    persona: 'maintainer',
    supportLog: [entry({ id: '1', createdAt: '2026-10-01T09:00:00Z' })],
    now: () => new Date('2026-10-05T12:00:00Z'),
  });
  const {
    id: _id,
    createdAt: _at,
    createdBy: _by,
    ...written
  } = entry({
    reason: 'Second',
  });

  const id = await client.addSupportLogEntry(written);
  const rows = await client.listSupportLog({
    caseType: 'complaints',
    caseId: '7',
  });

  assert.deepEqual(
    rows.map((row) => [row.id === id, row.reason, row.createdBy]),
    [
      [true, 'Second', 'Robin Maintainer'],
      [false, 'Reviewer on leave.', 'Robin Maintainer'],
    ]
  );
  assert.equal(rows[0].createdAt, '2026-10-05T12:00:00.000Z');
  assert.deepEqual(
    await client.listSupportLog({ caseType: 'complaints', caseId: '8' }),
    [],
    'another Case’s log is its own'
  );
});

test('MockSharePointClient: Support Log reads are copies, so a caller cannot rewrite the log', async () => {
  const client = new MockSharePointClient({
    personas: {},
    supportLog: [entry(), entry({ id: '2', createdAt: entry().createdAt })],
  });
  const first = await client.listSupportLog({
    caseType: 'complaints',
    caseId: '7',
  });
  assert.deepEqual(
    first.map((row) => row.id),
    ['2', '1'],
    'ties on time fall back to the newer id'
  );
  first[0].changes.push({ field: 'x', before: 1, after: 2 });
  const second = await client.listSupportLog({
    caseType: 'complaints',
    caseId: '7',
  });
  assert.equal(second[0].changes.length, 1);
});

test('the Support Log read is cancelled with the page that asked for it', async () => {
  const controller = new AbortController();
  controller.abort();
  const client = withAbortSignal(
    /** @type {any} */ (
      new MockSharePointClient({ personas: {}, supportLog: [entry()] })
    ),
    controller.signal
  );
  await assert.rejects(
    client.listSupportLog({ caseType: 'complaints', caseId: '7' }),
    (error) => /** @type {any} */ (error).name === 'AbortError'
  );
});
