// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  allocationSourcesFromCaseSources,
  resolveCaseSourcesFromCaseTypes,
  resolveCaseSources,
  resolveAppCaseSources,
} from '../src/setup/resolve-eligible-case-types.js';
import { permissions } from '../src/services/permissions.js';
import { CASE_TYPE_IMPORTERS } from '../case-types/manifest.js';
import { captureConsoleError } from './_console.js';

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

test('resolveCaseSourcesFromCaseTypes: projects the two dashboard cadence thresholds', () => {
  const sources = resolveCaseSourcesFromCaseTypes(
    ['Reviewers - Complaints'],
    [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
        config: minimalConfig({
          actionCentreSlaDays: { awaitingFrontline: 30 },
          breachWindowHours: 48,
          // Not a dashboard threshold: the Case Review page reads it off the
          // config directly, so it must NOT appear on the source.
          remediationSlaWorkingDays: 5,
        }),
      },
    ]
  );

  assert.deepEqual(sources, [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      displayName: 'Complaints',
      actionCentreSlaDays: { awaitingFrontline: 30 },
      breachWindowHours: 48,
    },
  ]);
});

test('resolveCaseSourcesFromCaseTypes: a Case Type declaring no threshold carries no threshold key', () => {
  const [source] = resolveCaseSourcesFromCaseTypes(
    ['Reviewers - Complaints'],
    [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
        config: minimalConfig(),
      },
    ]
  );

  // Deep-equal rather than a per-key undefined check: an `actionCentreSlaDays:
  // undefined` property would satisfy the latter and still change the source.
  assert.deepEqual(source, {
    slug: 'complaints',
    listName: 'Cases-Complaints',
    displayName: 'Complaints',
  });
  assert.equal(Object.hasOwn(source, 'actionCentreSlaDays'), false);
  assert.equal(Object.hasOwn(source, 'breachWindowHours'), false);
});

