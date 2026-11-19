// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAccessChange } from '../src/services/access-change.js';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';
import { roleCaseTypeEntry } from '../src/services/user-roles.js';

// Capability: a role change is checked, logged, applied group by group, and its shortfall logged too.

const CASE_TYPES = [{ slug: 'complaints', displayName: 'Complaints' }];
const REVIEWER = {
  id: /** @type {const} */ ('reviewer'),
  caseType: 'complaints',
};

const REVIEWS_COMPLAINTS = roleCaseTypeEntry('reviews', 'complaints');

/**
 * A mock tenant with Zara holding `groups` and the roles row `roles`, plus a record of every call in order.
 *
 * @param {{ groups?: string[], roles?: Partial<import('../src/services/user-roles.js').UserRoles>, readOnlyGroups?: string[], missingGroups?: string[] }} [setup]
 */
function tenant({ groups = [], roles, readOnlyGroups, missingGroups } = {}) {
  const client = new MockSharePointClient({
    userRoles: roles ? { zara: roles } : {},
    personas: { maintainer: { groups: [], displayName: 'Robin Maintainer' } },
    persona: 'maintainer',
    people: [{ loginName: 'zara', displayName: 'Zara', groups }],
    readOnlyGroups,
    missingGroups,
    now: () => new Date('2026-10-05T12:00:00Z'),
  });
  /** @type {string[]} */
  const calls = [];
  for (const method of /** @type {const} */ ([
    'listUserGroups',
    'getUserRoles',
    'updateUserRoles',
    'getGroupEditability',
    'addGroupMember',
    'removeGroupMember',
    'addAccessLogEntry',
  ])) {
    const original = client[method].bind(client);
    /** @type {any} */ (client)[method] = async (
      /** @type {any[]} */ ...args
    ) => {
      calls.push(
        method === 'addAccessLogEntry'
          ? `log:${args[0].outcome}`
          : `${method}:${[].concat(args[0]).join('+')}`
      );
      return /** @type {any} */ (original)(...args);
    };
  }
  return { client, calls };
}

const GRANT = {
  action: /** @type {const} */ ('grant'),
  role: REVIEWER,
  account: 'zara',
  targetName: 'Zara',
  reason: 'Joins the team.',
};

test('a grant is checked, then logged, then applied to the roles row and group by group', async () => {
  const { client, calls } = tenant();

  const result = await runAccessChange(client, GRANT, CASE_TYPES);

  assert.deepEqual(result, {
    ok: true,
    applied: [
      REVIEWS_COMPLAINTS,
      'Reviewers - Complaints',
      'Reviewers',
      'Cases - Complaints Write',
    ],
  });
  assert.deepEqual(calls, [
    'listUserGroups:zara',
    'getUserRoles:zara',
    'getGroupEditability:Reviewers - Complaints+Reviewers+Cases - Complaints Write',
    'log:recorded',
    'updateUserRoles:zara',
    'addGroupMember:Reviewers - Complaints',
    'addGroupMember:Reviewers',
    'addGroupMember:Cases - Complaints Write',
  ]);
  assert.deepEqual(await client.listUserGroups('zara'), [
    'Reviewers - Complaints',
    'Reviewers',
    'Cases - Complaints Write',
  ]);
  assert.deepEqual((await client.getUserRoles('zara')).reviews, ['complaints']);
  const [entry] = await client.listAccessLog({ account: 'zara' });
  assert.deepEqual(
    { ...entry, id: undefined },
    {
      id: undefined,
      account: 'zara',
      targetName: 'Zara',
      action: 'grant',
      role: 'reviewer',
      caseType: 'complaints',
      reason: 'Joins the team.',
      changes: [
        { field: REVIEWS_COMPLAINTS, before: false, after: true },
        { field: 'Reviewers - Complaints', before: false, after: true },
        { field: 'Reviewers', before: false, after: true },
        { field: 'Cases - Complaints Write', before: false, after: true },
      ],
      outcome: 'recorded',
      relatesTo: null,
      createdAt: '2026-10-05T12:00:00.000Z',
      createdBy: 'Robin Maintainer',
    }
  );
});

