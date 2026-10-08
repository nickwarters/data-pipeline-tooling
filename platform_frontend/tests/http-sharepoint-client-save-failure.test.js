// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import {
  WEB_URL,
  digestResponse,
  ensureUserResponse,
  makeFetch,
  personWriteClient,
} from './helpers/http-sharepoint-client.js';

// Capability: a failed write says why it failed, and text SharePoint would
// refuse never reaches it.

const OPTS = { listName: 'Cases-ExampleReview' };

/** @param {unknown} body @param {number} status */
const spError = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** @param {string} message */
const nometadataError = (message) => ({
  'odata.error': {
    code: '-1, Microsoft.SharePoint.Client',
    message: { lang: 'en-US', value: message },
  },
});

/**
 * A client whose PATCH answers `respond`; everything else a save needs works.
 *
 * @param {() => Response | Promise<Response>} respond
 */
function patchAnswering(respond) {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: /** @type {() => Response} */ (respond),
    },
    {
      // The confirmation read after a 204.
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ Id: 'case-1', Title: 'T' }), {
          status: 200,
        }),
    },
  ]);
  return {
    client: new HttpSharePointClient({ webUrl: WEB_URL, fetchImpl: fetch }),
    calls,
  };
}

/** @param {HttpSharePointClient} client */
const saveNotes = (client) =>
  client.patchCase('case-1', { notes: 'x' }, '"v1"', OPTS);

// --- what SharePoint said ---

test("save failure: SharePoint's own message reaches the failure for a 500 it explains", async () => {
  const { client } = patchAnswering(() =>
    spError(nometadataError('The server is on fire'), 500)
  );

  const result = await saveNotes(client);

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.deepEqual(result.failure, {
    reason: 'unknown',
    message: 'The server is on fire',
  });
});

test('save failure: a verbose error envelope carries the message too', async () => {
  const { client } = patchAnswering(() =>
    spError(
      {
        error: {
          code: 'x',
          message: { lang: 'en-US', value: 'Verbose words' },
        },
      },
      500
    )
  );

  const result = await saveNotes(client);

  assert.equal(result.failure?.message, 'Verbose words');
});

test("save failure: a 400 is a refused value, with SharePoint's message", async () => {
  const { client } = patchAnswering(() =>
    spError(nometadataError('The field Notes is too long'), 400)
  );

  const result = await saveNotes(client);

  assert.deepEqual(result.failure, {
    reason: 'invalid-value',
    message: 'The field Notes is too long',
  });
});

test('save failure: a 500 whose message names an invalid character is a refused value', async () => {
  const { client } = patchAnswering(() =>
    spError(
      nometadataError(
        "'\u000B', hexadecimal value 0x0B, is an invalid character."
      ),
      500
    )
  );

  const result = await saveNotes(client);

  assert.equal(result.status, 500);
  assert.equal(result.failure?.reason, 'invalid-value');
});

test('save failure: a plain 500 with no explanation is unknown', async () => {
  const { client } = patchAnswering(() => new Response('', { status: 500 }));

  const result = await saveNotes(client);

  assert.deepEqual(result.failure, { reason: 'unknown' });
});

test('save failure: statuses that say the server is down, refused or missing are classified', async () => {
  const expected = /** @type {const} */ ({
    503: 'unavailable',
    403: 'forbidden',
    404: 'not-found',
  });
  for (const [status, reason] of Object.entries(expected)) {
    const { client } = patchAnswering(
      () => new Response('', { status: Number(status) })
    );

    const result = await saveNotes(client);

    assert.equal(result.status, Number(status));
    assert.equal(result.failure?.reason, reason, status);
  }
});

