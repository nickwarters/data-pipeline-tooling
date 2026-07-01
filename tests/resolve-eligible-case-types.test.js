// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveEligibleCaseSourcesFromCaseTypes,
  resolveEligibleCaseTypes,
} from '../src/setup/resolve-eligible-case-types.js';

test('resolveEligibleCaseTypes: returns a Promise', async () => {
  const result = resolveEligibleCaseTypes([]);
  assert.ok(result instanceof Promise, 'should return a Promise');
  await result;
});

test('resolveEligibleCaseTypes: includes example-review when user is in Reviewers group', async () => {
  const result = await resolveEligibleCaseTypes(['Reviewers']);
  assert.ok(
    result.includes('example-review'),
    'example-review should be eligible for Reviewers'
  );
});

test('resolveEligibleCaseTypes: excludes example-review when user has no matching group', async () => {
  const result = await resolveEligibleCaseTypes(['SomeOtherGroup']);
  assert.ok(
    !result.includes('example-review'),
    'example-review should not be eligible for non-Reviewers'
  );
});

test('resolveEligibleCaseTypes: returns empty array when userGroups is empty', async () => {
  const result = await resolveEligibleCaseTypes([]);
  assert.deepEqual(
    result,
    [],
    'no case types should be eligible with no user groups'
  );
});

test('resolveEligibleCaseTypes: returns an array', async () => {
  const result = await resolveEligibleCaseTypes(['Reviewers']);
  assert.ok(Array.isArray(result), 'result should be an array');
});

test('resolveEligibleCaseTypes: Reviewer-Managers get all case types (needed for fan-out reporting)', async () => {
  const result = await resolveEligibleCaseTypes(['Reviewer-Managers']);
  assert.ok(
    result.includes('example-review'),
    'example-review should be eligible for Reviewer-Managers'
  );
  assert.ok(result.length > 0, 'should return at least one case type');
});

test('resolveEligibleCaseSourcesFromCaseTypes: maps reviewer group to its case list source', () => {
  const sources = resolveEligibleCaseSourcesFromCaseTypes(
    ['Reviewers - Complaints'],
    [
      {
        slug: 'complaints',
        listName: 'complaints',
        reviewerGroup: 'Reviewers - Complaints',
        config: {
          listName: 'complaints',
          reviewerGroup: 'Reviewers - Complaints',
          questions: [],
          computeOutcome: () => ({ outcome: 'Pass' }),
        },
      },
    ]
  );

  assert.deepEqual(
    sources.map(({ slug, listName, reviewerGroup }) => ({
      slug,
      listName,
      reviewerGroup,
    })),
    [
      {
        slug: 'complaints',
        listName: 'complaints',
        reviewerGroup: 'Reviewers - Complaints',
      },
    ]
  );
});

test('resolveEligibleCaseSourcesFromCaseTypes: base Reviewers group does not imply complaints list access', () => {
  const sources = resolveEligibleCaseSourcesFromCaseTypes(
    ['Reviewers'],
    [
      {
        slug: 'complaints',
        listName: 'complaints',
        reviewerGroup: 'Reviewers - Complaints',
        config: {
          listName: 'complaints',
          reviewerGroup: 'Reviewers - Complaints',
          questions: [],
          computeOutcome: () => ({ outcome: 'Pass' }),
        },
      },
    ]
  );

  assert.deepEqual(sources, []);
});