test('a role with no Case Type is logged with an empty Case Type', async () => {
  const { client } = tenant();

  await runAccessChange(
    client,
    { ...GRANT, role: { id: 'controls', caseType: null } },
    CASE_TYPES
  );

  const [entry] = await client.listAccessLog({ account: 'zara' });
  assert.equal(entry.caseType, '');
  assert.equal(entry.role, 'controls');
});

test('a revoke removes only groups the person holds, working from a fresh read', async () => {
  const { client, calls } = tenant({
    groups: ['Reviewers - Complaints', 'Reviewers'],
  });

  const result = await runAccessChange(
    client,
    { ...GRANT, action: 'revoke' },
    CASE_TYPES
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.filter((call) => call.startsWith('removeGroupMember')),
    ['removeGroupMember:Reviewers - Complaints', 'removeGroupMember:Reviewers']
  );
  assert.ok(
    !calls.some((call) => call.startsWith('updateUserRoles')),
    'a row that holds nothing of the role is not written'
  );
  assert.equal(calls[0], 'listUserGroups:zara', 'the read comes first');
  assert.deepEqual(await client.listUserGroups('zara'), []);
});

test('a revoke of a role held only through the roles row clears the row and leaves the groups alone', async () => {
  const { client, calls } = tenant({
    groups: ['Cases - Complaints Write'],
    roles: { reviews: ['complaints'] },
  });

  const result = await runAccessChange(
    client,
    { ...GRANT, action: 'revoke' },
    CASE_TYPES
  );

  assert.deepEqual(result, {
    ok: true,
    applied: [REVIEWS_COMPLAINTS, 'Cases - Complaints Write'],
  });
  assert.deepEqual(calls.filter((call) => !call.startsWith('log:')).slice(-2), [
    'updateUserRoles:zara',
    'removeGroupMember:Cases - Complaints Write',
  ]);
  assert.deepEqual((await client.getUserRoles('zara')).reviews, []);
});

test('a revoke for access the person lost since the page was read changes and logs nothing', async () => {
  const { client, calls } = tenant();

  const result = await runAccessChange(
    client,
    { ...GRANT, action: 'revoke' },
    CASE_TYPES
  );

  assert.deepEqual(result, {
    ok: false,
    outcome: 'refused',
    message: 'Nothing was changed. They do not hold this access.',
  });
  assert.deepEqual(calls, ['listUserGroups:zara', 'getUserRoles:zara']);
});

test('a revoke is refused while another held role needs the access, with nothing written', async () => {
  const { client, calls } = tenant({
    groups: [
      'Reviewers - Complaints',
      'Reviewers',
      'CaseTypeOwner - Complaints',
    ],
  });

  const result = await runAccessChange(
    client,
    { ...GRANT, action: 'revoke' },
    CASE_TYPES
  );

  assert.equal(result.ok, false);
  assert.match(
    /** @type {any} */ (result).message,
    /Remove Case Type Owner for Complaints first/
  );
  assert.deepEqual(calls, ['listUserGroups:zara', 'getUserRoles:zara']);
});

test('a group that cannot be changed refuses the whole change, naming the role and the group', async () => {
  for (const [setup, wording] of /** @type {const} */ ([
    [
      { readOnlyGroups: ['Reviewers'] },
      /you cannot change who is in Reviewers\b/,
    ],
    [{ missingGroups: ['Reviewers'] }, /Reviewers does not exist/],
  ])) {
    const { client, calls } = tenant(/** @type {any} */ (setup));

    const result = await runAccessChange(client, GRANT, CASE_TYPES);

    assert.equal(result.ok, false);
    assert.equal(/** @type {any} */ (result).outcome, 'refused');
    assert.match(/** @type {any} */ (result).message, /Reviewer, Complaints/);
    assert.match(/** @type {any} */ (result).message, wording);
    assert.ok(
      !calls.some(
        (call) =>
          call.startsWith('log:') ||
          call.includes('Member') ||
          call.startsWith('updateUserRoles')
      )
    );
    assert.deepEqual(await client.listAccessLog({ account: 'zara' }), []);
    assert.deepEqual(await client.listUserGroups('zara'), []);
  }
});

test('a log that cannot be written leaves every group untouched', async () => {
  const { client } = tenant();
  client.addAccessLogEntry = async () => {
    throw new Error('HTTP 403');
  };

  const result = await runAccessChange(client, GRANT, CASE_TYPES);

  assert.equal(result.ok, false);
  assert.match(
    /** @type {any} */ (result).message,
    /access log could not be written/
  );
  assert.deepEqual(await client.listUserGroups('zara'), []);
});

