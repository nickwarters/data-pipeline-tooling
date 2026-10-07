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

// Capability: group membership is read and changed as the signed-in user, and every change is audited in one list.

const CLAIMS = 'i:0#.w|CONTOSO\\zara';
const ENCODED_CLAIMS = encodeURIComponent(CLAIMS);

/** @param {unknown} body @param {number} [status] */
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });

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

/** @param {number} status */
const failing = (status) => ({
  when: (/** @type {any} */ c) =>
    c.method === 'POST' && c.url.includes('sitegroups'),
  respond: () => new Response('no', { status }),
});

test('HttpSharePointClient: a person’s groups are read by claims login, titles only', async () => {
  const { client, calls } = http([
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        json({
          value: [
            { Id: 1, Title: 'Reviewers' },
            { Id: 2, Title: "Reviewers - O'Brien" },
          ],
        }),
    },
  ]);

  const groups = await client.listUserGroups('zara');

  assert.deepEqual(groups, ['Reviewers', "Reviewers - O'Brien"]);
  assert.equal(
    calls.find((c) => c.method === 'GET')?.url,
    `${WEB_URL}/_api/web/siteusers/getbyloginname(@v)/groups?@v='${ENCODED_CLAIMS}'&$select=Id,Title`
  );
  assert.equal(
    calls.filter((c) => c.url.endsWith('/ensureuser')).length,
    0,
    'reading someone never adds them to the site'
  );
});

test('HttpSharePointClient: an apostrophe in a login is doubled before it is encoded', async () => {
  const { client, calls } = http([
    { when: () => true, respond: () => json({ value: [] }) },
  ]);

  await client.listUserGroups("o'brien");

  assert.match(
    calls.find((c) => c.url.includes('getbyloginname'))?.url ?? '',
    new RegExp(`@v='${encodeURIComponent("i:0#.w|CONTOSO\\o''brien")}'`)
  );
});

test('HttpSharePointClient: a person the site has never seen holds no groups, and other failures still throw', async () => {
  const missing = http([
    { when: () => true, respond: () => new Response('', { status: 404 }) },
  ]);
  assert.deepEqual(await missing.client.listUserGroups('nobody'), []);

  const broken = http([
    { when: () => true, respond: () => new Response('', { status: 500 }) },
  ]);
  await assert.rejects(broken.client.listUserGroups('zara'), /HTTP Error: 500/);
});

test('HttpSharePointClient: editability is asked of each distinct group, and 404 means missing', async () => {
  const { client, calls } = http([
    {
      when: (c) => c.url.includes("getbyname('Reviewers')"),
      respond: () => json({ Id: 1, CanCurrentUserEditMembership: true }),
    },
    {
      when: (c) => c.url.includes("getbyname('Controls')"),
      respond: () => json({ Id: 2, CanCurrentUserEditMembership: false }),
    },
    {
      when: (c) => c.url.includes("getbyname('Gone')"),
      respond: () => new Response('', { status: 404 }),
    },
  ]);

  const result = await client.getGroupEditability([
    'Reviewers',
    'Controls',
    'Gone',
    'Reviewers',
  ]);

  assert.deepEqual(result, {
    Reviewers: 'editable',
    Controls: 'read-only',
    Gone: 'missing',
  });
  assert.equal(calls.length, 3);
  assert.equal(
    calls[0].url,
    `${WEB_URL}/_api/web/sitegroups/getbyname('Reviewers')?$select=Id,CanCurrentUserEditMembership`
  );
});

test('HttpSharePointClient: an editability read that fails for another reason rejects', async () => {
  const { client } = http([
    { when: () => true, respond: () => new Response('', { status: 500 }) },
  ]);
  await assert.rejects(
    client.getGroupEditability(['Reviewers']),
    /HTTP Error: 500/
  );
});

test('HttpSharePointClient: adding posts the claims login to the group’s users with the form digest', async () => {
  const { client, calls } = http([
    { when: (c) => c.method === 'POST', respond: () => json({ Id: 9 }) },
  ]);

  const result = await client.addGroupMember("Reviewers - O'Brien", 'zara');

  assert.deepEqual(result, { ok: true });
  const post = calls.find((c) => c.url.includes('sitegroups'));
  assert.equal(
    post?.url,
    `${WEB_URL}/_api/web/sitegroups/getbyname('Reviewers%20-%20O''Brien')/users`
  );
  assert.deepEqual(JSON.parse(String(post?.body)), { LoginName: CLAIMS });
  assert.equal(post?.headers['x-requestdigest'], 'digest-1');
});

