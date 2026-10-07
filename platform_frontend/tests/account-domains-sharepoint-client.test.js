// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import {
  WEB_URL,
  caseRowResponse,
  profileResponse,
} from './helpers/http-sharepoint-client.js';

// Capability: a person outside the default AD domain is named to SharePoint in their own domain.

const BOB = 'i:0#.w|OTHERDOM\\2002';
const LIST = { listName: 'Cases-example' };

/** @param {unknown} body @param {number} [status] */
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });

/**
 * A SharePoint fake: a people picker over `directory`, an EnsureUser that always answers, and GET routes by URL fragment.
 *
 * @param {{ directory?: Array<{ Key: string, DisplayText?: string }>, picker?: () => Response | null, routes?: Array<[string, () => Response]> }} [options]
 */
function fakeSharePoint({ directory = [], picker, routes = [] } = {}) {
  /** @type {Array<{ url: string, method: string, body: string | null }>} */
  const calls = [];
  /** @type {import('../src/services/http-sharepoint-client.js').FetchImpl} */
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const body = init.body == null ? null : String(init.body);
    calls.push({ url, method, body });
    if (url.endsWith('/_api/contextinfo')) {
      return json({ FormDigestValue: 'd' });
    }
    if (url.includes('clientPeoplePickerSearchUser')) {
      const overridden = picker?.();
      if (overridden) return overridden;
      const q = JSON.parse(String(body)).queryParams.QueryString.toLowerCase();
      const hits = directory.filter((e) => e.Key.toLowerCase().includes(q));
      return json({ value: JSON.stringify(hits) });
    }
    if (url.endsWith('/_api/web/ensureuser')) return json({ Id: 7 });
    for (const [fragment, respond] of routes) {
      if (url.includes(fragment)) return respond();
    }
    return json({ value: [] });
  };
  const client = new HttpSharePointClient({ webUrl: WEB_URL, fetchImpl });
  return {
    client,
    calls,
    /** The logins EnsureUser was asked for, in order. */
    ensured: () =>
      calls
        .filter((c) => c.url.endsWith('/_api/web/ensureuser'))
        .map((c) => JSON.parse(String(c.body)).logonName),
    /** How many people-picker requests were made. */
    lookups: () =>
      calls.filter((c) => c.url.includes('clientPeoplePickerSearchUser'))
        .length,
    /** The account each profile read named, decoded. */
    profiles: () =>
      calls
        .filter((c) => c.url.includes('GetPropertiesFor'))
        .map((c) => decodeURIComponent(c.url.split("@v='")[1].slice(0, -1))),
  };
}

const caseRead = (/** @type {Record<string, unknown>} */ overrides = {}) =>
  /** @type {[string, () => Response]} */ ([
    '/items(',
    () => json(caseRowResponse(overrides)),
  ]);

test('a person picked from another domain is saved in that domain', async () => {
  const sp = fakeSharePoint({
    directory: [{ Key: BOB, DisplayText: 'Bob' }],
    routes: [caseRead()],
  });

  const [bob] = await sp.client.searchPeople('2002');
  await sp.client.patchCase(
    '1',
    { responsibleParty: bob.loginName },
    '"1"',
    LIST
  );

  assert.deepEqual(bob, {
    loginName: '2002',
    displayName: 'Bob',
    domain: 'OTHERDOM',
  });
  assert.deepEqual(sp.ensured(), [BOB]);
  assert.equal(sp.lookups(), 1, 'the search itself; the save looks nobody up');
});

test('a Case read remembers the domain of every person it expanded', async () => {
  const people = {
    AssignedReviewer: { Name: 'i:0#.w|OTHERDOM\\1001' },
    ResponsibleParty: { Name: BOB, Title: 'Bob' },
    AssignedReviewerManager: { Name: 'i:0#.w|OTHERDOM\\3003' },
    ResponsiblePartyManager: null,
  };
  const single = fakeSharePoint({ routes: [caseRead(people)] });
  const listed = fakeSharePoint({
    routes: [
      ['/items?', () => json({ value: [caseRowResponse(people)] })],
      caseRead(),
    ],
  });

  const row = await single.client.getCase('1', LIST);
  await single.client.patchCase(
    '1',
    { responsiblePartyManager: '3003' },
    '"1"',
    LIST
  );
  await listed.client.listCases({}, LIST);
  await listed.client.patchCase('1', { assignedReviewer: '1001' }, '"1"', LIST);

  assert.equal(
    row?.responsibleParty,
    '2002',
    'the row itself still speaks bare accounts'
  );
  assert.deepEqual(single.ensured(), ['i:0#.w|OTHERDOM\\3003']);
  assert.deepEqual(listed.ensured(), ['i:0#.w|OTHERDOM\\1001']);
  assert.equal(single.lookups() + listed.lookups(), 0);
});

