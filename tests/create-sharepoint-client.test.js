// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSharePointClient } from '../src/create-sharepoint-client.js';

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
  const { MockSharePointClient } = await import('../src/mock-sharepoint-client.js');
  const client = await createSharePointClient(new URLSearchParams('mock=1'));
  assert.ok(client instanceof MockSharePointClient, 'should be a MockSharePointClient');
});

test('createSharePointClient: returns an HttpSharePointClient when mock param is absent', async () => {
  const { HttpSharePointClient } = await import('../src/http-sharepoint-client.js');
  const client = await createSharePointClient(new URLSearchParams(''));
  assert.ok(client instanceof HttpSharePointClient, 'should be an HttpSharePointClient');
});

test('createSharePointClient: mock client uses asUser persona', async () => {
  const client = await createSharePointClient(new URLSearchParams('mock=1&asUser=owner'));
  // owner persona exists in fixtures/personas.js
  const user = await client.getCurrentUser();
  assert.ok(user.id, 'should return a user from the owner persona');
});

test('createSharePointClient: mock client defaults to reviewer persona when asUser is absent', async () => {
  const client = await createSharePointClient(new URLSearchParams('mock=1'));
  const user = await client.getCurrentUser();
  assert.ok(user.id, 'should return a user from the default reviewer persona');
});
