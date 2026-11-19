// @ts-check
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBackfill,
  backfillClient,
  describePlan,
  planBackfill,
} from '../scripts/backfill_user_roles.js';
import {
  legacyGroups,
  translateLegacyGroups,
} from '../src/services/legacy-groups.js';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';
import {
  allCaseListGroups,
  caseListGroupNames,
  caseTypeGroupNames,
  frontlineListAccessGroupName,
  permissions,
} from '../src/services/permissions.js';
import {
  roleCaseTypeEntry,
  roleEntries,
  roleFlagEntry,
} from '../src/services/user-roles.js';

/** @param {string} value */
const isEntry = (value) => value.startsWith('CoraUserRoles: ');

const CASE_TYPES = [
  { slug: 'complaints', displayName: 'Complaints' },
  { slug: 'sales-calls', displayName: 'Sales Calls' },
];
const COMPLAINTS = caseTypeGroupNames('Complaints');
const COMPLAINTS_WRITE = caseListGroupNames('Complaints').write;

test('every legacy group becomes something, and only role entries and new groups', () => {
  const legacy = legacyGroups(CASE_TYPES);
  const names = legacy.map(({ group }) => group);

  assert.equal(new Set(names).size, names.length, 'no group is listed twice');
  assert.equal(
    names.includes(permissions.maintainer),
    false,
    'the Maintainer group stays a group'
  );
  for (const { slug, displayName } of CASE_TYPES) {
    const old = caseTypeGroupNames(displayName);
    for (const group of [
      old.listAccess,
      old.caseTypeOwner,
      old.journeyOwner,
      frontlineListAccessGroupName(displayName),
    ]) {
      const translated = legacy.find((entry) => entry.group === group);
      assert.deepEqual(
        translated?.accessGroups,
        [caseListGroupNames(displayName).write],
        `${group} opens ${slug}'s list for writing`
      );
    }
  }
  for (const { group, entries, accessGroups } of legacy) {
    assert.ok(entries.length + accessGroups.length > 0, group);
    for (const entry of entries) assert.ok(isEntry(entry), entry);
    for (const accessGroup of accessGroups) {
      assert.equal(isEntry(accessGroup), false, accessGroup);
    }
  }
});

test('a per-type Reviewer is not also given the no-Case-Type Reviewer flag', () => {
  assert.deepEqual(
    translateLegacyGroups(
      [permissions.reviewer, COMPLAINTS.listAccess],
      CASE_TYPES
    ),
    {
      entries: [roleCaseTypeEntry('reviews', 'complaints')],
      accessGroups: [COMPLAINTS_WRITE],
    }
  );
  assert.deepEqual(
    translateLegacyGroups([permissions.reviewer], CASE_TYPES).entries,
    [roleFlagEntry('reviewer')]
  );
});

test('the broad roles get their flag and the group that opens every list', () => {
  assert.deepEqual(
    translateLegacyGroups(
      [
        permissions.controls,
        permissions.reviewerManager,
        permissions.responsiblePartyManager,
        permissions.adviser,
        'Somebody Else’s Group',
      ],
      CASE_TYPES
    ),
    {
      entries: [
        roleFlagEntry('adviser'),
        roleFlagEntry('controls'),
        roleFlagEntry('reviewerManager'),
        roleFlagEntry('responsiblePartyManager'),
      ],
      accessGroups: [allCaseListGroups.write, allCaseListGroups.read],
    }
  );
});

function mock() {
  return new MockSharePointClient({
    personas: {},
    people: [
      {
        loginName: 'ana',
        displayName: 'Ana',
        groups: [
          permissions.reviewer,
          COMPLAINTS.listAccess,
          COMPLAINTS.caseTypeOwner,
        ],
      },
      {
        loginName: 'ben',
        displayName: 'Ben',
        groups: [frontlineListAccessGroupName('Complaints'), COMPLAINTS_WRITE],
      },
      { loginName: 'cy', displayName: 'Cy', groups: [permissions.controls] },
      {
        loginName: 'dee',
        displayName: 'Dee',
        groups: [permissions.maintainer],
      },
    ],
    userRoles: { cy: { controls: true } },
  });
}

