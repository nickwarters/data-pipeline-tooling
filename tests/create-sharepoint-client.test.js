// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSharePointClient } from '../src/services/create-sharepoint-client.js';

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
  assert.equal(typeof client.getQuestionDefinitions, 'function');
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

  // product-sale-review is the only fixture Case Type declaring a separate
  // list (listName: 'complaints'). Its Cases must be readable list-scoped.
  const listScoped = await client.getCase('psr-case-1', {
    listName: 'complaints',
  });
  assert.ok(listScoped, 'list-backed Case is readable via its listName');
  assert.equal(listScoped?.caseType, 'product-sale-review');

  // …and are partitioned OUT of the default store, matching production where
  // a list-backed Case Type's rows live only in its own list.
  const defaultRead = await client.getCase('psr-case-1');
  assert.equal(
    defaultRead,
    null,
    'list-backed Case is not served from the default store'
  );

  // …but still surface through listCases so dashboards can reach them.
  const all = await client.listCases({});
  assert.ok(
    all.some((c) => c.id === 'psr-case-1'),
    'list-backed Case still appears in listCases'
  );

  // Non-list-backed Case Types remain in the default store.
  assert.ok(
    await client.getCase('case-1'),
    'default-store Case still readable'
  );
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
