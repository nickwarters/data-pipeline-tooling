// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  USER_ROLES_LIST_NAME,
  noRoles,
  roleCaseTypeEntry,
  roleEntries,
  roleFlagEntry,
  withRoleEntries,
} from '../src/services/user-roles.js';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';
import { withAbortSignal } from '../src/services/abortable-client.js';
import {
  WEB_URL,
  digestResponse,
  makeFetch,
} from './helpers/http-sharepoint-client.js';

/** @param {string} value */
const isEntry = (value) => value.startsWith('CoraUserRoles: ');

// Capability: what a person may do in CORA is one row of a shared list, read and changed as a set of entries.

const ROWS_URL = `${WEB_URL}/_api/web/lists/getbytitle('${USER_ROLES_LIST_NAME}')/items`;

/** @param {unknown} body @param {number} [status] @param {Record<string, string>} [headers] */
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** @param {Parameters<typeof makeFetch>[0]} rules @param {{ listPrefix?: string }} [options] */
function http(rules, options = {}) {
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('digest-1'),
    },
    ...rules,
  ]);
  return {
    calls,
    client: new HttpSharePointClient({
      webUrl: WEB_URL,
      fetchImpl: fetch,
      ...options,
    }),
  };
}

/** @param {Record<string, unknown>} [fields] */
const item = (fields = {}) => ({
  Id: 7,
  Title: 'zara',
  Adviser: false,
  Controls: true,
  ReviewerManager: null,
  ResponsiblePartyManager: false,
  Reviewer: false,
  Reviews: ['complaints'],
  OwnsCaseTypes: [],
  JourneyOwnerOf: { results: ['complaints'] },
  Person: { Title: 'Zara Ahmed', Name: 'i:0#.w|CONTOSO\\zara', EMail: 'z@x' },
  ...fields,
});

test('role entries: every set flag and held Case Type is one entry, and none is a group name', () => {
  const roles = {
    ...noRoles(),
    controls: true,
    reviews: ['complaints', 'sales'],
    journeyOwnerOf: ['complaints'],
  };

  const entries = roleEntries(roles);

  assert.deepEqual(entries, [
    roleFlagEntry('controls'),
    roleCaseTypeEntry('reviews', 'complaints'),
    roleCaseTypeEntry('reviews', 'sales'),
    roleCaseTypeEntry('journeyOwnerOf', 'complaints'),
  ]);
  for (const entry of entries) {
    assert.ok(isEntry(entry), entry);
    // SharePoint refuses a colon in a group name, so an entry can never be one.
    assert.match(entry, /:/);
  }
  assert.equal(isEntry('Reviewers - Complaints'), false);
  assert.deepEqual(roleEntries(noRoles()), []);
});

test('role entries: adding and removing gives back the roles that spell them', () => {
  const before = { ...noRoles(), reviews: ['complaints'] };

  const after = withRoleEntries(before, {
    add: [
      roleFlagEntry('reviewerManager'),
      roleCaseTypeEntry('reviews', 'sales'),
      roleCaseTypeEntry('reviews', 'complaints'),
    ],
    remove: [roleCaseTypeEntry('reviews', 'complaints')],
  });

  assert.equal(after.reviewerManager, true);
  // A slug added twice is held once, and a removal never takes an add with it.
  assert.deepEqual(after.reviews.sort(), ['complaints', 'sales']);
  assert.deepEqual(before.reviews, ['complaints'], 'the input is not changed');

  const cleared = withRoleEntries(after, {
    remove: [
      roleFlagEntry('reviewerManager'),
      roleCaseTypeEntry('reviews', 'sales'),
    ],
  });
  assert.equal(cleared.reviewerManager, false);
  assert.deepEqual(cleared.reviews, ['complaints']);
  assert.deepEqual(withRoleEntries(cleared, {}), cleared);
});