test('the plan lists only what each person is missing, and nobody who has it all', async () => {
  const steps = await planBackfill(mock(), CASE_TYPES);

  assert.deepEqual(steps, [
    {
      account: 'ana',
      displayName: 'Ana',
      entries: [
        roleCaseTypeEntry('reviews', 'complaints'),
        roleCaseTypeEntry('ownsCaseTypes', 'complaints'),
      ],
      groups: [COMPLAINTS_WRITE],
    },
    {
      account: 'cy',
      displayName: 'Cy',
      entries: [],
      groups: [allCaseListGroups.write],
    },
  ]);
});

test('applying the plan leaves nothing to plan, and changes no legacy group', async () => {
  const client = mock();
  const before = await client.listUserGroups('ana');

  const writes = await applyBackfill(
    client,
    await planBackfill(client, CASE_TYPES)
  );

  assert.ok(writes.every(({ ok }) => ok));
  assert.deepEqual(
    writes.map(({ account, kind }) => `${account}:${kind}`),
    ['ana:row', 'ana:group', 'cy:group']
  );
  assert.deepEqual(await planBackfill(client, CASE_TYPES), []);
  assert.deepEqual(roleEntries(await client.getUserRoles('ana')), [
    roleCaseTypeEntry('reviews', 'complaints'),
    roleCaseTypeEntry('ownsCaseTypes', 'complaints'),
  ]);
  const after = await client.listUserGroups('ana');
  assert.deepEqual(after, [...before, COMPLAINTS_WRITE]);
});

test('a write that fails is reported with its status and the rest still run', async () => {
  const client = new MockSharePointClient({
    personas: {},
    people: [
      { loginName: 'cy', displayName: 'Cy', groups: [permissions.controls] },
    ],
    userRolesReadOnly: true,
  });

  const writes = await applyBackfill(
    client,
    await planBackfill(client, CASE_TYPES)
  );

  assert.deepEqual(writes, [
    {
      account: 'cy',
      kind: 'row',
      target: roleFlagEntry('controls'),
      ok: false,
      status: 403,
    },
    { account: 'cy', kind: 'group', target: allCaseListGroups.write, ok: true },
  ]);
});

test('the plan reads as one block per person, and says when there is nothing to do', () => {
  assert.deepEqual(describePlan([]), [
    'Nothing to do: every legacy role is already in the new model.',
  ]);

  const lines = describePlan([
    {
      account: 'ana',
      displayName: 'Ana',
      entries: [roleCaseTypeEntry('reviews', 'complaints')],
      groups: [COMPLAINTS_WRITE],
    },
  ]);
  assert.deepEqual(lines.slice(0, 3), [
    'Ana (ana)',
    `  row   + ${roleCaseTypeEntry('reviews', 'complaints')}`,
    `  group + ${COMPLAINTS_WRITE}`,
  ]);
  assert.ok(lines.some((line) => /nested AD group/.test(line)));
});

test('the client sends the operator’s headers on every request, and refuses a bad config', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cora-backfill-'));
  const headersFile = join(directory, 'headers.json');
  await writeFile(headersFile, JSON.stringify({ Authorization: 'Bearer x' }));
  /** @type {Headers[]} */
  const seen = [];

  const client = await backfillClient(
    {
      siteUrl: 'https://sp.example/sites/cora/',
      headersFileEnv: 'CORA_BACKFILL_HEADERS',
    },
    {
      env: { CORA_BACKFILL_HEADERS: headersFile },
      fetchImpl: async (input, init) => {
        seen.push(new Headers(init?.headers));
        assert.ok(
          String(input).startsWith('https://sp.example/sites/cora/_api')
        );
        return new Response(JSON.stringify({ value: [] }), { status: 200 });
      },
    }
  );
  await client.getUserRoles('ana');

  assert.equal(seen[0].get('Authorization'), 'Bearer x');
  assert.match(seen[0].get('Accept') ?? '', /json/);

  await assert.rejects(
    backfillClient({ siteUrl: 'http://insecure', headersFileEnv: 'X' }),
    /siteUrl must be an HTTPS URL/
  );
  await assert.rejects(
    backfillClient({ siteUrl: 'https://sp.example', headersFileEnv: 'lower' }),
    /uppercase environment variable/
  );
  await assert.rejects(
    backfillClient(
      { siteUrl: 'https://sp.example', headersFileEnv: 'UNSET_HEADERS' },
      { env: {} }
    ),
    /Missing UNSET_HEADERS/
  );
});