test('the signed-in user and a group’s members are named in their own domains', async () => {
  const sp = fakeSharePoint({
    routes: [
      ['/currentUser', () => json({ Id: 0, Title: 'Bob', LoginName: BOB })],
      [
        '/users?',
        () =>
          json({
            value: [
              {
                Id: 0,
                Title: 'Cy',
                LoginName: 'i:0#.w|THIRD\\3003',
                PrincipalType: 1,
              },
            ],
          }),
      ],
    ],
  });

  await sp.client.getCurrentUser();
  await sp.client.listGroupMembers('Controls');
  await sp.client.listUserGroups('2002');
  await sp.client.addGroupMember('Controls', '3003');
  await sp.client.removeGroupMember('Controls', '3003');

  const urls = sp.calls.map((c) => decodeURIComponent(c.url));
  assert.ok(
    urls.some((u) => u.includes(`getbyloginname(@v)/groups?@v='${BOB}'`))
  );
  const add = sp.calls.find(
    (c) => c.method === 'POST' && c.url.endsWith('/users')
  );
  assert.equal(JSON.parse(String(add?.body)).LoginName, 'i:0#.w|THIRD\\3003');
  assert.ok(
    urls.some((u) =>
      u.includes("removebyloginname(@v)?@v='i:0#.w|THIRD\\3003'")
    )
  );
  assert.equal(sp.lookups(), 0);
});

test('an account the client has never seen is looked up once, then remembered', async () => {
  const sp = fakeSharePoint({
    directory: [{ Key: BOB }, { Key: 'i:0#.w|CONTOSO\\20021' }],
    routes: [['GetPropertiesFor', () => profileResponse('Bob')]],
  });

  const [names] = await Promise.all([
    sp.client.resolveUsers(['2002']),
    sp.client.listUserGroups('2002'),
  ]);
  await sp.client.resolveManagers(['2002']);

  assert.deepEqual(names, { 2002: 'Bob' });
  assert.deepEqual(sp.profiles(), [BOB, BOB]);
  assert.equal(
    sp.lookups(),
    1,
    'concurrent and later calls share the one lookup'
  );
});

test('a lookup that finds nobody, or the account in two domains, falls back to the default domain', async () => {
  const twice = fakeSharePoint({
    directory: [{ Key: BOB }, { Key: 'i:0#.w|CONTOSO\\2002' }],
  });
  const nobody = fakeSharePoint();

  await twice.client.resolveUsers(['2002']);
  await twice.client.resolveUsers(['2002']);
  await nobody.client.resolveUsers(['2002']);

  assert.deepEqual(twice.profiles(), [
    'i:0#.w|CONTOSO\\2002',
    'i:0#.w|CONTOSO\\2002',
  ]);
  assert.equal(twice.lookups(), 1, 'an inconclusive answer is not asked again');
  assert.deepEqual(nobody.profiles(), ['i:0#.w|CONTOSO\\2002']);
});

test('a failed lookup falls back to the default domain and is asked again next time', async () => {
  let failures = 1;
  const sp = fakeSharePoint({
    directory: [{ Key: BOB }],
    picker: () =>
      failures-- > 0 ? new Response('down', { status: 503 }) : null,
  });

  await sp.client.resolveUsers(['2002']);
  await sp.client.resolveUsers(['2002']);

  assert.deepEqual(sp.profiles(), ['i:0#.w|CONTOSO\\2002', BOB]);
  assert.equal(sp.lookups(), 2);
});

test('a domain stored beside a person, or named as a manager, needs no lookup', async () => {
  const sp = fakeSharePoint({
    routes: [
      ['GetPropertiesFor', () => profileResponse('Bob', 'OTHERDOM\\Boss')],
      caseRead(),
    ],
  });

  await sp.client.resolveManagers(['2002']);
  await sp.client.resolveUsers(['2002'], { domains: { 2002: 'OTHERDOM' } });
  await sp.client.patchCase(
    '1',
    { assignedReviewerManager: 'boss' },
    '"1"',
    LIST
  );

  assert.equal(
    sp.lookups(),
    1,
    'only resolveManagers, which was given no domain'
  );
  assert.deepEqual(sp.ensured(), ['i:0#.w|OTHERDOM\\boss']);
});
