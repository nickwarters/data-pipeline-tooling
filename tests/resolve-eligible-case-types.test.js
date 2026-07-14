// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveEligibleCaseSourcesFromCaseTypes,
  resolveEligibleCaseTypes,
  resolveAllocationSourcesFromCaseTypes,
  resolveAllocationSources,
} from '../src/setup/resolve-eligible-case-types.js';
import { CASE_TYPE_IMPORTERS } from '../case-types/manifest.js';

/** @param {Partial<import('../src/sharepoint-client.js').CaseTypeConfig>} overrides */
function minimalConfig(overrides = {}) {
  return {
    questions: [],
    computeOutcome: () => ({ outcome: 'Pass' }),
    outcomeOptions: [{ id: 'Pass', wording: 'Pass', severity: 0 }],
    defaultOutcomeId: 'Pass',
    ...overrides,
  };
}

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
          outcomeOptions: [{ id: 'Pass', wording: 'Pass', severity: 0 }],
          defaultOutcomeId: 'Pass',
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
          outcomeOptions: [{ id: 'Pass', wording: 'Pass', severity: 0 }],
          defaultOutcomeId: 'Pass',
        },
      },
    ]
  );

  assert.deepEqual(sources, []);
});

// ===== resolveAllocationSourcesFromCaseTypes (pure core) =====

test('resolveAllocationSourcesFromCaseTypes: grants via the list-access group derived from config.displayName', () => {
  const sources = resolveAllocationSourcesFromCaseTypes(
    ['Reviewers - Product Sale Review'],
    [
      {
        slug: 'product-sale-review',
        listName: 'Cases-ProductSaleReview',
        config: minimalConfig({ displayName: 'Product Sale Review' }),
      },
    ]
  );

  assert.deepEqual(sources, [
    { slug: 'product-sale-review', listName: 'Cases-ProductSaleReview' },
  ]);
});

test('resolveAllocationSourcesFromCaseTypes: grants via a blanket eligibleGroups entry', () => {
  const sources = resolveAllocationSourcesFromCaseTypes(
    ['Reviewers'],
    [
      {
        slug: 'example-review',
        listName: 'Cases-ExampleReview',
        config: minimalConfig({
          eligibleGroups: ['Reviewers'],
          displayName: 'Example Review',
        }),
      },
    ]
  );

  assert.deepEqual(sources, [
    { slug: 'example-review', listName: 'Cases-ExampleReview' },
  ]);
});

test('resolveAllocationSourcesFromCaseTypes: grants via reviewerGroup', () => {
  const sources = resolveAllocationSourcesFromCaseTypes(
    ['Reviewers - Complaints'],
    [
      {
        slug: 'complaints',
        listName: 'complaints',
        reviewerGroup: 'Reviewers - Complaints',
        config: minimalConfig(),
      },
    ]
  );

  assert.deepEqual(sources, [{ slug: 'complaints', listName: 'complaints' }]);
});

test('resolveAllocationSourcesFromCaseTypes: excludes a Case Type when the user holds none of its groups', () => {
  const sources = resolveAllocationSourcesFromCaseTypes(
    ['SomeOtherGroup'],
    [
      {
        slug: 'complaints',
        listName: 'complaints',
        reviewerGroup: 'Reviewers - Complaints',
        config: minimalConfig({ displayName: 'Complaints' }),
      },
    ]
  );

  assert.deepEqual(sources, []);
});

test('resolveAllocationSourcesFromCaseTypes: Reviewer-Managers get every source regardless of its own groups', () => {
  const caseTypes = [
    {
      slug: 'complaints',
      listName: 'complaints',
      reviewerGroup: 'Reviewers - Complaints',
      config: minimalConfig({ displayName: 'Complaints' }),
    },
    {
      slug: 'example-review',
      listName: 'Cases-ExampleReview',
      config: minimalConfig({ eligibleGroups: ['Reviewers'] }),
    },
  ];

  const sources = resolveAllocationSourcesFromCaseTypes(
    ['Reviewer-Managers'],
    caseTypes
  );

  assert.deepEqual(sources, [
    { slug: 'complaints', listName: 'complaints' },
    { slug: 'example-review', listName: 'Cases-ExampleReview' },
  ]);
});

test('resolveAllocationSourcesFromCaseTypes: uses the explicit listName when the Case Type declares one', () => {
  const sources = resolveAllocationSourcesFromCaseTypes(
    ['Reviewer-Managers'],
    [
      {
        slug: 'product-sale-review',
        listName: 'complaints',
        config: minimalConfig({ listName: 'complaints' }),
      },
    ]
  );

  assert.deepEqual(sources, [
    { slug: 'product-sale-review', listName: 'complaints' },
  ]);
});

test('resolveAllocationSourcesFromCaseTypes: a Case Type with no displayName is not granted via list access', () => {
  const sources = resolveAllocationSourcesFromCaseTypes(
    ['Reviewers - Stress Review'],
    [
      {
        slug: 'stress-review',
        listName: 'Cases-StressReview',
        config: minimalConfig(),
      },
    ]
  );

  assert.deepEqual(sources, []);
});

// ===== resolveAllocationSources (manifest-loading wrapper) =====

test('resolveAllocationSources: returns a Promise', async () => {
  const result = resolveAllocationSources([]);
  assert.ok(result instanceof Promise, 'should return a Promise');
  await result;
});

test('resolveAllocationSources: a plain Reviewers user resolves allocation sources to only example-review', async () => {
  const sources = await resolveAllocationSources(['Reviewers']);
  assert.deepEqual(
    sources.map((s) => s.slug),
    ['example-review']
  );
});

test('resolveAllocationSources: example-review source uses its declared listName', async () => {
  const sources = await resolveAllocationSources(['Reviewers']);
  const exampleReview = sources.find((s) => s.slug === 'example-review');
  assert.deepEqual(exampleReview, {
    slug: 'example-review',
    listName: 'Cases-ExampleReview',
  });
});

test('resolveAllocationSources: a Reviewers - Product Sale Review user is granted the product-sale-review source', async () => {
  const sources = await resolveAllocationSources([
    'Reviewers - Product Sale Review',
  ]);
  assert.deepEqual(
    sources.map((s) => s.slug),
    ['product-sale-review']
  );
});

test('resolveAllocationSources: Reviewer-Managers are granted every manifest Case Type as a source', async () => {
  const sources = await resolveAllocationSources(['Reviewer-Managers']);
  assert.deepEqual(
    sources.map((s) => s.slug).sort(),
    Object.keys(CASE_TYPE_IMPORTERS).sort()
  );
});

test('resolveAllocationSources: returns no sources when the user holds no matching group', async () => {
  const sources = await resolveAllocationSources(['SomeOtherGroup']);
  assert.deepEqual(sources, []);
});