test('HttpSharePointClient: removing posts to removebyloginname with the claims login and no body', async () => {
  const { client, calls } = http([
    {
      when: (c) => c.method === 'POST',
      respond: () => new Response(null, { status: 204 }),
    },
  ]);

  const result = await client.removeGroupMember('Reviewers', 'zara');

  assert.deepEqual(result, { ok: true });
  const post = calls.find((c) => c.url.includes('removebyloginname'));
  assert.equal(
    post?.url,
    `${WEB_URL}/_api/web/sitegroups/getbyname('Reviewers')/users/removebyloginname(@v)?@v='${ENCODED_CLAIMS}'`
  );
  assert.equal(post?.body, null);
  assert.equal(post?.headers['x-requestdigest'], 'digest-1');
});

test('HttpSharePointClient: a membership write answered 200 with an empty body did change the group', async () => {
  const { client } = http([
    {
      when: (c) => c.method === 'POST' && c.url.includes('sitegroups'),
      respond: () => new Response('', { status: 200 }),
    },
  ]);

  assert.deepEqual(await client.addGroupMember('Reviewers', 'zara'), {
    ok: true,
  });
  assert.deepEqual(await client.removeGroupMember('Reviewers', 'zara'), {
    ok: true,
  });
});

test('HttpSharePointClient: a stale digest is refreshed once and the membership write retried', async () => {
  let attempts = 0;
  const { client, calls } = http([
    {
      when: (c) => c.method === 'POST' && c.url.includes('sitegroups'),
      respond: () =>
        ++attempts === 1 ? new Response('', { status: 403 }) : json({}),
    },
  ]);

  assert.deepEqual(await client.addGroupMember('Reviewers', 'zara'), {
    ok: true,
  });
  assert.equal(calls.filter((c) => c.url.endsWith('/contextinfo')).length, 2);
});

test('HttpSharePointClient: a membership write that fails comes back as its status, add or remove', async () => {
  for (const status of [403, 400, 500]) {
    const { client } = http([failing(status)]);
    const expected = { ok: false, status };
    assert.deepEqual(
      await client.addGroupMember('Reviewers', 'zara'),
      expected
    );
    assert.deepEqual(
      await client.removeGroupMember('Reviewers', 'zara'),
      expected
    );
  }
});

test('HttpSharePointClient: removing someone who is not in the group is reported as a failure, never as success', async () => {
  const { client } = http([failing(500)]);

  assert.deepEqual(await client.removeGroupMember('Reviewers', 'zara'), {
    ok: false,
    status: 500,
  });
});

test('HttpSharePointClient: a write that fails before any status exists is reported as a failure', async () => {
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });

  assert.deepEqual(await client.addGroupMember('Reviewers', 'zara'), {
    ok: false,
    status: 500,
  });
});

/** @param {Record<string, unknown>} [overrides] */
function logItem(overrides = {}) {
  return {
    Id: 3,
    Title: 'zara',
    TargetName: 'Zara',
    AccessAction: 'grant',
    AccessRole: 'reviewer',
    CaseType: 'complaints',
    Reason: 'Joins the team.',
    Changes: JSON.stringify([
      { field: 'Reviewers', before: false, after: true },
    ]),
    Outcome: 'recorded',
    RelatesTo: null,
    Created: '2026-10-01T09:00:00Z',
    Author: { Title: 'Robin Maintainer', Name: 'i:0#.w|corp\\robin' },
    ...overrides,
  };
}

test('HttpSharePointClient: the Access Log is read by indexed Title, newest first, from the unprefixed list', async () => {
  const { client, calls } = http(
    [
      {
        when: (c) => c.method === 'GET',
        respond: () => json({ value: [logItem()] }),
      },
    ],
    { listPrefix: 'uat_' }
  );

  const rows = await client.listAccessLog({ account: "o'zara" });

  const url = decodeURIComponent(calls[0].url);
  assert.match(url, /getbytitle\('CoraAccessLog'\)\/items/);
  assert.match(url, /\$filter=Title eq 'o''zara'/);
  assert.match(url, /\$expand=Author/);
  assert.match(url, /\$orderby=Created desc,Id desc/);
  assert.deepEqual(rows, [
    {
      id: '3',
      account: 'zara',
      targetName: 'Zara',
      action: 'grant',
      role: 'reviewer',
      caseType: 'complaints',
      reason: 'Joins the team.',
      changes: [{ field: 'Reviewers', before: false, after: true }],
      outcome: 'recorded',
      relatesTo: null,
      createdAt: '2026-10-01T09:00:00Z',
      createdBy: 'Robin Maintainer',
    },
  ]);
});

