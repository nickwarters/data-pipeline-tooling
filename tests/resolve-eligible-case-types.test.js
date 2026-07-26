// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  allocationSourcesFromCaseSources,
  loadCaseTypeSources,
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

test('resolveCaseSourcesFromCaseTypes: grants via the list-access group derived from the registry displayName', () => {
  const sources = resolveCaseSourcesFromCaseTypes(
    ['Reviewers - Product Sale Review'],
    [
      {
        slug: 'product-sale-review',
        listName: 'Cases-ProductSaleReview',
        displayName: 'Product Sale Review',
        config: minimalConfig(),
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
        displayName: 'Complaints',
        config: minimalConfig({ maxInProgressCases: 3 }),
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

test('allocationSourcesFromCaseSources: isolates an invalid limit to that Case Type', () => {
  /** @type {Error[]} */
  const errors = [];
  const caseSources = resolveCaseSourcesFromCaseTypes(
    ['Reviewer Managers'],
    [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
        config: minimalConfig({ maxInProgressCases: 0 }),
      },
      {
        slug: 'example-review',
        listName: 'Cases-ExampleReview',
        displayName: 'Example Review',
        config: minimalConfig(),
      },
    ]
  );

  assert.deepEqual(
    allocationSourcesFromCaseSources(caseSources, (error) =>
      errors.push(error)
    ),
    [{ slug: 'example-review', listName: 'Cases-ExampleReview' }]
  );
  assert.equal(caseSources.length, 2, 'other app surfaces keep both sources');
  assert.match(
    errors[0]?.message ?? '',
    /Case Type "complaints" maxInProgressCases must be a positive integer/
  );
});

test('resolveCaseSourcesFromCaseTypes: a Case Type Owner gets only their Case Type source', () => {
  const sources = resolveCaseSourcesFromCaseTypes(
    ['CaseTypeOwner - Complaints'],
    [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
        config: minimalConfig(),
      },
      {
        slug: 'example-review',
        listName: 'Cases-ExampleReview',
        displayName: 'Example Review',
        config: minimalConfig(),
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
      displayName: 'Complaints',
      config: minimalConfig(),
    },
    {
      slug: 'example-review',
      listName: 'Cases-ExampleReview',
      displayName: 'Example Review',
      config: minimalConfig(),
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
        displayName: 'Example Review',
        config: minimalConfig({ eligibleGroups: ['Reviewers'] }),
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
        displayName: 'Complaints',
        config: minimalConfig(),
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
        displayName: 'Complaints',
        config: minimalConfig(),
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
        displayName: 'Complaints',
        config: minimalConfig(),
      },
    ]
  );

  assert.deepEqual(sources, []);
});

// There is no "Case Type without a display name" case left to test: every
// `CaseTypeSource` carries the registry's required `displayName` (#527), so a
// nameless Case Type is a type error rather than a silently short source list.
// Its three derived group names are therefore ALWAYS contributed — the case
// below holds neither `eligibleGroups` nor `reviewerGroup`.
test('resolveCaseSourcesFromCaseTypes: the three derived group names are contributed with no config aliases at all', () => {
  const caseTypes = [
    {
      slug: 'stress-review',
      listName: 'Cases-StressReview',
      displayName: 'Stress Review',
      config: minimalConfig(),
    },
  ];

  for (const group of [
    'Reviewers - Stress Review',
    'CaseTypeOwner - Stress Review',
    'JourneyOwner - Stress Review',
  ]) {
    assert.deepEqual(
      resolveCaseSourcesFromCaseTypes([group], caseTypes),
      [
        {
          slug: 'stress-review',
          listName: 'Cases-StressReview',
          displayName: 'Stress Review',
        },
      ],
      `${group} must grant the source it names`
    );
  }
});

test('resolveCaseSourcesFromCaseTypes: Reviewer Managers get every source', () => {
  const caseTypes = [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      reviewerGroup: 'Reviewers - Complaints',
      displayName: 'Complaints',
      config: minimalConfig(),
    },
    {
      slug: 'stress-review',
      listName: 'Cases-StressReview',
      displayName: 'Stress Review',
      config: minimalConfig(),
    },
  ];

  const sources = resolveCaseSourcesFromCaseTypes(
    ['Reviewer Managers'],
    caseTypes
  );

  assert.deepEqual(sources, [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      displayName: 'Complaints',
    },
    {
      slug: 'stress-review',
      listName: 'Cases-StressReview',
      displayName: 'Stress Review',
    },
  ]);
});

test('resolveCaseSourcesFromCaseTypes: Controls get every Case Type source', () => {
  const caseTypes = [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      displayName: 'Complaints',
      config: minimalConfig(),
    },
    {
      slug: 'example-review',
      listName: 'Cases-ExampleReview',
      displayName: 'Example Review',
      config: minimalConfig(),
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
      displayName: 'Complaints',
      config: minimalConfig(),
    },
    {
      slug: 'example-review',
      listName: 'Cases-ExampleReview',
      displayName: 'Example Review',
      config: minimalConfig(),
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
      displayName: 'Complaints',
      config: minimalConfig(),
    },
    {
      slug: 'example-review',
      listName: 'Cases-ExampleReview',
      displayName: 'Example Review',
      config: minimalConfig(),
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

test('resolveCaseSources: Reviewer Managers are granted every manifest Case Type as a source', async () => {
  const sources = await resolveCaseSources(['Reviewer Managers']);
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
    displayName: 'Example Review',
    config: minimalConfig(),
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
  const sources = await resolveCaseSources(['Reviewer Managers']);
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
  assert.deepEqual(context.unavailableCaseTypes, []);
});

// ===== per-Case-Type containment at boot (#493) =====
//
// A Case Type module that throws when it is evaluated — a syntax error, an
// invalid outcome config, an unknown shared General Question key — must cost
// only its own Case Type, exactly as a broken page costs only its own route.

/** A Case Type module that blows up the moment it is evaluated. */
const brokenImporter = () => {
  throw new SyntaxError('example-review is broken');
};

/** @param {Partial<Record<string, any>>} [overrides] */
function importersWithBrokenExampleReview(overrides = {}) {
  return /** @type {any} */ ({
    complaints: CASE_TYPE_IMPORTERS['complaints'],
    'example-review': brokenImporter,
    ...overrides,
  });
}

test('loadCaseTypeSources: drops the Case Type whose module throws and keeps the rest', async () => {
  /** @type {any[]} */
  const reported = [];
  const { sources, unavailable } = await loadCaseTypeSources(
    ['complaints', 'example-review'],
    importersWithBrokenExampleReview(),
    (failure) => reported.push(failure)
  );

  assert.deepEqual(
    sources.map((source) => source.slug),
    ['complaints'],
    'the working Case Type still resolves'
  );
  assert.deepEqual(
    unavailable.map(({ slug, displayName }) => ({ slug, displayName })),
    [{ slug: 'example-review', displayName: 'Example Review' }]
  );
  assert.equal(reported.length, 1, 'the failing slug is reported once');
  assert.equal(reported[0].slug, 'example-review');
  assert.ok(
    reported[0].error instanceof SyntaxError,
    'the underlying error is carried, not swallowed'
  );
});

test('loadCaseTypeSources: logs the failing slug and its error by default', async () => {
  const original = console.error;
  /** @type {any[][]} */
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    await loadCaseTypeSources(
      ['example-review'],
      importersWithBrokenExampleReview()
    );
  } finally {
    console.error = original;
  }

  assert.equal(logged.length, 1);
  assert.ok(
    logged[0].some((arg) => String(arg).includes('example-review')),
    'the failing slug is named in the log'
  );
  assert.ok(
    logged[0].some((arg) => arg instanceof SyntaxError),
    'the error is logged'
  );
});

test('loadCaseTypeSources: falls back to the slug when the failure has no registered display name', async () => {
  const { sources, unavailable } = await loadCaseTypeSources(
    ['not-registered'],
    /** @type {any} */ ({ 'not-registered': brokenImporter }),
    () => {}
  );

  assert.deepEqual(sources, []);
  assert.deepEqual(
    unavailable.map(({ slug, displayName }) => ({ slug, displayName })),
    [{ slug: 'not-registered', displayName: 'not-registered' }]
  );
});

test('loadCaseTypeSources: an unregistered slug is dropped, never resolved namelessly', async () => {
  const { sources, unavailable } = await loadCaseTypeSources(
    ['not-registered'],
    /** @type {any} */ ({
      'not-registered': async () => ({ default: minimalConfig() }),
    }),
    () => {}
  );

  assert.deepEqual(sources, [], 'no source without a registry displayName');
  assert.deepEqual(
    unavailable.map((failure) => failure.slug),
    ['not-registered']
  );
});

test('resolveAppCaseSources: a broken Case Type cannot leak into any resolved source set', async () => {
  const context = await resolveAppCaseSources(
    ['Reviewer Managers', 'Reviewers - Example Review'],
    ['example-review', 'complaints'],
    {
      importers: importersWithBrokenExampleReview(),
      reportUnavailable: () => {},
    }
  );

  for (const [name, sources] of [
    ['caseSources', context.caseSources],
    ['journeyCaseSources', context.journeyCaseSources],
  ]) {
    assert.equal(
      /** @type {any[]} */ (sources).some(
        (source) => source.slug === 'example-review'
      ),
      false,
      `${name} must not carry the broken Case Type in any form`
    );
  }
  assert.deepEqual(
    context.caseSources.map((source) => source.slug),
    ['complaints'],
    'the working Case Type is still usable'
  );
  assert.deepEqual(
    allocationSourcesFromCaseSources(context.caseSources).map((s) => s.slug),
    ['complaints'],
    'allocation cannot draw from the broken Case Type either'
  );
  assert.deepEqual(
    context.unavailableCaseTypes.map(({ slug, displayName }) => ({
      slug,
      displayName,
    })),
    [{ slug: 'example-review', displayName: 'Example Review' }]
  );
});

test('resolveCaseSources: a user whose only Case Type is broken gets an empty list, not a crash', async () => {
  const sources = await resolveCaseSources(['Reviewers - Example Review'], {
    importers: importersWithBrokenExampleReview(),
    reportUnavailable: () => {},
  });

  assert.deepEqual(sources, []);
});
