// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAccessChange } from '../src/services/access-change.js';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';

// Capability: a role change is checked, logged, applied group by group, and its shortfall logged too.

const CASE_TYPES = [{ slug: 'complaints', displayName: 'Complaints' }];
const REVIEWER = {
  id: /** @type {const} */ ('reviewer'),
  caseType: 'complaints',
};

/**
 * A mock tenant with Zara holding `groups`, plus a record of every call in order.
 *
 * @param {{ groups?: string[], readOnlyGroups?: string[], missingGroups?: string[] }} [setup]
 */
function tenant({ groups = [], readOnlyGroups, missingGroups } = {}) {
  const client = new MockSharePointClient({
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

test('a grant is checked, then logged, then applied group by group', async () => {
  const { client, calls } = tenant();

  const result = await runAccessChange(client, GRANT, CASE_TYPES);

  assert.deepEqual(result, {
    ok: true,
    applied: ['Reviewers - Complaints', 'Reviewers'],
  });
  assert.deepEqual(calls, [
    'listUserGroups:zara',
    'getGroupEditability:Reviewers - Complaints+Reviewers',
    'log:recorded',
    'addGroupMember:Reviewers - Complaints',
    'addGroupMember:Reviewers',
  ]);
  assert.deepEqual(await client.listUserGroups('zara'), [
    'Reviewers - Complaints',
    'Reviewers',
  ]);
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
        { field: 'Reviewers - Complaints', before: false, after: true },
        { field: 'Reviewers', before: false, after: true },
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
  assert.equal(calls[0], 'listUserGroups:zara', 'the read comes first');
  assert.deepEqual(await client.listUserGroups('zara'), []);
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
  assert.deepEqual(calls, ['listUserGroups:zara']);
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
  assert.deepEqual(calls, ['listUserGroups:zara']);
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
      !calls.some((call) => call.startsWith('log:') || call.includes('Member'))
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

test('a first group that fails is logged as not applied, naming the entry it follows', async () => {
  const { client } = tenant();
  client.addGroupMember = async () => ({ ok: false, status: 403 });

  const result = await runAccessChange(client, GRANT, CASE_TYPES);

  assert.equal(result.ok, false);
  assert.equal(/** @type {any} */ (result).outcome, 'not-applied');
  assert.match(
    /** @type {any} */ (result).message,
    /Reviewers - Complaints \(status 403\), so nothing was changed/
  );
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