test('a roles row that cannot be written is logged as not applied, naming the entry it follows, and no group is changed', async () => {
  const { client } = tenant();
  client.updateUserRoles = async () => ({ ok: false, status: 403 });

  const result = await runAccessChange(client, GRANT, CASE_TYPES);

  assert.equal(result.ok, false);
  assert.equal(/** @type {any} */ (result).outcome, 'not-applied');
  assert.match(
    /** @type {any} */ (result).message,
    /their CoraUserRoles row \(status 403\), so nothing was changed/
  );
  assert.deepEqual(await client.listUserGroups('zara'), []);
  const [followUp, recorded] = await client.listAccessLog({ account: 'zara' });
  assert.equal(recorded.outcome, 'recorded');
  assert.equal(followUp.outcome, 'not-applied');
  assert.equal(followUp.relatesTo, recorded.id);
  assert.deepEqual(followUp.changes, []);
});

test('a later group that fails is logged as partly applied with what did land', async () => {
  const { client } = tenant();
  const add = client.addGroupMember.bind(client);
  client.addGroupMember = async (group, account) => {
    if (group === 'Reviewers') throw new Error('network down');
    return add(group, account);
  };

  const result = await runAccessChange(client, GRANT, CASE_TYPES);

  assert.equal(result.ok, false);
  assert.equal(/** @type {any} */ (result).outcome, 'partly-applied');
  assert.match(/** @type {any} */ (result).message, /status 0.*only part/);
  const [followUp] = await client.listAccessLog({ account: 'zara' });
  assert.equal(followUp.outcome, 'partly-applied');
  assert.deepEqual(followUp.changes, [
    { field: REVIEWS_COMPLAINTS, before: false, after: true },
    { field: 'Reviewers - Complaints', before: false, after: true },
  ]);
  assert.deepEqual(await client.listUserGroups('zara'), [
    'Reviewers - Complaints',
  ]);
});

test('a remove that fails is a failed change, never a success', async () => {
  const { client } = tenant({ groups: ['Controls'] });
  const remove = client.removeGroupMember.bind(client);
  client.removeGroupMember = async (group, account) => {
    await remove(group, account);
    return remove(group, account);
  };

  const result = await runAccessChange(
    client,
    { ...GRANT, action: 'revoke', role: { id: 'controls', caseType: null } },
    CASE_TYPES
  );

  assert.equal(result.ok, false);
  assert.equal(/** @type {any} */ (result).outcome, 'not-applied');
  assert.match(/** @type {any} */ (result).message, /status 400/);
});

test('a roles row write that throws is treated as a failed write', async () => {
  const { client } = tenant();
  client.updateUserRoles = async () => {
    throw new Error('network down');
  };

  const result = await runAccessChange(client, GRANT, CASE_TYPES);

  assert.equal(/** @type {any} */ (result).outcome, 'not-applied');
  assert.match(/** @type {any} */ (result).message, /status 0/);
});

test('a failure the log cannot record is still reported, and says the log is incomplete', async () => {
  const { client } = tenant();
  const log = client.addAccessLogEntry.bind(client);
  let written = 0;
  client.addAccessLogEntry = async (entry) => {
    written += 1;
    if (written > 1) throw new Error('HTTP 403');
    return log(entry);
  };
  client.addGroupMember = async () => ({ ok: false, status: 500 });

  const result = await runAccessChange(client, GRANT, CASE_TYPES);

  assert.equal(result.ok, false);
  assert.match(/** @type {any} */ (result).message, /status 500/);
  assert.match(/** @type {any} */ (result).message, /could not record that/);
});

test('reads that fail refuse the change before anything is written', async () => {
  for (const method of /** @type {const} */ ([
    'listUserGroups',
    'getUserRoles',
    'getGroupEditability',
  ])) {
    const { client } = tenant();
    client[method] = async () => {
      throw new Error('HTTP 500');
    };

    const result = await runAccessChange(client, GRANT, CASE_TYPES);

    assert.equal(result.ok, false, method);
    assert.equal(/** @type {any} */ (result).outcome, 'refused', method);
    assert.deepEqual(
      await client.listAccessLog({ account: 'zara' }),
      [],
      method
    );
  }
});
