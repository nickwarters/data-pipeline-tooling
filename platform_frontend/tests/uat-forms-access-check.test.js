// @ts-check

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runFormsAccessCheck,
  validateFormsConfig,
} from '../scripts/uat_forms_access_check.js';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';
import { personas } from '../dev/fixtures/personas.js';
import { formLists } from '../dev/fixtures/forms.js';
import { oneToOne } from '../form-types/one-to-one.js';

// Capability: before real Forms go in, a UAT run proves each persona is offered
// exactly what the Forms access rule promises on a real list: what the
// dashboard lists for them, and which Forms they can open and edit. The
// example matrix is the dev cast's, so it is held to the rule here too.

/** The dev fixtures are written against this day. */
const NOW = () => new Date(2026, 9, 10, 12, 0, 0);

/** Which dev persona plays each persona the example matrix names. */
/** @type {Readonly<Record<string, string>>} */
const CAST = {
  employee: 'forms-employee',
  'first line manager': 'forms-line-manager',
  'second line manager': 'forms-second-line-manager',
  'former manager': 'forms-former-manager',
  'control group member': 'forms-control',
  'unrelated access-group member': 'forms-colleague',
  'outside the Forms groups': 'forms-unrelated',
};

async function example() {
  return JSON.parse(
    await readFile(
      new URL('../scripts/uat-forms-access.example.json', import.meta.url),
      'utf8'
    )
  );
}

/** Run the check with each persona signed in to the mock as its dev persona. */
function runOnMock(/** @type {unknown} */ config) {
  return runFormsAccessCheck(config, {
    formTypes: [oneToOne],
    now: NOW,
    clientFor: async (persona) =>
      /** @type {any} */ (
        new MockSharePointClient({
          personas,
          persona: CAST[persona.name],
          formLists,
        })
      ),
  });
}

test('the example matrix is what the access rule offers the dev cast', async () => {
  const results = await runOnMock(await example());

  assert.deepEqual(
    results.filter((result) => !result.ok),
    []
  );
  assert.equal(results.length, Object.keys(CAST).length * 3);
});

test('a persona offered more, or less, than the matrix says fails, naming both', async () => {
  const config = await example();
  const slm = config.personas.find(
    (/** @type {any} */ persona) => persona.name === 'second line manager'
  );
  slm.edits = ['101', '104'];
  const employee = config.personas.find(
    (/** @type {any} */ persona) => persona.name === 'employee'
  );
  employee.opens = ['101', '102'];

  const failed = (await runOnMock(config)).filter((result) => !result.ok);
  assert.deepEqual(failed, [
    {
      persona: 'employee',
      aspect: 'opens',
      ok: false,
      message: 'expected 101, 102, offered 101, 102, 103',
    },
    {
      persona: 'second line manager',
      aspect: 'edits',
      ok: false,
      message: 'expected 101, 104, offered 104',
    },
  ]);
});

test('one persona that cannot be read is reported, and the rest still run', async () => {
  const results = await runFormsAccessCheck(await example(), {
    formTypes: [oneToOne],
    now: NOW,
    clientFor: async (persona) => {
      if (persona.name === 'employee') throw new Error('HTTP 401');
      return /** @type {any} */ (
        new MockSharePointClient({
          personas,
          persona: CAST[persona.name],
          formLists,
        })
      );
    },
  });

  assert.deepEqual(
    results.filter((result) => !result.ok),
    [{ persona: 'employee', aspect: 'read', ok: false, message: 'HTTP 401' }]
  );
});