test('role entries: an entry that names no column is refused rather than dropped', () => {
  assert.throws(
    () => withRoleEntries(noRoles(), { add: ['CoraUserRoles: Owner'] }),
    /is not a column of CoraUserRoles/
  );
});

// --- the HTTP client ---

test('HttpSharePointClient: a row is found by indexed Title on the unprefixed list and read as roles', async () => {
  const { client, calls } = http(
    [{ when: () => true, respond: () => json({ value: [item()] }) }],
    { listPrefix: 'uat_' }
  );

  const roles = await client.getUserRoles("o'zara");

  assert.deepEqual(roles, {
    ...noRoles(),
    controls: true,
    reviews: ['complaints'],
    journeyOwnerOf: ['complaints'],
  });
  const url = calls[0].url;
  assert.ok(url.startsWith(`${ROWS_URL}?$filter=`), url);
  assert.ok(
    decodeURIComponent(url).includes("Title eq 'o''zara'"),
    'the account is escaped inside the OData literal'
  );
  assert.match(url, /&\$top=1$/);
  assert.equal(
    calls.filter((c) => c.url.endsWith('/ensureuser')).length,
    0,
    'reading someone never adds them to the site'
  );
});

test('HttpSharePointClient: the permission columns are selected and read beside the roles', async () => {
  const { client, calls } = http([
    {
      when: () => true,
      respond: () =>
        json({
          value: [
            item({
              Controls: false,
              CanSearchCases: true,
              CanChangeOutcome: true,
            }),
          ],
        }),
    },
  ]);

  const roles = await client.getUserRoles('zara');

  assert.equal(roles.canSearchCases, true);
  assert.equal(roles.canChangeOutcome, true);
  assert.equal(roles.controls, false);
  const select = decodeURIComponent(calls[0].url);
  for (const column of ['CanSearchCases', 'CanChangeOutcome']) {
    assert.ok(select.includes(column), `${column} is selected`);
  }
});

test('HttpSharePointClient: somebody with no row holds no roles, and other failures still throw', async () => {
  const none = http([{ when: () => true, respond: () => json({ value: [] }) }]);
  assert.deepEqual(await none.client.getUserRoles('nobody'), noRoles());

  const broken = http([
    { when: () => true, respond: () => new Response('', { status: 500 }) },
  ]);
  await assert.rejects(broken.client.getUserRoles('zara'), /HTTP Error: 500/);
});

test('HttpSharePointClient: role holders are every row holding the entry, named by their Person column', async () => {
  const { client, calls } = http([
    {
      when: () => true,
      respond: () =>
        json({
          value: [
            item(),
            item({ Id: 8, Title: 'bea', Reviews: [], Person: null }),
            item({
              Id: 9,
              Title: 'cal',
              Person: { Title: 'Cal', Name: 'i:0#.w|OTHER\\cal', EMail: '' },
            }),
            item({ Id: 10, Title: '' }),
          ],
        }),
    },
  ]);

  const holders = await client.listRoleHolders(
    roleCaseTypeEntry('reviews', 'complaints')
  );

  assert.deepEqual(holders, [
    { loginName: 'zara', displayName: 'Zara Ahmed', email: 'z@x' },
    { loginName: 'cal', displayName: 'Cal' },
  ]);
  assert.ok(calls[0].url.startsWith(`${ROWS_URL}?$select=`));
  assert.equal(
    calls[0].url.includes('$filter'),
    false,
    'an unindexable multi-choice column is never filtered on'
  );
});

