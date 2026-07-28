// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import {
  WEB_URL,
  digestResponse,
  makeFetch,
  profileResponse,
} from './helpers/http-sharepoint-client.js';

// Capability: current-user, group, people search, and profile resolution.

test('HttpSharePointClient: getCurrentUser returns id and displayName', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            Id: 42,
            Title: 'Alice Reviewer',
            LoginName: 'i:0#.w|domain\\alice',
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const u = await client.getCurrentUser();
  assert.equal(u.id, 'alice');
  assert.equal(u.displayName, 'Alice Reviewer');
});

test('HttpSharePointClient: getCurrentUserGroups returns group titles', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              { Id: 1, Title: 'Reviewers' },
              { Id: 2, Title: 'CaseTypeOwners' },
            ],
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const groups = await client.getCurrentUserGroups();
  assert.deepEqual(groups, ['Reviewers', 'CaseTypeOwners']);
});

// --- patchCase 200 with JSON body ---

test('HttpSharePointClient: searchPeople POSTs to the people-picker endpoint, queries the directory, and returns bare accounts', async () => {
  const entities = [
    {
      Key: 'i:0#.w|CONTOSO\\jsmith',
      DisplayText: 'John Smith',
      EntityData: { Email: 'jsmith@contoso.com' },
    },
    { Key: 'i:0#.w|CONTOSO\\bjones', DisplayText: 'Bola Jones' },
    { Key: 'i:0#.w|CONTOSO\\noname' },
  ];
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d1'),
    },
    {
      when: (c) => c.method === 'POST',
      respond: () =>
        new Response(JSON.stringify({ value: JSON.stringify(entities) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const results = await client.searchPeople('smith');

  assert.deepEqual(results, [
    {
      loginName: 'jsmith',
      displayName: 'John Smith',
      email: 'jsmith@contoso.com',
    },
    { loginName: 'bjones', displayName: 'Bola Jones' },
    { loginName: 'noname', displayName: 'noname' },
  ]);
  const post = calls.find(
    (c) => c.method === 'POST' && c.url.includes('clientPeoplePickerSearchUser')
  );
  assert.ok(post, 'POSTs to clientPeoplePickerSearchUser');
  const sent = JSON.parse(/** @type {string} */ (post?.body));
  assert.equal(sent.queryParams.QueryString, 'smith');
  assert.equal(
    sent.queryParams.PrincipalSource,
    15,
    'queries all sources incl. the directory'
  );
  assert.equal(sent.queryParams.PrincipalType, 1, 'users only');
});

test('HttpSharePointClient: searchPeople reads the verbose d.ClientPeoplePickerSearchUser envelope', async () => {
  const entities = [{ Key: 'CONTOSO\\asmith', DisplayText: 'Anna Smith' }];
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d1'),
    },
    {
      when: (c) => c.method === 'POST',
      respond: () =>
        new Response(
          JSON.stringify({
            d: { ClientPeoplePickerSearchUser: JSON.stringify(entities) },
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const results = await client.searchPeople('anna');
  assert.deepEqual(results, [
    { loginName: 'asmith', displayName: 'Anna Smith' },
  ]);
});

test('HttpSharePointClient: searchPeople returns [] when the response carries no recognised payload', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d1'),
    },
    {
      when: (c) => c.method === 'POST',
      respond: () => new Response(JSON.stringify({}), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  assert.deepEqual(await client.searchPeople('x'), []);
});

test('HttpSharePointClient: searchPeople short-circuits a blank query without calling fetch', async () => {
  const { fetch, calls } = makeFetch([]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  assert.deepEqual(await client.searchPeople('   '), []);
  assert.equal(calls.length, 0);
});

test('HttpSharePointClient: searchPeople throws on a non-ok response', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d1'),
    },
    {
      when: (c) => c.method === 'POST',
      respond: () => new Response('err', { status: 500 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  await assert.rejects(() => client.searchPeople('x'), /HTTP Error: 500/);
});

// --- resolveUsers ---

test('HttpSharePointClient: resolveUsers resolves display names via GetPropertiesFor, reattaching the claims prefix and domain', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) =>
        c.url.includes('GetPropertiesFor') && c.url.includes('jsmith'),
      respond: () => profileResponse('John Smith'),
    },
    {
      when: (c) =>
        c.url.includes('GetPropertiesFor') && c.url.includes('bjones'),
      respond: () => profileResponse('Bola Jones'),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const resolved = await client.resolveUsers(['jsmith', 'bjones']);
  assert.deepEqual(resolved, { jsmith: 'John Smith', bjones: 'Bola Jones' });

  // The stored bare account is expanded to a full claims login at the boundary.
  const jcall = calls.find((c) => c.url.includes('jsmith'));
  assert.ok(jcall, 'a profile read was made for jsmith');
  assert.equal(jcall?.method, 'GET');
  assert.ok(jcall?.url.includes('CONTOSO'), 'reattaches the AD domain');
});

test('HttpSharePointClient: resolveUsers dedupes repeated accounts into a single read', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.includes('GetPropertiesFor'),
      respond: () => profileResponse('John Smith'),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const resolved = await client.resolveUsers(['jsmith', 'jsmith', 'jsmith']);
  assert.deepEqual(resolved, { jsmith: 'John Smith' });
  assert.equal(
    calls.filter((c) => c.url.includes('GetPropertiesFor')).length,
    1,
    'one read per unique account'
  );
});

test('HttpSharePointClient: resolveUsers maps to null when the profile has no DisplayName', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.includes('GetPropertiesFor'),
      respond: () => profileResponse(''),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  assert.deepEqual(await client.resolveUsers(['ghost']), { ghost: null });
});

test('HttpSharePointClient: resolveUsers maps to null when the profile read fails', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.includes('GetPropertiesFor'),
      respond: () => new Response('nope', { status: 500 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  assert.deepEqual(await client.resolveUsers(['ghost']), { ghost: null });
});

test('HttpSharePointClient: resolveUsers returns an empty map without any read for an empty list', async () => {
  const { fetch, calls } = makeFetch([]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  assert.deepEqual(await client.resolveUsers([]), {});
  assert.equal(calls.length, 0);
});

// --- getExportHash ---

test('HttpSharePointClient: getCurrentUserGroups falls back from Title to LoginName to empty string', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              { LoginName: 'domain\\bob' }, // no Title
              {}, // neither Title nor LoginName
            ],
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const groups = await client.getCurrentUserGroups();
  assert.deepEqual(groups, ['domain\\bob', '']);
});

test('HttpSharePointClient: getCurrentUser falls back through LoginName/Title to empty strings', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () => new Response(JSON.stringify({}), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const u = await client.getCurrentUser();
  assert.equal(u.id, '');
  assert.equal(u.displayName, '');
});

test('HttpSharePointClient: getCurrentUser displayName falls back to LoginName when Title is absent', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ LoginName: 'i:0#.w|domain\\carol' }), {
          status: 200,
        }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const u = await client.getCurrentUser();
  assert.equal(u.id, 'carol');
  assert.equal(u.displayName, 'i:0#.w|domain\\carol');
});

test('HttpSharePointClient: searchPeople handles an entity with no Key', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d1'),
    },
    {
      when: (c) => c.method === 'POST',
      respond: () =>
        new Response(
          JSON.stringify({
            value: JSON.stringify([{ DisplayText: 'No Key' }]),
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const results = await client.searchPeople('x');
  assert.deepEqual(results, [{ loginName: '', displayName: 'No Key' }]);
});