test('HttpSharePointClient: every other list is still prefixed by the environment', async () => {
  const { client, calls } = http(
    [{ when: () => true, respond: () => json({ value: [] }) }],
    { listPrefix: 'uat_' }
  );

  await client.listSupportLog({ caseType: 'complaints', caseId: '1' });
  await client.listAccessLog({ account: 'zara' });

  assert.match(calls[0].url, /getbytitle\('uat_CaseSupportLog'\)/);
  assert.match(calls[1].url, /getbytitle\('CoraAccessLog'\)/);
});

test('HttpSharePointClient: an Access Log entry with an unknown outcome or action reads as recorded, and unreadable Changes as none', async () => {
  const warn = console.warn;
  /** @type {unknown[][]} */
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const { client } = http([
      {
        when: () => true,
        respond: () =>
          json({
            value: [
              logItem({
                Outcome: 'partly-applied',
                AccessAction: 'revoke',
                RelatesTo: '2',
              }),
              logItem({
                Id: 4,
                Outcome: 'edited by hand',
                Changes: '{nope',
                Author: null,
              }),
            ],
          }),
      },
    ]);
    const [partly, odd] = await client.listAccessLog({ account: 'zara' });
    assert.equal(partly.outcome, 'partly-applied');
    assert.equal(partly.action, 'revoke');
    assert.equal(partly.relatesTo, '2');
    assert.equal(odd.outcome, 'recorded');
    assert.deepEqual(odd.changes, []);
    assert.equal(odd.createdBy, '');
  } finally {
    console.warn = warn;
  }
  assert.match(String(warnings[0][0]), /Access Log entry "4"/);
});

test('HttpSharePointClient: appending posts the entry to the unprefixed list, never who or when, and returns its id', async () => {
  const { client, calls } = http(
    [{ when: (c) => c.method === 'POST', respond: () => json({ Id: 42 }) }],
    { listPrefix: 'uat_' }
  );

  const id = await client.addAccessLogEntry({
    account: 'zara',
    targetName: 'Zara',
    action: 'revoke',
    role: 'journey-owner',
    caseType: '',
    reason: 'Moved on.',
    changes: [
      { field: 'JourneyOwner - Complaints', before: true, after: false },
    ],
    outcome: 'recorded',
    relatesTo: null,
  });

  assert.equal(id, '42');
  const post = calls.find((c) => c.url.includes('CoraAccessLog'));
  assert.equal(
    post?.url,
    `${WEB_URL}/_api/web/lists/getbytitle('CoraAccessLog')/items`
  );
  assert.deepEqual(JSON.parse(String(post?.body)), {
    Title: 'zara',
    TargetName: 'Zara',
    AccessAction: 'revoke',
    AccessRole: 'journey-owner',
    CaseType: '',
    Reason: 'Moved on.',
    Changes: JSON.stringify([
      { field: 'JourneyOwner - Complaints', before: true, after: false },
    ]),
    Outcome: 'recorded',
    RelatesTo: '',
  });
});

test('HttpSharePointClient: an append that returns no id throws, so no change is made on an unlogged entry', async () => {
  const { client } = http([
    { when: (c) => c.method === 'POST', respond: () => json({}) },
  ]);

  await assert.rejects(
    client.addAccessLogEntry({
      account: 'zara',
      targetName: 'Zara',
      action: 'grant',
      role: 'controls',
      caseType: '',
      reason: 'x',
      changes: [],
      outcome: 'recorded',
      relatesTo: '1',
    }),
    /did not return an id/
  );
});

// --- the mock, held to the same contract ---

/** @param {ConstructorParameters<typeof MockSharePointClient>[0]} [options] */
function mock(options = { personas: {} }) {
  return new MockSharePointClient({
    people: [
      { loginName: 'zara', displayName: 'Zara', groups: ['Controls'] },
      { loginName: 'bea', displayName: 'Bea' },
    ],
    now: () => new Date('2026-10-05T12:00:00Z'),
    ...options,
  });
}

test('MockSharePointClient: groups are read per person, case-insensitively, and an unknown person holds none', async () => {
  const client = mock();
  assert.deepEqual(await client.listUserGroups('ZARA'), ['Controls']);
  assert.deepEqual(await client.listUserGroups('nobody'), []);
});

test('MockSharePointClient: adding is idempotent and shows in the group’s members', async () => {
  const client = mock();

  assert.deepEqual(await client.addGroupMember('Reviewers', 'bea'), {
    ok: true,
  });
  assert.deepEqual(await client.addGroupMember('Reviewers', 'bea'), {
    ok: true,
  });

  assert.deepEqual(await client.listUserGroups('bea'), ['Reviewers']);
  assert.deepEqual(
    (await client.listGroupMembers('Reviewers')).map((p) => p.loginName),
    ['bea']
  );
});

