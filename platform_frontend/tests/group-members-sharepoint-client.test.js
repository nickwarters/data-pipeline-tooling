// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';
import { withAbortSignal } from '../src/services/abortable-client.js';
import {
  WEB_URL,
  caseRowResponse,
  digestResponse,
  makeFetch,
} from './helpers/http-sharepoint-client.js';

// Capability: a SharePoint group's user members can be listed by bare account.

test('HttpSharePointClient: lists a group’s users by bare account, skipping nested groups', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              {
                Id: 12,
                Title: 'Bea Reviewer',
                LoginName: 'i:0#.w|CONTOSO\\bea',
                Email: 'bea@contoso.com',
                PrincipalType: 1,
              },
              {
                Id: 13,
                Title: 'Amir',
                LoginName: 'i:0#.w|CONTOSO\\amir',
                Email: '',
                PrincipalType: 1,
              },
              {
                Id: 14,
                Title: 'Team',
                LoginName: 'c:0+.w|s-1-5',
                PrincipalType: 4,
              },
              { Id: 0, Title: 'Nobody', LoginName: '', PrincipalType: 1 },
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

  const members = await client.listGroupMembers("Reviewers - O'Brien");

  assert.match(
    decodeURIComponent(calls[0].url),
    /\/_api\/web\/sitegroups\/getbyname\('Reviewers - O''Brien'\)\/users\?/
  );
  assert.deepEqual(members, [
    { loginName: 'bea', displayName: 'Bea Reviewer', email: 'bea@contoso.com' },
    { loginName: 'amir', displayName: 'Amir' },
  ]);
});

test('HttpSharePointClient: a listed member is written by the id the group read returned, adding nobody to the site', async () => {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
    },
    {
      when: (c) => c.url.endsWith('/_api/web/ensureuser'),
      respond: () => new Response('not expected', { status: 500 }),
    },
    {
      when: (c) => c.method === 'GET' && c.url.includes('sitegroups'),
      respond: () =>
        new Response(
          JSON.stringify({
            value: [
              {
                Id: 12,
                Title: 'Bea',
                LoginName: 'i:0#.w|CONTOSO\\bea',
                PrincipalType: 1,
              },
            ],
          }),
          { status: 200 }
        ),
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () =>
        new Response(null, { status: 204, headers: { ETag: '"v2"' } }),
    },
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(JSON.stringify(caseRowResponse()), {
          status: 200,
          headers: { ETag: '"v2"' },
        }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  await client.listGroupMembers('Reviewers - Complaints');

  const result = await client.patchCase(
    '7',
    { assignedReviewer: 'bea' },
    '"v1"',
    {
      listName: 'Cases-Complaints',
    }
  );

  assert.equal(result.ok, true);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(JSON.parse(String(patch?.body)).AssignedReviewerId, 12);
  assert.equal(calls.filter((c) => c.url.endsWith('/ensureuser')).length, 0);
});

test('MockSharePointClient: a group’s members are the directory people holding it', async () => {
  const client = new MockSharePointClient({
    personas: {},
    people: [
      {
        loginName: 'bea',
        displayName: 'Bea',
        email: 'bea@contoso.com',
        groups: ['Reviewers - Complaints'],
      },
      {
        loginName: 'amir',
        displayName: 'Amir',
        groups: ['Reviewers - Complaints', 'Controls'],
      },
      { loginName: 'cy', displayName: 'Cy', groups: ['Controls'] },
      { loginName: 'dee', displayName: 'Dee' },
    ],
  });

  assert.deepEqual(await client.listGroupMembers('Reviewers - Complaints'), [
    { loginName: 'bea', displayName: 'Bea', email: 'bea@contoso.com' },
    { loginName: 'amir', displayName: 'Amir' },
  ]);
  assert.deepEqual(
    (await client.searchPeople('bea'))[0],
    { loginName: 'bea', displayName: 'Bea', email: 'bea@contoso.com' },
    'group membership never leaks into a people search'
  );
});

test('the group read is cancelled with the page that asked for it', async () => {
  const controller = new AbortController();
  controller.abort();
  const client = withAbortSignal(
    /** @type {any} */ (new MockSharePointClient({ personas: {} })),
    controller.signal
  );
  await assert.rejects(
    client.listGroupMembers('Reviewers - Complaints'),
    (error) => /** @type {any} */ (error).name === 'AbortError'
  );
});
