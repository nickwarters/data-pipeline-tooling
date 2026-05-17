// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveEligibleCaseTypes } from '../src/resolve-eligible-case-types.js';

test('resolveEligibleCaseTypes: returns a Promise', async () => {
  const result = resolveEligibleCaseTypes([]);
  assert.ok(result instanceof Promise, 'should return a Promise');
  await result;
});

test('resolveEligibleCaseTypes: includes hello-review when user is in Reviewers group', async () => {
  const result = await resolveEligibleCaseTypes(['Reviewers']);
  assert.ok(result.includes('hello-review'), 'hello-review should be eligible for Reviewers');
});

test('resolveEligibleCaseTypes: excludes hello-review when user has no matching group', async () => {
  const result = await resolveEligibleCaseTypes(['SomeOtherGroup']);
  assert.ok(!result.includes('hello-review'), 'hello-review should not be eligible for non-Reviewers');
});

test('resolveEligibleCaseTypes: returns empty array when userGroups is empty', async () => {
  const result = await resolveEligibleCaseTypes([]);
  assert.deepEqual(result, [], 'no case types should be eligible with no user groups');
});

test('resolveEligibleCaseTypes: returns an array', async () => {
  const result = await resolveEligibleCaseTypes(['Reviewers']);
  assert.ok(Array.isArray(result), 'result should be an array');
});