test('each persona reads the prefixed list with its own headers, and only reads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cora-uat-forms-'));
  /** @type {Record<string, string>} */
  const env = {};
  const config = await example();
  for (const persona of config.personas) {
    const path = join(directory, `${persona.headersFileEnv}.json`);
    await writeFile(
      path,
      JSON.stringify({ Authorization: `Bearer ${persona.name}` })
    );
    env[persona.headersFileEnv] = path;
  }
  /** @type {Array<{ url: string, method: string, authorization: string | null }>} */
  const requests = [];
  const results = await runFormsAccessCheck(config, {
    formTypes: [oneToOne],
    env,
    fetchImpl: async (input, init = {}) => {
      requests.push({
        url: String(input),
        method: init.method ?? 'GET',
        authorization: new Headers(init.headers).get('Authorization'),
      });
      return new Response('{}', { status: 403 });
    },
  });

  assert.ok(results.every((result) => !result.ok && result.aspect === 'read'));
  assert.deepEqual(
    [...new Set(requests.map((request) => request.authorization))],
    config.personas.map(
      (/** @type {any} */ persona) => `Bearer ${persona.name}`
    )
  );
  assert.ok(requests.every((request) => request.method === 'GET'));
  assert.ok(
    requests.every((request) =>
      request.url.startsWith('https://sharepoint.example/sites/cora/_api/')
    )
  );
});

/** A small valid matrix to break one rule of at a time. */
function matrix() {
  return {
    siteUrl: 'https://sharepoint.example/sites/cora',
    listPrefix: 'uat_',
    formType: 'one-to-one',
    forms: ['1'],
    personas: [
      {
        name: 'editor',
        headersFileEnv: 'EDITOR',
        lists: ['1'],
        opens: ['1'],
        edits: ['1'],
      },
      {
        name: 'reader',
        headersFileEnv: 'READER',
        lists: [],
        opens: ['1'],
        edits: [],
      },
      {
        name: 'outsider',
        headersFileEnv: 'OUTSIDER',
        lists: [],
        opens: [],
        edits: [],
      },
    ],
  };
}

test('a matrix that could pass by checking nothing is refused before any read', () => {
  assert.ok(validateFormsConfig(matrix(), [oneToOne]));

  /** @type {Array<[string, (config: any) => void, RegExp]>} */
  const broken = [
    ['production', (c) => (c.listPrefix = ''), /non-production/],
    ['plain http', (c) => (c.siteUrl = 'http://x'), /HTTPS/],
    ['unknown type', (c) => (c.formType = 'nope'), /not a composed Form Type/],
    ['no forms', (c) => (c.forms = []), /at least one Form id/],
    ['repeated form', (c) => (c.forms = ['1', '1']), /repeats an id/],
    ['no personas', (c) => (c.personas = []), /at least one persona/],
    ['unnamed', (c) => (c.personas[0].name = ''), /requires a name/],
    [
      'duplicate',
      (c) => (c.personas[1].name = 'editor'),
      /"editor" is duplicated/,
    ],
    [
      'lower-case env',
      (c) => (c.personas[0].headersFileEnv = 'editor'),
      /uppercase headersFileEnv/,
    ],
    [
      'stray id',
      (c) => (c.personas[0].opens = ['1', '2']),
      /opens must list ids from forms/,
    ],
    [
      'edits unopened',
      (c) => {
        c.personas[1].opens = [];
        c.personas[1].edits = ['1'];
      },
      /edits a Form it cannot open/,
    ],
    [
      'nobody opens',
      (c) => {
        for (const persona of c.personas) {
          persona.lists = [];
          persona.opens = [];
          persona.edits = [];
        }
      },
      /a persona who opens it/,
    ],
    [
      'nobody refused',
      (c) => (c.personas[2].opens = ['1']),
      /a persona it is refused to/,
    ],
    [
      'no editor',
      (c) => (c.personas[0].edits = []),
      /a persona who edits a Form/,
    ],
    [
      'no reader',
      (c) => (c.personas[1].opens = []),
      /reads a Form without editing it/,
    ],
  ];
  for (const [name, breakIt, why] of broken) {
    const config = matrix();
    breakIt(config);
    assert.throws(() => validateFormsConfig(config, [oneToOne]), why, name);
  }
});