test('save failure: an error body that cannot be read costs the message and nothing else', async () => {
  const bodies = [
    () => new Response('<html>Bad gateway</html>', { status: 500 }),
    () => spError({ unrelated: true }, 500),
    () => spError(null, 500),
    () => spError(nometadataError(''), 500),
    // A test double with no text(), and one with neither text() nor json().
    () =>
      /** @type {Response} */ (
        /** @type {unknown} */ ({
          ok: false,
          status: 500,
          json: async () => nometadataError('From json'),
        })
      ),
    () =>
      /** @type {Response} */ (
        /** @type {unknown} */ ({ ok: false, status: 500 })
      ),
  ];
  const messages = [];
  for (const body of bodies) {
    const { client } = patchAnswering(body);
    const result = await saveNotes(client);
    assert.equal(result.status, 500);
    messages.push(result.failure?.message);
  }
  assert.deepEqual(messages, [
    undefined,
    undefined,
    undefined,
    undefined,
    'From json',
    undefined,
  ]);
});

// --- no response at all ---

test('save failure: a fetch that rejects is status 0 and a network failure', async () => {
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });

  const result = await saveNotes(client);

  assert.deepEqual(result, {
    ok: false,
    status: 0,
    failure: { reason: 'network' },
  });
});

test('save failure: a rejection that is not an Error is still a lost connection', async () => {
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async () => {
      throw 'offline';
    },
  });

  const result = await saveNotes(client);

  assert.equal(result.status, 0);
});

test('save failure: a lost connection on the retry after a 403 is still status 0', async () => {
  let patches = 0;
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () => {
        patches++;
        if (patches === 1) return new Response('expired', { status: 403 });
        throw new TypeError('Failed to fetch');
      },
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await saveNotes(client);

  assert.equal(patches, 2);
  assert.equal(result.status, 0);
});

test('save failure: an expired digest is still refreshed once and the write retried', async () => {
  let digests = 0;
  let patches = 0;
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse(`d${++digests}`),
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () =>
        ++patches === 1
          ? new Response('expired', { status: 403 })
          : new Response(null, { status: 204, headers: { ETag: '"v2"' } }),
    },
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ Id: 'case-1', Title: 'T' }), {
          status: 200,
        }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await saveNotes(client);

  assert.equal(result.ok, true);
  assert.equal(digests, 2);
});

test('save failure: an abort on a read is still the abort, not a lost connection', async () => {
  const controller = new AbortController();
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async () => {
      throw new DOMException('aborted', 'AbortError');
    },
  });

  await assert.rejects(
    () => client.getCase('case-1', { ...OPTS, signal: controller.signal }),
    (/** @type {any} */ err) =>
      err.name === 'AbortError' && err.status === undefined
  );
});

test('save failure: a failure with no status at all is a bug and stays a 500 that is unknown', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => new Response(JSON.stringify({}), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await saveNotes(client);

  assert.deepEqual(result, {
    ok: false,
    status: 500,
    failure: { reason: 'unknown' },
  });
});

// --- the person who could not be found ---

test('save failure: an EnsureUser the server refuses names the Responsible Party', async () => {
  const { client } = personWriteClient(
    spError(nometadataError('User cannot be found.'), 500)
  );

  const result = await client.patchCase(
    'case-1',
    { responsibleParty: 'jsmith' },
    '"v1"',
    OPTS
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.deepEqual(result.failure, {
    reason: 'person-not-found',
    account: 'jsmith',
  });
});

test('save failure: an EnsureUser with no usable id names the Reviewer and the Void actor', async () => {
  for (const field of /** @type {const} */ (['assignedReviewer', 'voidedBy'])) {
    const { client } = personWriteClient(spError({ Title: 'No id' }, 200));

    const result = await client.patchCase(
      'case-1',
      { [field]: 'jsmith' },
      '"v1"',
      OPTS
    );

    assert.equal(result.status, 500, field);
    assert.deepEqual(
      result.failure,
      { reason: 'person-not-found', account: 'jsmith' },
      field
    );
  }
});

test('save failure: an EnsureUser the server could not answer is the connection, not the person', async () => {
  for (const [status, reason] of [
    [502, 'unavailable'],
    [503, 'unavailable'],
    [504, 'unavailable'],
    [403, 'forbidden'],
    [401, 'forbidden'],
  ]) {
    const { client } = personWriteClient(
      new Response('', { status: Number(status) })
    );

    const result = await client.patchCase(
      'case-1',
      { responsibleParty: 'jsmith' },
      '"v1"',
      OPTS
    );

    assert.equal(result.status, status);
    assert.equal(result.failure?.reason, reason, String(status));
  }
});

test('save failure: an EnsureUser that never reached the server is a network failure', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
    },
    {
      when: (c) => c.url.endsWith('/_api/web/ensureuser'),
      respond: () => {
        throw new TypeError('Failed to fetch');
      },
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase(
    'case-1',
    { responsibleParty: 'jsmith' },
    '"v1"',
    OPTS
  );

  assert.deepEqual(result, {
    ok: false,
    status: 0,
    failure: { reason: 'network' },
  });
});