test('MockSharePointClient: removing someone who is not in the group fails, as the tenant does', async () => {
  const client = mock();

  assert.deepEqual(await client.removeGroupMember('Controls', 'bea'), {
    ok: false,
    status: 400,
  });
  assert.deepEqual(await client.removeGroupMember('Controls', 'zara'), {
    ok: true,
  });
  assert.deepEqual(await client.listUserGroups('zara'), []);
  assert.deepEqual(await client.removeGroupMember('Controls', 'zara'), {
    ok: false,
    status: 400,
  });
});

test('MockSharePointClient: read-only and missing groups refuse writes and say so when asked', async () => {
  const client = mock({
    personas: {},
    readOnlyGroups: ['Controls'],
    missingGroups: ['Gone'],
  });

  assert.deepEqual(
    await client.getGroupEditability(['Controls', 'Gone', 'Reviewers']),
    { Controls: 'read-only', Gone: 'missing', Reviewers: 'editable' }
  );
  assert.deepEqual(await client.addGroupMember('Controls', 'bea'), {
    ok: false,
    status: 403,
  });
  assert.deepEqual(await client.removeGroupMember('Controls', 'zara'), {
    ok: false,
    status: 403,
  });
  assert.deepEqual(await client.addGroupMember('Gone', 'bea'), {
    ok: false,
    status: 404,
  });
  assert.deepEqual(await client.addGroupMember('Reviewers', 'nobody'), {
    ok: false,
    status: 404,
  });
});

test('MockSharePointClient: a client does not change the fixture people it was built from', async () => {
  const people = [
    { loginName: 'bea', displayName: 'Bea', groups: ['Controls'] },
  ];
  await new MockSharePointClient({ personas: {}, people }).removeGroupMember(
    'Controls',
    'bea'
  );
  assert.deepEqual(people[0].groups, ['Controls']);
});

test('MockSharePointClient: the Access Log is append-only, newest first, and stamped by the persona and clock', async () => {
  const client = mock({
    personas: { maintainer: { groups: [], displayName: 'Robin Maintainer' } },
    persona: 'maintainer',
    accessLog: [
      {
        id: '1',
        account: 'zara',
        targetName: 'Zara',
        action: 'grant',
        role: 'controls',
        caseType: '',
        reason: 'Seeded.',
        changes: [],
        outcome: 'recorded',
        relatesTo: null,
        createdAt: '2026-10-01T00:00:00Z',
        createdBy: 'Someone',
      },
    ],
  });

  const id = await client.addAccessLogEntry({
    account: 'ZARA',
    targetName: 'Zara',
    action: 'revoke',
    role: 'controls',
    caseType: '',
    reason: 'Moved on.',
    changes: [],
    outcome: 'recorded',
    relatesTo: null,
  });

  const rows = await client.listAccessLog({ account: 'zara' });
  assert.deepEqual(
    rows.map((row) => row.id),
    [id, '1']
  );
  assert.equal(rows[0].createdBy, 'Robin Maintainer');
  assert.equal(rows[0].createdAt, '2026-10-05T12:00:00.000Z');
  assert.deepEqual(await client.listAccessLog({ account: 'bea' }), []);
});

test('the group and Access Log reads are cancelled with the page that asked for them', async () => {
  const controller = new AbortController();
  controller.abort();
  const client = withAbortSignal(mock(), controller.signal);

  for (const read of [
    () => client.listUserGroups('zara'),
    () => client.getGroupEditability(['Controls']),
    () => client.listAccessLog({ account: 'zara' }),
  ]) {
    await assert.rejects(
      read(),
      (error) => /** @type {any} */ (error).name === 'AbortError'
    );
  }
});

test('HttpSharePointClient: the group and Access Log reads carry the mount signal', async () => {
  const controller = new AbortController();
  /** @type {Array<AbortSignal | null | undefined>} */
  const signals = [];
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async (_input, init) => {
      if (init?.method === 'GET') signals.push(init.signal);
      return json({ value: [], CanCurrentUserEditMembership: true });
    },
  });
  const bound = withAbortSignal(client, controller.signal);

  await bound.listUserGroups('zara');
  await bound.getGroupEditability(['Controls']);
  await bound.listAccessLog({ account: 'zara' });

  assert.equal(signals.length, 3);
  for (const signal of signals) assert.equal(signal, controller.signal);
});