test('HttpSharePointClient: a person with no row gets one, keyed by account and Person id', async () => {
  const { client, calls } = http([
    {
      when: (c) => c.method === 'GET',
      respond: () => json({ value: [] }),
    },
    {
      when: (c) => c.url.endsWith('/ensureuser'),
      respond: () => json({ Id: 42 }),
    },
    {
      when: (c) => c.method === 'POST' && c.url === ROWS_URL,
      respond: () => json({ Id: 11 }),
    },
  ]);

  const result = await client.updateUserRoles('zara', {
    add: [
      roleCaseTypeEntry('reviews', 'complaints'),
      roleFlagEntry('controls'),
    ],
  });

  assert.deepEqual(result, { ok: true });
  const created = calls.find((c) => c.method === 'POST' && c.url === ROWS_URL);
  assert.deepEqual(JSON.parse(created?.body ?? '{}'), {
    Title: 'zara',
    PersonId: 42,
    Adviser: false,
    Controls: true,
    ReviewerManager: false,
    ResponsiblePartyManager: false,
    Reviewer: false,
    CanSearchCases: false,
    CanChangeOutcome: false,
    'Reviews@odata.type': 'Collection(Edm.String)',
    Reviews: ['complaints'],
    'OwnsCaseTypes@odata.type': 'Collection(Edm.String)',
    OwnsCaseTypes: [],
    'JourneyOwnerOf@odata.type': 'Collection(Edm.String)',
    JourneyOwnerOf: [],
  });
  assert.equal(created?.headers['x-requestdigest'], 'digest-1');
});

test('HttpSharePointClient: an existing row is changed in place against the ETag it was read with', async () => {
  const { client, calls } = http([
    {
      when: (c) => c.method === 'GET' && c.url.includes('$filter'),
      respond: () => json({ value: [item()] }),
    },
    {
      when: (c) => c.method === 'GET' && c.url.startsWith(`${ROWS_URL}('7')`),
      respond: () => json(item(), 200, { ETag: '"3"' }),
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () => new Response(null, { status: 204 }),
    },
  ]);

  const result = await client.updateUserRoles('zara', {
    remove: [roleFlagEntry('controls')],
    add: [roleCaseTypeEntry('ownsCaseTypes', 'complaints')],
  });

  assert.deepEqual(result, { ok: true });
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch?.url, `${ROWS_URL}('7')`);
  assert.equal(patch?.headers['if-match'], '"3"');
  const body = JSON.parse(patch?.body ?? '{}');
  assert.equal(body.Controls, false);
  assert.deepEqual(body.Reviews, ['complaints']);
  assert.deepEqual(body.OwnsCaseTypes, ['complaints']);
  assert.deepEqual(body.JourneyOwnerOf, ['complaints']);
  assert.equal(
    calls.filter((c) => c.url.endsWith('/ensureuser')).length,
    0,
    'an existing row keeps the person it names'
  );
});

test('HttpSharePointClient: a row changed by somebody else in between fails with its status, never a throw', async () => {
  const { client } = http([
    {
      when: (c) => c.method === 'GET' && c.url.includes('$filter'),
      respond: () => json({ value: [item()] }),
    },
    {
      when: (c) => c.method === 'GET',
      respond: () => json(item(), 200, { ETag: '"3"' }),
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () => new Response('', { status: 412 }),
    },
  ]);

  assert.deepEqual(
    await client.updateUserRoles('zara', { add: [roleFlagEntry('adviser')] }),
    { ok: false, status: 412 }
  );
});

test('HttpSharePointClient: a row read without an ETag is still written, unconditionally', async () => {
  const { client, calls } = http([
    {
      when: (c) => c.method === 'GET' && c.url.includes('$filter'),
      respond: () => json({ value: [item()] }),
    },
    { when: (c) => c.method === 'GET', respond: () => json(item()) },
    {
      when: (c) => c.method === 'PATCH',
      respond: () => new Response(null, { status: 204 }),
    },
  ]);

  await client.updateUserRoles('zara', { add: [roleFlagEntry('adviser')] });

  assert.equal(
    calls.find((c) => c.method === 'PATCH')?.headers['if-match'],
    '*'
  );
});