test('save failure: a digest that cannot be had is not blamed on the person', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => new Response('', { status: 500 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase(
    'case-1',
    { responsibleParty: 'jsmith' },
    '"v1"',
    OPTS
  );

  assert.deepEqual(result.failure, { reason: 'unknown' });
});

test('save failure: a person filter whose account cannot be resolved still rejects', async () => {
  const { client } = personWriteClient(new Response('', { status: 500 }));

  await assert.rejects(
    () => client.listCases({ assignedReviewer: 'ghost' }, OPTS),
    /HTTP Error: 500/
  );
});

// --- a manager nobody can resolve ---

/**
 * A client in which the directory knows `known` and refuses everyone else, and
 * which reports `manager` as the Responsible Party's manager.
 *
 * @param {string} manager
 * @param {string[]} known
 */
function clientWithManager(manager, known) {
  /** @type {import('./helpers/http-sharepoint-client.js').CapturedCall | null} */
  let ensureCall = null;
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
    },
    {
      when: (c) => c.url.includes('GetPropertiesFor'),
      respond: () =>
        new Response(
          JSON.stringify({
            DisplayName: 'Person',
            UserProfileProperties: [{ Key: 'Manager', Value: manager }],
          }),
          { status: 200 }
        ),
    },
    {
      when: (c) => {
        if (!c.url.endsWith('/_api/web/ensureuser')) return false;
        ensureCall = c;
        return true;
      },
      respond: () => {
        const logon = String(JSON.parse(String(ensureCall?.body)).logonName);
        const account = logon.slice(logon.lastIndexOf('\\') + 1);
        return known.includes(account)
          ? ensureUserResponse(known.indexOf(account) + 20)
          : new Response('no such user', { status: 500 });
      },
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () => new Response(null, { status: 204 }),
    },
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ Id: 'case-1', Title: 'T' }), {
          status: 200,
        }),
    },
  ]);
  return {
    client: new HttpSharePointClient({ webUrl: WEB_URL, fetchImpl: fetch }),
    calls,
  };
}

test('save failure: a Responsible Party whose manager cannot be resolved is saved with no manager', async () => {
  const { client, calls } = clientWithManager('i:0#.w|CONTOSO\\boss', [
    'jsmith',
  ]);

  const result = await client.patchCase(
    'case-1',
    { responsibleParty: 'jsmith' },
    '"v1"',
    OPTS
  );

  assert.equal(result.ok, true);
  const body = JSON.parse(
    String(calls.find((c) => c.method === 'PATCH')?.body)
  );
  assert.equal(body.ResponsiblePartyId, 20);
  assert.equal(body.ResponsiblePartyManagerId, null);
});

test('save failure: a Reviewer whose manager cannot be resolved is saved with no manager', async () => {
  const { client, calls } = clientWithManager('x', ['jsmith']);

  const result = await client.patchCase(
    'case-1',
    { assignedReviewer: 'jsmith', assignedReviewerManager: 'boss' },
    '"v1"',
    OPTS
  );

  assert.equal(result.ok, true);
  const body = JSON.parse(
    String(calls.find((c) => c.method === 'PATCH')?.body)
  );
  assert.equal(body.AssignedReviewerId, 20);
  assert.equal(body.AssignedReviewerManagerId, null);
});

