// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  caseRowResponse,
  fakeSharePoint,
  profileResponse,
} from './helpers/http-sharepoint-client.js';
import {
  LIST as MOCK_LIST,
  PERSONAS,
  MockSharePointClient,
} from './helpers/mock-sharepoint-client.js';
import { makeCaseRow } from './helpers/fixtures.js';

// Capability: saving a Responsible Party records who manages them on the same Case row.

const LIST = { listName: 'Cases-example' };

/** @param {unknown} body @param {number} [status] */
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });

const caseRead = /** @type {[string, () => Response]} */ ([
  '/items(',
  () => json(caseRowResponse()),
]);

/** @param {() => Response} profile */
const withProfile = (profile) =>
  fakeSharePoint({ routes: [['GetPropertiesFor', profile], caseRead] });

test('saving a Responsible Party records their manager in the same save', async () => {
  const sp = withProfile(() => profileResponse('Bob', 'CONTOSO\\Boss'));

  const result = await sp.client.patchCase(
    '1',
    { responsibleParty: '2002' },
    '"1"',
    LIST
  );

  assert.equal(result.ok, true);
  assert.equal(sp.calls.filter((c) => c.method === 'PATCH').length, 1);
  assert.deepEqual(sp.ensured(), [
    'i:0#.w|CONTOSO\\2002',
    'i:0#.w|CONTOSO\\boss',
  ]);
  assert.deepEqual(sp.patched(), {
    ResponsiblePartyId: 7,
    ResponsiblePartyManagerId: 7,
  });
});

test('a manager in another domain is recorded in their own domain', async () => {
  const sp = withProfile(() => profileResponse('Bob', 'OTHERDOM\\Boss'));

  await sp.client.patchCase('1', { responsibleParty: '2002' }, '"1"', LIST);

  assert.equal(sp.ensured()[1], 'i:0#.w|OTHERDOM\\boss');
});

test('clearing the Responsible Party clears their manager without asking the directory', async () => {
  const sp = withProfile(() => profileResponse('Bob', 'CONTOSO\\Boss'));

  await sp.client.patchCase('1', { responsibleParty: '' }, '"1"', LIST);

  assert.deepEqual(sp.patched(), {
    ResponsiblePartyId: null,
    ResponsiblePartyManagerId: null,
  });
  assert.deepEqual(sp.profiles(), []);
});

test('a Responsible Party with no manager, or a profile that cannot be read, still saves, recording nobody', async () => {
  for (const profile of [
    () => profileResponse('Bob'),
    () => new Response('down', { status: 503 }),
  ]) {
    const sp = withProfile(profile);

    const result = await sp.client.patchCase(
      '1',
      { responsibleParty: '2002' },
      '"1"',
      LIST
    );

    assert.equal(result.ok, true);
    assert.deepEqual(sp.patched(), {
      ResponsiblePartyId: 7,
      ResponsiblePartyManagerId: null,
    });
  }
});

test('a save that names nobody, or names the manager itself, leaves the directory alone', async () => {
  const sp = withProfile(() => profileResponse('Bob', 'CONTOSO\\Boss'));

  await sp.client.patchCase('1', { notes: 'x' }, '"1"', LIST);
  const untouched = sp.patched();
  await sp.client.patchCase(
    '1',
    { responsibleParty: '2002', responsiblePartyManager: 'chosen' },
    '"1"',
    LIST
  );

  assert.equal('ResponsiblePartyManagerId' in untouched, false);
  assert.deepEqual(sp.profiles(), []);
  assert.deepEqual(sp.ensured(), [
    'i:0#.w|CONTOSO\\2002',
    'i:0#.w|CONTOSO\\chosen',
  ]);
});

test('the mock client records the same manager the directory gives', async () => {
  const client = new MockSharePointClient({
    lists: {
      [MOCK_LIST]: [
        makeCaseRow({
          id: 'case-rp',
          responsiblePartyManager: 'previous-manager',
          etag: 'etag-rp',
        }),
      ],
    },
    personas: PERSONAS,
    people: [
      {
        loginName: 'jsmith',
        displayName: 'John Smith',
        manager: 'i:0#.w|CONTOSO\\Boss',
      },
    ],
  });

  const picked = await client.patchCase(
    'case-rp',
    { responsibleParty: 'jsmith' },
    'etag-rp',
    { listName: MOCK_LIST }
  );
  const cleared = await client.patchCase(
    'case-rp',
    { responsibleParty: '' },
    String(picked.data?.etag),
    { listName: MOCK_LIST }
  );

  assert.equal(picked.data?.responsiblePartyManager, 'boss');
  assert.equal(cleared.data?.responsiblePartyManager, null);
});