test('HttpSharePointClient: the role reads carry the mount signal', async () => {
  const controller = new AbortController();
  /** @type {Array<AbortSignal | null | undefined>} */
  const signals = [];
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async (_input, init) => {
      signals.push(init?.signal);
      return json({ value: [] });
    },
  });
  const bound = withAbortSignal(client, controller.signal);

  await bound.getUserRoles('zara');
  await bound.listRoleHolders(roleFlagEntry('controls'));

  assert.equal(signals.length, 2);
  for (const signal of signals) assert.equal(signal, controller.signal);
});

// --- the mock, held to the same contract ---

/** @param {Partial<ConstructorParameters<typeof MockSharePointClient>[0]>} [options] */
function mock(options = {}) {
  return new MockSharePointClient({
    personas: {},
    people: [{ loginName: 'zara', displayName: 'Zara', email: 'z@x' }],
    userRoles: { Zara: { reviews: ['complaints'] }, bea: { controls: true } },
    ...options,
  });
}

test('MockSharePointClient: rows are read per person, case-insensitively, and somebody without one holds none', async () => {
  const client = mock();

  assert.deepEqual((await client.getUserRoles('zara')).reviews, ['complaints']);
  assert.deepEqual(await client.getUserRoles('nobody'), noRoles());
});

test('MockSharePointClient: holders are named from the directory, or by account when it does not know them', async () => {
  const client = mock();
  await client.updateUserRoles('cal', {
    add: [roleCaseTypeEntry('reviews', 'complaints')],
  });

  assert.deepEqual(
    await client.listRoleHolders(roleCaseTypeEntry('reviews', 'complaints')),
    [
      { loginName: 'zara', displayName: 'Zara', email: 'z@x' },
      { loginName: 'cal', displayName: 'cal' },
    ]
  );
  assert.deepEqual(await client.listRoleHolders(roleFlagEntry('controls')), [
    { loginName: 'bea', displayName: 'bea' },
  ]);
});

test('MockSharePointClient: a directory person’s roles seed their row, and an explicit row wins', async () => {
  const client = mock({
    people: [
      { loginName: 'zara', displayName: 'Zara', roles: { controls: true } },
      { loginName: 'kai', displayName: 'Kai', roles: { adviser: true } },
    ],
  });

  assert.equal((await client.getUserRoles('kai')).adviser, true);
  assert.deepEqual((await client.getUserRoles('zara')).reviews, ['complaints']);
  assert.equal((await client.getUserRoles('zara')).controls, false);
});

test('MockSharePointClient: a change does not reach the roles it was built from or handed out', async () => {
  const userRoles = { zara: { reviews: ['complaints'] } };
  const client = mock({ userRoles });
  const read = await client.getUserRoles('zara');
  read.reviews.push('sales');

  await client.updateUserRoles('zara', { add: [roleFlagEntry('adviser')] });

  assert.deepEqual(userRoles.zara, { reviews: ['complaints'] });
  assert.deepEqual((await client.getUserRoles('zara')).reviews, ['complaints']);
  assert.equal((await client.getUserRoles('zara')).adviser, true);
});

test('MockSharePointClient: a read-only list refuses with 403, and an unknown entry with 400', async () => {
  const readOnly = mock({ userRolesReadOnly: true });
  assert.deepEqual(
    await readOnly.updateUserRoles('zara', { add: [roleFlagEntry('adviser')] }),
    { ok: false, status: 403 }
  );

  assert.deepEqual(
    await mock().updateUserRoles('zara', { add: ['CoraUserRoles: Nope'] }),
    { ok: false, status: 400 }
  );
});

test('the role reads are cancelled with the page that asked for them', async () => {
  const controller = new AbortController();
  controller.abort();
  const client = withAbortSignal(mock(), controller.signal);

  for (const read of [
    () => client.getUserRoles('zara'),
    () => client.listRoleHolders(roleFlagEntry('controls')),
  ]) {
    await assert.rejects(
      read(),
      (error) => /** @type {any} */ (error).name === 'AbortError'
    );
  }
});