test('save failure: the Responsible Party failing is still the failure when their manager resolves', async () => {
  const { client } = clientWithManager('i:0#.w|CONTOSO\\boss', ['boss']);

  const result = await client.patchCase(
    'case-1',
    { responsibleParty: 'jsmith' },
    '"v1"',
    OPTS
  );

  assert.deepEqual(result.failure, {
    reason: 'person-not-found',
    account: 'jsmith',
  });
});

test('save failure: a manager lookup that loses the connection still fails the save', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
    },
    {
      when: (c) => c.url.endsWith('/_api/web/ensureuser'),
      respond: () => new Response('', { status: 503 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const result = await client.patchCase(
    'case-1',
    { assignedReviewer: '', assignedReviewerManager: 'boss' },
    '"v1"',
    OPTS
  );

  assert.deepEqual(result.failure, { reason: 'unavailable' });
});

// --- text SharePoint would refuse ---

/** @param {import('./helpers/http-sharepoint-client.js').CapturedCall[]} calls */
const patchBody = (calls) =>
  JSON.parse(String(calls.find((c) => c.method === 'PATCH')?.body));

test('storable text: control characters are cleaned from Notes and Case Justification before the PATCH', async () => {
  const { client, calls } = patchAnswering(
    () => new Response(null, { status: 204 })
  );
  const dirty = (/** @type {string} */ word) =>
    `${word}\u0001 one\u000Btwo\u0000 \u{1F600} \u201Cquoted\u201D \u2014 a\u00A0b\uD83D end`;

  await client.patchCase(
    'case-1',
    { notes: dirty('notes'), caseJustification: dirty('why') },
    '"v1"',
    OPTS
  );

  const body = patchBody(calls);
  const clean = (/** @type {string} */ word) =>
    `${word} one\ntwo \u{1F600} \u201Cquoted\u201D \u2014 a\u00A0b end`;
  assert.equal(body.Notes, clean('notes'));
  assert.equal(body.CaseJustification, clean('why'));
});

test('storable text: values that are not text pass through the PATCH untouched', async () => {
  const { client, calls } = patchAnswering(
    () => new Response(null, { status: 204 })
  );

  await client.patchCase(
    'case-1',
    {
      onHold: true,
      completedAt: null,
      answers: { q: { value: 'a\u000Bb' } },
    },
    '"v1"',
    OPTS
  );

  const body = patchBody(calls);
  assert.equal(body.OnHold, true);
  assert.equal(body.CompletedAt, null);
  assert.deepEqual(JSON.parse(body.Answers), { q: { value: 'a\u000Bb' } });
});

test('storable text: the reason on a Support Log or Access Log entry is cleaned', async () => {
  /** @type {string[]} */
  const written = [];
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async (input, init = {}) => {
      if (String(input).endsWith('/_api/contextinfo')) {
        return digestResponse('d');
      }
      written.push(JSON.parse(String(init.body)).Reason);
      return new Response(JSON.stringify({ Id: 1 }), { status: 200 });
    },
  });

  await client.addSupportLogEntry({
    caseType: 'x',
    caseId: '1',
    caseReference: 'R-1',
    action: 'reassign',
    reason: 'moved\u000Bnow\u0001',
    changes: [],
    outcome: 'recorded',
    relatesTo: null,
  });
  await client.addAccessLogEntry({
    account: 'jsmith',
    targetName: 'J Smith',
    action: 'grant',
    role: 'reviewer',
    caseType: 'x',
    reason: 'asked\u000Cnicely\u0002',
    changes: [],
    outcome: 'recorded',
    relatesTo: null,
  });

  assert.deepEqual(written, ['moved\nnow', 'asked\nnicely']);
});
