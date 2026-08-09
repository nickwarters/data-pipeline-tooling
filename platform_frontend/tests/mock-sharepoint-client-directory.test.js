// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSONAS,
  makeClient,
  makePeopleClient,
  MockSharePointClient,
} from './helpers/mock-sharepoint-client.js';

// Capability: personas, question definitions, people search, and user resolution.

// --- getCurrentUserGroups ---

test('MockSharePointClient: getCurrentUserGroups returns reviewer groups', async () => {
  const client = makeClient('reviewer');
  const groups = await client.getCurrentUserGroups();
  assert.deepEqual(groups, ['Reviewers']);
});

test('MockSharePointClient: getCurrentUserGroups returns owner groups for owner persona', async () => {
  const client = makeClient('owner');
  const groups = await client.getCurrentUserGroups();
  assert.deepEqual(groups, ['Reviewers', 'CaseTypeOwners']);
});

test('MockSharePointClient: getCurrentUserGroups returns empty array for unknown persona', async () => {
  const client = makeClient('unknown-persona'); // not in PERSONAS
  const groups = await client.getCurrentUserGroups();
  assert.deepEqual(
    groups,
    [],
    'unknown persona: personas[p] is undefined → ?. returns undefined → ?? [] returns []'
  );
});

test('MockSharePointClient: getCurrentUser falls back to persona string when persona not in map', async () => {
  const client = makeClient('unknown-persona');
  const user = await client.getCurrentUser();
  assert.equal(
    user.id,
    'unknown-persona',
    'p?.userId ?? persona uses fallback when p is undefined'
  );
  assert.equal(
    user.displayName,
    'unknown-persona',
    'p?.displayName ?? persona uses fallback when p is undefined'
  );
});

test('MockSharePointClient: searchPeople matches displayName substring (case-insensitive)', async () => {
  const client = makePeopleClient();
  const results = await client.searchPeople('smith');
  assert.deepEqual(results.map((r) => r.loginName).sort(), [
    'asmith',
    'jsmith',
  ]);
});

test('MockSharePointClient: searchPeople matches loginName substring', async () => {
  const client = makePeopleClient();
  const results = await client.searchPeople('bjon');
  assert.equal(results.length, 1);
  assert.equal(results[0].loginName, 'bjones');
});

test('MockSharePointClient: searchPeople returns full PersonResult shape including email', async () => {
  const client = makePeopleClient();
  const results = await client.searchPeople('john');
  assert.deepEqual(results, [
    {
      loginName: 'jsmith',
      displayName: 'John Smith',
      email: 'jsmith@contoso.com',
    },
  ]);
});

test('MockSharePointClient: searchPeople returns [] for a blank query', async () => {
  const client = makePeopleClient();
  assert.deepEqual(await client.searchPeople('   '), []);
  assert.deepEqual(await client.searchPeople(''), []);
});

test('MockSharePointClient: searchPeople returns [] when nothing matches', async () => {
  const client = makePeopleClient();
  assert.deepEqual(await client.searchPeople('zzz'), []);
});

test('MockSharePointClient: searchPeople defaults to an empty directory when no people provided', async () => {
  const client = makeClient();
  assert.deepEqual(await client.searchPeople('smith'), []);
});

// --- resolveUsers ---

test('MockSharePointClient: resolveUsers maps bare accounts to display names', async () => {
  const client = makePeopleClient();
  const resolved = await client.resolveUsers(['jsmith', 'bjones']);
  assert.deepEqual(resolved, { jsmith: 'John Smith', bjones: 'Bola Jones' });
});

test('MockSharePointClient: resolveUsers returns null for an account not in the directory', async () => {
  const client = makePeopleClient();
  assert.deepEqual(await client.resolveUsers(['nobody']), { nobody: null });
});

test('MockSharePointClient: resolveUsers dedupes repeated accounts', async () => {
  const client = makePeopleClient();
  assert.deepEqual(await client.resolveUsers(['jsmith', 'jsmith']), {
    jsmith: 'John Smith',
  });
});

test('MockSharePointClient: resolveUsers returns an empty map for an empty list', async () => {
  const client = makePeopleClient();
  assert.deepEqual(await client.resolveUsers([]), {});
});

test('MockSharePointClient: resolveManagers follows the fixture edge and returns canonical bare accounts', async () => {
  const client = makePeopleClient();
  assert.deepEqual(await client.resolveManagers(['jsmith']), {
    jsmith: 'mmanager',
  });
});

test('MockSharePointClient: resolveManagers returns null for an absent manager edge', async () => {
  const client = makePeopleClient();
  assert.deepEqual(await client.resolveManagers(['bjones']), { bjones: null });
});
