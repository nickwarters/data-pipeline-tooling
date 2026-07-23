// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCaseSourcesFromCaseTypes,
  resolveCaseSources,
  resolveAppCaseSources,
} from '../src/setup/resolve-eligible-case-types.js';
import { permissions } from '../src/services/permissions.js';
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

// ===== resolveCaseSourcesFromCaseTypes (pure core, the app-wide rule) =====

test('resolveCaseSourcesFromCaseTypes: grants via the list-access group derived from config.displayName', () => {
  const sources = resolveCaseSourcesFromCaseTypes(
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
    {
      slug: 'product-sale-review',
      listName: 'Cases-ProductSaleReview',
      displayName: 'Product Sale Review',
    },
  ]);
});

test('resolveCaseSourcesFromCaseTypes: carries the optional allocation limit from Case Type config', () => {
  const sources = resolveCaseSourcesFromCaseTypes(
    ['Reviewers - Complaints'],
    [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        config: minimalConfig({
          displayName: 'Complaints',
          maxInProgressCases: 3,
        }),
      },
    ]
  );

  assert.deepEqual(sources, [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      displayName: 'Complaints',
      maxInProgressCases: 3,
    },
  ]);
});

test('resolveCaseSourcesFromCaseTypes: rejects a non-positive allocation limit', () => {
  assert.throws(
    () =>
      resolveCaseSourcesFromCaseTypes(
        ['Reviewers - Complaints'],
        [
          {
            slug: 'complaints',
            listName: 'Cases-Complaints',
            config: minimalConfig({
              displayName: 'Complaints',
              maxInProgressCases: 0,
            }),
          },
        ]
      ),
    /maxInProgressCases must be a positive integer/
  );
});

test('resolveCaseSourcesFromCaseTypes: a Case Type Owner gets only their Case Type source', () => {
  const sources = resolveCaseSourcesFromCaseTypes(
    ['CaseTypeOwner - Complaints'],
    [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        config: minimalConfig({ displayName: 'Complaints' }),
      },
      {
        slug: 'example-review',
        listName: 'Cases-ExampleReview',
        config: minimalConfig({ displayName: 'Example Review' }),
      },
    ]
  );

  assert.deepEqual(sources, [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      displayName: 'Complaints',
    },
  ]);
});

test('resolveCaseSourcesFromCaseTypes: a Journey Owner gets only their Case Type source', () => {
  const caseTypes = [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      config: minimalConfig({ displayName: 'Complaints' }),
    },
    {
      slug: 'example-review',
      listName: 'Cases-ExampleReview',
      config: minimalConfig({ displayName: 'Example Review' }),
    },
  ];

  assert.deepEqual(
    resolveCaseSourcesFromCaseTypes(
      ['JourneyOwner - Example Review'],
      caseTypes
    ),
    [
      {
        slug: 'example-review',
        listName: 'Cases-ExampleReview',
        displayName: 'Example Review',
      },
    ]
  );
});

test('resolveCaseSourcesFromCaseTypes: grants via a blanket eligibleGroups entry', () => {
  const sources = resolveCaseSourcesFromCaseTypes(
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
    {
      slug: 'example-review',
      listName: 'Cases-ExampleReview',
      displayName: 'Example Review',
    },
  ]);
});

test('resolveCaseSourcesFromCaseTypes: grants via reviewerGroup', () => {
  const sources = resolveCaseSourcesFromCaseTypes(
    ['Reviewers - Complaints'],
    [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        reviewerGroup: 'Reviewers - Complaints',
        config: minimalConfig({ displayName: 'Complaints' }),
      },
    ]
  );

  assert.deepEqual(sources, [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      displayName: 'Complaints',
    },
  ]);
});

test('resolveCaseSourcesFromCaseTypes: base Reviewers group does not imply a per-type list', () => {
  const sources = resolveCaseSourcesFromCaseTypes(
    ['Reviewers'],
    [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        reviewerGroup: 'Reviewers - Complaints',
        config: minimalConfig({ displayName: 'Complaints' }),
      },
    ]
  );

  assert.deepEqual(sources, []);
});

test('resolveCaseSourcesFromCaseTypes: excludes a Case Type when the user holds none of its groups', () => {
  const sources = resolveCaseSourcesFromCaseTypes(
    ['SomeOtherGroup'],
    [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        reviewerGroup: 'Reviewers - Complaints',
        config: minimalConfig({ displayName: 'Complaints' }),
      },
    ]
  );

  assert.deepEqual(sources, []);
});