test('allocationSourcesFromCaseSources: isolates an invalid limit to that Case Type', async () => {
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

  const { result, logged } = await captureConsoleError(() =>
    allocationSourcesFromCaseSources(caseSources)
  );

  assert.deepEqual(result, [
    { slug: 'example-review', listName: 'Cases-ExampleReview' },
  ]);
  assert.equal(caseSources.length, 2, 'other app surfaces keep both sources');
  assert.equal(logged.length, 1, 'the invalid limit is reported once');
  assert.ok(
    logged[0].some((arg) =>
      /Case Type "complaints" maxInProgressCases must be a positive integer/.test(
        arg?.message ?? ''
      )
    ),
    'the reported error names the Case Type and the constraint'
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
// `CaseTypeSource` carries the registry's required `displayName`, so a
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

test('resolveCaseSources: the org-wide Reviewers group alone grants no Case source', async () => {
  // The bare `Reviewers` functional group is axis 1 (what you can do); reading
  // a Case Type's list is axis 2 (which list you can open), and only a
  // per-Case-Type group crosses it. This used to resolve `example-review`,
  // because the fixture declared the org-wide `Reviewers` in its
  // `eligibleGroups` — a pattern since removed from the scaffold as an
  // accident. Asserting the grant was therefore pinning the accident in place;
  // what is worth pinning is that no Case Type opens itself to every Reviewer.
  const sources = await resolveCaseSources(['Reviewers']);
  assert.deepEqual(
    sources.map((s) => s.slug),
    [],
    'no registered Case Type may grant itself to the whole Reviewers group'
  );
});

test('resolveCaseSources: example-review source carries its declared listName and displayName', async () => {
  const sources = await resolveCaseSources(['Reviewers - Example Review']);
  const exampleReview = sources.find((s) => s.slug === 'example-review');
  assert.deepEqual(exampleReview, {
    slug: 'example-review',
    listName: 'Cases-ExampleReview',
    displayName: 'Example Review',
    // The end-to-end proof of the projection: this fixture declares diverging
    // cadence thresholds and the two dashboard ones reach the source.
    actionCentreSlaDays: { awaitingFrontline: 30 },
    breachWindowHours: 48,
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
  const context = await quietlyResolveAppCaseSources(
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

// ===== per-Case-Type containment at boot =====
//
// A Case Type module that throws when it is evaluated — a syntax error, an
// invalid outcome config, an unknown shared General Question key — must cost
// only its own Case Type, exactly as a broken page costs only its own route.

/** A Case Type module that blows up the moment it is evaluated. */
const brokenImporter = () => {
  throw new SyntaxError('example-review is broken');
};

/** @param {Partial<Record<string, any>>} [overrides] */
/**
 * `resolveAppCaseSources` / `resolveCaseSources` with the console captured.
 *
 * Several tests below deliberately feed in a Case Type that cannot load, to
 * prove the failure is contained. Containment reports to `console.error` and
 * takes no reporter seam, so these wrappers keep an intentional failure from
 * printing noise into an otherwise clean run. A test that asserts on what was
 * logged calls the real function through `captureConsoleError` instead.
 *
 * @param {Parameters<typeof resolveAppCaseSources>[0]} userGroups
 * @param {Parameters<typeof resolveAppCaseSources>[1]} ownedJourneyCaseTypes
 * @param {Parameters<typeof resolveAppCaseSources>[2]} [options]
 * @returns {ReturnType<typeof resolveAppCaseSources>}
 */
async function quietlyResolveAppCaseSources(
  userGroups,
  ownedJourneyCaseTypes,
  options
) {
  const { result } = await captureConsoleError(() =>
    resolveAppCaseSources(userGroups, ownedJourneyCaseTypes, options)
  );
  return result;
}

/**
 * @param {Parameters<typeof resolveCaseSources>[0]} userGroups
 * @param {Parameters<typeof resolveCaseSources>[1]} [options]
 * @returns {ReturnType<typeof resolveCaseSources>}
 */
async function quietlyResolveCaseSources(userGroups, options) {
  const { result } = await captureConsoleError(() =>
    resolveCaseSources(userGroups, options)
  );
  return result;
}

function importersWithBrokenExampleReview(overrides = {}) {
  return /** @type {any} */ ({
    complaints: CASE_TYPE_IMPORTERS['complaints'],
    'example-review': brokenImporter,
    ...overrides,
  });
}

test('containment: drops the Case Type whose module throws and keeps the rest', async () => {
  const { result, logged } = await captureConsoleError(() =>
    resolveAppCaseSources(['Reviewer Managers'], [], {
      importers: importersWithBrokenExampleReview(),
    })
  );
  const { caseSources, unavailableCaseTypes } =
    /** @type {Awaited<ReturnType<typeof resolveAppCaseSources>>} */ (result);

  assert.deepEqual(
    caseSources.map((source) => source.slug),
    ['complaints'],
    'the working Case Type still resolves'
  );
  assert.deepEqual(
    unavailableCaseTypes.map(({ slug, displayName }) => ({
      slug,
      displayName,
    })),
    [{ slug: 'example-review', displayName: 'Example Review' }]
  );
  assert.equal(logged.length, 1, 'the failing slug is reported once');
  assert.ok(
    logged[0].some((arg) => String(arg).includes('example-review')),
    'the failing slug is named'
  );
  assert.ok(
    logged[0].some((arg) => arg instanceof SyntaxError),
    'the underlying error is carried, not swallowed'
  );
});

test('containment: logs the failing slug and its error by default', async () => {
  const { logged } = await captureConsoleError(() =>
    resolveCaseSources([], {
      importers: /** @type {any} */ ({ 'example-review': brokenImporter }),
    })
  );

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

test('containment: falls back to the slug when the failure has no registered display name', async () => {
  const { unavailableCaseTypes } = await quietlyResolveAppCaseSources([], [], {
    importers: /** @type {any} */ ({ 'not-registered': brokenImporter }),
  });

  assert.deepEqual(
    unavailableCaseTypes.map(({ slug, displayName }) => ({
      slug,
      displayName,
    })),
    [{ slug: 'not-registered', displayName: 'not-registered' }]
  );
});

test('containment: an unregistered slug is dropped, never resolved namelessly', async () => {
  const { caseSources, unavailableCaseTypes } =
    await quietlyResolveAppCaseSources(['Reviewer Managers'], [], {
      importers: /** @type {any} */ ({
        'not-registered': async () => ({
          default: minimalConfig({ listName: 'Cases-NotRegistered' }),
        }),
      }),
    });

  assert.deepEqual(caseSources, [], 'no source without a registry displayName');
  assert.deepEqual(
    unavailableCaseTypes.map((failure) => failure.slug),
    ['not-registered']
  );
});

test('containment: a config that loads but declares no listName is contained and named', async () => {
  // The gap this closes: the try guarded only the IMPORT, and `config.listName`
  // was a type CAST rather than a check. A module that evaluated fine but
  // returned a partial config produced a source with `listName: undefined`,
  // counted as available, absent from the banner — so nothing named the
  // problem, and it resurfaced later as an opaque route error when a fetch
  // built a request against `undefined`.
  for (const listName of [undefined, '', '   ']) {
    const { caseSources, unavailableCaseTypes } =
      await quietlyResolveAppCaseSources(['Reviewer Managers'], [], {
        importers: /** @type {any} */ ({
          'example-review': async () => ({
            default: minimalConfig({ listName }),
          }),
        }),
      });

    assert.deepEqual(
      caseSources,
      [],
      `listName ${JSON.stringify(listName)} must yield no source at all`
    );
    assert.deepEqual(
      unavailableCaseTypes.map(({ slug, displayName }) => ({
        slug,
        displayName,
      })),
      [{ slug: 'example-review', displayName: 'Example Review' }],
      'and must be NAMED in the banner, not silently dropped'
    );
    assert.ok(
      unavailableCaseTypes[0].error instanceof TypeError,
      'the failure carries a real error for the console'
    );
  }
});

test('containment: an invalid outcome config is contained and named', async () => {
  // The JSDoc listed "an invalid outcome config" as a contained failure mode,
  // but the loader called the RAW importer and never ran
  // `validateConfiguredOutcomeConfig`, so this resolved cleanly into
  // `caseSources` and detonated later on the Case Review page. Routing through
  // `loadCaseTypeConfig` makes the documented claim true.
  const { caseSources, unavailableCaseTypes } =
    await quietlyResolveAppCaseSources(['Reviewer Managers'], [], {
      importers: /** @type {any} */ ({
        'example-review': async () => ({
          default: minimalConfig({
            listName: 'Cases-ExampleReview',
            defaultOutcomeId: 'ghost',
          }),
        }),
      }),
    });

  assert.deepEqual(caseSources, []);
  assert.deepEqual(
    unavailableCaseTypes.map((failure) => failure.slug),
    ['example-review']
  );
  assert.equal(
    /** @type {any} */ (unavailableCaseTypes[0].error).name,
    'InvalidCaseTypeConfigError'
  );
});

test('resolveCaseSourcesFromCaseTypes: a nameless Case Type contributes no derived group names', () => {
  // Defence in depth. No production caller can reach this — `displayNameFor()`
  // throws before a nameless source is built — but the function is exported and
  // its typedef now REQUIRES `displayName`, so an undefined name must not
  // compose `Reviewers - undefined` and grant a real source under it.
  const nameless = /** @type {any} */ ([
    { slug: 'nameless', listName: 'Cases-Nameless', config: minimalConfig() },
  ]);

  for (const group of [
    'Reviewers - undefined',
    'CaseTypeOwner - undefined',
    'JourneyOwner - undefined',
  ]) {
    assert.deepEqual(
      resolveCaseSourcesFromCaseTypes([group], nameless),
      [],
      `${group} must grant nothing`
    );
  }
});

test('loadCaseTypeSources is not exported: options.importers is the one seam', async () => {
  const module = await import('../src/setup/resolve-eligible-case-types.js');
  assert.equal(
    'loadCaseTypeSources' in module,
    false,
    'the production API must not carry a second export that exists only for ' +
      'tests — `options.importers` already covers every case it covered'
  );
});

test('resolveAppCaseSources: a broken Case Type cannot leak into any resolved source set', async () => {
  const context = await quietlyResolveAppCaseSources(
    ['Reviewer Managers', 'Reviewers - Example Review'],
    ['example-review', 'complaints'],
    {
      importers: importersWithBrokenExampleReview(),
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
  const sources = await quietlyResolveCaseSources(
    ['Reviewers - Example Review'],
    {
      importers: importersWithBrokenExampleReview(),
    }
  );

  assert.deepEqual(sources, []);
});
