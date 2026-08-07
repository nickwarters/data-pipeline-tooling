// @ts-check

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectivePermissions,
  listPermissionsUrl,
  listReadUrl,
  runAclSmoke,
  validateConfig,
  writePermissions,
} from '../scripts/uat_acl_smoke.js';

const LIST = 'uat_Cases-Complaints';

/** @param {'allow' | 'deny'} read @param {'allow' | 'deny'} write */
function expectation(read, write) {
  return { listName: LIST, read, write };
}

function config() {
  return {
    siteUrl: 'https://sharepoint.example/sites/cora/',
    personas: [
      {
        name: 'reader',
        headersFileEnv: 'READER_HEADERS',
        expectations: [expectation('allow', 'deny')],
      },
      {
        name: 'outsider',
        headersFileEnv: 'OUTSIDER_HEADERS',
        expectations: [expectation('deny', 'deny')],
      },
    ],
  };
}

async function headersEnvironment() {
  const directory = await mkdtemp(join(tmpdir(), 'cora-uat-acl-'));
  const reader = join(directory, 'reader.json');
  const outsider = join(directory, 'outsider.json');
  await Promise.all([
    writeFile(reader, JSON.stringify({ Authorization: 'Bearer reader' })),
    writeFile(outsider, JSON.stringify({ Authorization: 'Bearer outsider' })),
  ]);
  return { READER_HEADERS: reader, OUTSIDER_HEADERS: outsider };
}

/** @param {number} status @param {unknown} [body] */
function response(status, body) {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('validateConfig: normalises the site URL and applies safe defaults', () => {
  const result = validateConfig(config());
  assert.equal(result.siteUrl, 'https://sharepoint.example/sites/cora');
  assert.equal(result.requiredListPrefix, 'uat_');
  assert.deepEqual(result.deniedStatuses, [401, 403, 404]);
  assert.equal(result.timeoutMs, 10_000);
});

test('validateConfig: rejects production list names', () => {
  const raw = config();
  raw.personas[0].expectations[0].listName = 'Cases-Complaints';
  assert.throws(() => validateConfig(raw), /must start with "uat_"/);
});

test('validateConfig: requires positive, read-denial, and write-denial controls', () => {
  const raw = config();
  raw.personas = [raw.personas[0]];
  assert.throws(() => validateConfig(raw), /requires a denied reader/);

  const noReadOnly = config();
  noReadOnly.personas[0].expectations[0].write = 'allow';
  assert.throws(
    () => validateConfig(noReadOnly),
    /requires a read-allowed, write-denied persona/
  );
});

test('SharePoint URLs safely encode list names inside the OData literal', () => {
  assert.equal(
    listReadUrl('https://sp.example/site', "uat_Cases-Bob's"),
    "https://sp.example/site/_api/web/lists/getbytitle('uat_Cases-Bob%27%27s')/items?$select=Id&$top=1"
  );
  assert.match(
    listPermissionsUrl('https://sp.example/site', LIST),
    /\?\$select=EffectiveBasePermissions$/
  );
});

test('permission parsing accepts minimal and verbose SharePoint payloads', () => {
  assert.equal(
    effectivePermissions({ EffectiveBasePermissions: { Low: '6' } }),
    6n
  );
  assert.equal(
    effectivePermissions({ d: { EffectiveBasePermissions: { Low: '14' } } }),
    14n
  );
  assert.deepEqual(writePermissions(14n), {
    add: true,
    edit: true,
    delete: true,
  });
  assert.throws(() => effectivePermissions({}), /did not return/);
});

test('runAclSmoke: confirms an allowed read, denied write, and denied reader', async () => {
  const env = await headersEnvironment();
  /** @type {{ input: string, init?: RequestInit }[]} */
  const calls = [];
  const results = await runAclSmoke(config(), {
    env,
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), init });
      const authorization = new Headers(init?.headers).get('Authorization');
      if (authorization === 'Bearer outsider') return response(403);
      if (String(input).includes('EffectiveBasePermissions')) {
        return response(200, { EffectiveBasePermissions: { Low: '1' } });
      }
      return response(200, { value: [] });
    },
  });

  assert.equal(results.length, 2);
  assert.ok(results.every(({ ok }) => ok));
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every(({ init }) =>
      new Headers(init?.headers).get('Accept')?.includes('json')
    )
  );
});

test('runAclSmoke: fails if a denied persona can read the list', async () => {
  const results = await runAclSmoke(config(), {
    env: await headersEnvironment(),
    fetchImpl: async (input) =>
      String(input).includes('EffectiveBasePermissions')
        ? response(200, { EffectiveBasePermissions: { Low: '1' } })
        : response(200, { value: [] }),
  });

  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.match(results[1].message, /expected read denial/);
});

test('runAclSmoke: fails if a read-only persona has any write permission', async () => {
  const env = await headersEnvironment();
  const results = await runAclSmoke(config(), {
    env,
    fetchImpl: async (input, init) => {
      const authorization = new Headers(init?.headers).get('Authorization');
      if (authorization === 'Bearer outsider') return response(403);
      if (String(input).includes('EffectiveBasePermissions')) {
        return response(200, { EffectiveBasePermissions: { Low: '3' } });
      }
      return response(200, { value: [] });
    },
  });

  assert.equal(results[0].ok, false);
  assert.match(results[0].message, /granted: add/);
  assert.equal(results[1].ok, true);
});