test('resolveCaseSourcesFromCaseTypes: a Case Type with no displayName is not granted via list access and reports an empty displayName', () => {
  const sources = resolveCaseSourcesFromCaseTypes(
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

test('resolveCaseSourcesFromCaseTypes: Reviewer-Managers get every source (with empty displayName when a config declares none)', () => {
  const caseTypes = [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      reviewerGroup: 'Reviewers - Complaints',
      config: minimalConfig({ displayName: 'Complaints' }),
    },
    {
      slug: 'nameless',
      listName: 'Cases-Nameless',
      config: minimalConfig(),
    },
  ];

  const sources = resolveCaseSourcesFromCaseTypes(
    ['Reviewer-Managers'],
    caseTypes
  );

  assert.deepEqual(sources, [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      displayName: 'Complaints',
    },
    { slug: 'nameless', listName: 'Cases-Nameless', displayName: '' },
  ]);
});

test('resolveCaseSourcesFromCaseTypes: Controls get every Case Type source', () => {
  const caseTypes = [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      config: minimalConfig({ displayName: 'Complaints' }),
    },
    {
      slug: 'example-review',
      listName: 'Cases-ExampleReview',
      config: minimalConfig({ displayName: 'Example Review' }),
    },
  ];

  assert.deepEqual(
    resolveCaseSourcesFromCaseTypes(['Controls'], caseTypes).map(
      (source) => source.slug
    ),
    ['complaints', 'example-review']
  );
});

test('resolveCaseSourcesFromCaseTypes: Advisers get every Case Type source', () => {
  const caseTypes = [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      config: minimalConfig({ displayName: 'Complaints' }),
    },
    {
      slug: 'example-review',
      listName: 'Cases-ExampleReview',
      config: minimalConfig({ displayName: 'Example Review' }),
    },
  ];

  assert.deepEqual(
    resolveCaseSourcesFromCaseTypes(['Advisers'], caseTypes).map(
      (source) => source.slug
    ),
    ['complaints', 'example-review']
  );
});

test('resolveCaseSourcesFromCaseTypes: Responsible Party Managers get every Case Type source', () => {
  const caseTypes = [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      config: minimalConfig({ displayName: 'Complaints' }),
    },
    {
      slug: 'example-review',
      listName: 'Cases-ExampleReview',
      config: minimalConfig({ displayName: 'Example Review' }),
    },
  ];

  assert.deepEqual(
    resolveCaseSourcesFromCaseTypes(
      ['ResponsibleParty-Managers'],
      caseTypes
    ).map((source) => source.slug),
    ['complaints', 'example-review']
  );
});

// ===== resolveCaseSources (manifest-loading wrapper) =====

test('resolveCaseSources: returns a Promise', async () => {
  const result = resolveCaseSources([]);
  assert.ok(result instanceof Promise, 'should return a Promise');
  await result;
});

test('resolveCaseSources: a plain Reviewers user resolves to only example-review', async () => {
  const sources = await resolveCaseSources(['Reviewers']);
  assert.deepEqual(
    sources.map((s) => s.slug),
    ['example-review']
  );
});

test('resolveCaseSources: example-review source carries its declared listName and displayName', async () => {
  const sources = await resolveCaseSources(['Reviewers']);
  const exampleReview = sources.find((s) => s.slug === 'example-review');
  assert.deepEqual(exampleReview, {
    slug: 'example-review',
    listName: 'Cases-ExampleReview',
    displayName: 'Example Review',
  });
});

test('resolveCaseSources: a Reviewers - Complaints user is granted the complaints source via its derived list-access group', async () => {
  const sources = await resolveCaseSources(['Reviewers - Complaints']);
  assert.deepEqual(sources, [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      displayName: 'Complaints',
      maxInProgressCases: 3,
    },
  ]);
});

test('resolveCaseSources: Reviewer-Managers are granted every manifest Case Type as a source', async () => {
  const sources = await resolveCaseSources(['Reviewer-Managers']);
  assert.deepEqual(
    sources.map((s) => s.slug).sort(),
    Object.keys(CASE_TYPE_IMPORTERS).sort()
  );
});

test('resolveCaseSources: Maintainers can sample Cases from every Question Bank source', async () => {
  const sources = await resolveCaseSources([permissions.maintainer]);
  assert.deepEqual(
    sources.map((s) => s.slug).sort(),
    Object.keys(CASE_TYPE_IMPORTERS).sort()
  );
});

test('resolveCaseSourcesFromCaseTypes: broad roles come from the permissions config', () => {
  const source = {
    slug: 'example-review',
    listName: 'Cases-ExampleReview',
    config: minimalConfig({ displayName: 'Example Review' }),
  };
  for (const group of [
    permissions.reviewerManager,
    permissions.controls,
    permissions.adviser,
    permissions.responsiblePartyManager,
    permissions.maintainer,
  ]) {
    assert.equal(resolveCaseSourcesFromCaseTypes([group], [source]).length, 1);
  }
});

test('resolveCaseSources: complaints carries its explicit Case list', async () => {
  const sources = await resolveCaseSources(['Reviewer-Managers']);
  const complaints = sources.find((s) => s.slug === 'complaints');
  assert.equal(complaints?.listName, 'Cases-Complaints');
});

test('resolveCaseSources: returns no sources when the user holds no matching group', async () => {
  const sources = await resolveCaseSources(['SomeOtherGroup']);
  assert.deepEqual(sources, []);
});

test('resolveAppCaseSources: threads only a Case Type Owner eligible source to app surfaces', async () => {
  const context = await resolveAppCaseSources(
    ['CaseTypeOwner - Complaints'],
    []
  );

  assert.deepEqual(
    context.caseSources.map((source) => source.slug),
    ['complaints']
  );
  assert.deepEqual(context.journeyCaseSources, []);
});
