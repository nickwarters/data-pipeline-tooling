// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSharePointClient,
  partitionCasesByList,
} from '../src/services/create-sharepoint-client.js';

test('createSharePointClient: returns a Promise', () => {
  const result = createSharePointClient(new URLSearchParams(''));
  assert.ok(result instanceof Promise, 'should return a Promise');
  return result.then(() => {});
});

test('createSharePointClient: returns an object satisfying SharePointClient when mock=0', async () => {
  const client = await createSharePointClient(new URLSearchParams(''));
  assert.equal(typeof client.getCurrentUser, 'function');
  assert.equal(typeof client.getCurrentUserGroups, 'function');
  assert.equal(typeof client.getCase, 'function');
  assert.equal(typeof client.listCases, 'function');
  assert.equal(typeof client.patchCase, 'function');
});

test('createSharePointClient: returns a MockSharePointClient when mock=1', async () => {
  const { MockSharePointClient } =
    await import('../src/services/mock-sharepoint-client.js');
  const client = await createSharePointClient(new URLSearchParams('mock=1'));
  assert.ok(
    client instanceof MockSharePointClient,
    'should be a MockSharePointClient'
  );
});

test('createSharePointClient: returns an HttpSharePointClient when mock param is absent', async () => {
  const { HttpSharePointClient } =
    await import('../src/services/http-sharepoint-client.js');
  const client = await createSharePointClient(new URLSearchParams(''));
  assert.ok(
    client instanceof HttpSharePointClient,
    'should be an HttpSharePointClient'
  );
});

test('createSharePointClient: mock client uses asUser persona', async () => {
  const client = await createSharePointClient(
    new URLSearchParams('mock=1&asUser=owner')
  );
  // owner persona exists in fixtures/personas.js
  const user = await client.getCurrentUser();
  assert.ok(user.id, 'should return a user from the owner persona');
});

test('createSharePointClient: mock client defaults to reviewer persona when asUser is absent', async () => {
  const client = await createSharePointClient(new URLSearchParams('mock=1'));
  const user = await client.getCurrentUser();
  assert.ok(user.id, 'should return a user from the default reviewer persona');
});

test('createSharePointClient: mock client serves list-backed Case Types (issue #249)', async () => {
  const client = await createSharePointClient(new URLSearchParams('mock=1'));

  // complaints declares its own list (Cases-Complaints). Its Cases must be
  // readable list-scoped.
  const listScoped = await client.getCase('complaints-case-1', {
    listName: 'Cases-Complaints',
  });
  assert.ok(listScoped, 'list-backed Case is readable via its listName');
  assert.equal(listScoped?.caseType, 'complaints');

  // …and reading a list surfaces it (there is no default store to fall back
  // to — a read without listName now throws).
  const inList = await client.listCases({}, { listName: 'Cases-Complaints' });
  assert.ok(
    inList.some((c) => c.id === 'complaints-case-1'),
    'list-backed Case appears in its list-scoped listCases'
  );

  // There is no default store: a Case read without a listName fails loudly.
  await assert.rejects(
    () => client.getCase('complaints-case-1'),
    /listName is required/
  );
});

test('partitionCasesByList: routes every Case to its named list store (total, no default bucket)', async () => {
  /** @type {any} */
  const cases = [
    { id: 'a', caseType: 'alpha', answers: {} },
    { id: 'b', caseType: 'beta', answers: {} },
    { id: 'a2', caseType: 'alpha', answers: {} },
  ];
  /** @param {string} slug */
  const loadCaseTypeConfig = async (slug) =>
    /** @type {any} */ ({
      listName: slug === 'alpha' ? 'Cases-Alpha' : 'Cases-Beta',
    });

  const lists = await partitionCasesByList(cases, loadCaseTypeConfig);

  assert.deepEqual(
    lists['Cases-Alpha'].map((c) => c.id),
    ['a', 'a2']
  );
  assert.deepEqual(
    lists['Cases-Beta'].map((c) => c.id),
    ['b']
  );
});

test('partitionCasesByList: throws for a Case Type whose config declares no listName', async () => {
  /** @type {any} */
  const cases = [{ id: 'a', caseType: 'listless', answers: {} }];
  /** @param {string} _slug */
  const loadCaseTypeConfig = async (_slug) => /** @type {any} */ ({});

  await assert.rejects(
    () => partitionCasesByList(cases, loadCaseTypeConfig),
    /declares no listName/
  );
});

test('createSharePointClient: passes the environment listPrefix and exportBasePath to the HTTP client (#366)', async () => {
  const { resolveEnvironment } = await import('../src/config/environment.js');
  const client = /** @type {any} */ (
    await createSharePointClient(
      new URLSearchParams(''),
      resolveEnvironment('uat')
    )
  );
  assert.equal(client._listPrefix, 'uat_');
  assert.equal(
    client._exportBasePath,
    '/Style%20Library/case-review-uat/case-types'
  );
});

test('createSharePointClient: defaults to the prod environment (#366)', async () => {
  const client = /** @type {any} */ (
    await createSharePointClient(new URLSearchParams(''))
  );
  assert.equal(client._listPrefix, '');
  assert.equal(
    client._exportBasePath,
    '/Style%20Library/case-review/case-types'
  );
});

test('createSharePointClient: environment does not affect the mock client (#366)', async () => {
  const { MockSharePointClient } =
    await import('../src/services/mock-sharepoint-client.js');
  const { resolveEnvironment } = await import('../src/config/environment.js');
  const client = await createSharePointClient(
    new URLSearchParams('mock=1'),
    resolveEnvironment('uat')
  );
  assert.ok(client instanceof MockSharePointClient);
});

test('createSharePointClient: mock client searchPeople is backed by the people fixture', async () => {
  const { people } = await import('../dev/fixtures/people.js');
  const client = await createSharePointClient(new URLSearchParams('mock=1'));
  const sample = people[0];
  const results = await client.searchPeople(sample.displayName.split(' ')[0]);
  assert.ok(
    results.length > 0,
    'fixture-backed search returns at least one match'
  );
  assert.ok(
    results.every(
      (r) => typeof r.loginName === 'string' && r.loginName.length > 0
    )
  );
});
