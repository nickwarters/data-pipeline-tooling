// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  allocationSourcesFromCaseSources,
  resolveCaseSourcesFromCaseTypes,
  resolveAppCaseSources,
} from '../src/setup/resolve-eligible-case-types.js';
import { permissions } from '../src/services/permissions.js';
import { noRoles } from '../src/services/user-roles.js';
import { CASE_TYPE_IMPORTERS } from '../case-types/manifest.js';
import { captureConsoleError } from './_console.js';
import { caseSourcesFor, holding } from './_case-sources-for.js';

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

/**
 * The pure rule for someone holding `held` — groups and role entries alike.
 *
 * @param {readonly string[]} held
 * @param {Parameters<typeof resolveCaseSourcesFromCaseTypes>[1]} caseTypes
 */
function sourcesFor(held, caseTypes) {
  const { groups, roles } = holding(held);
  return resolveCaseSourcesFromCaseTypes(groups, caseTypes, roles);
}

// ===== resolveCaseSourcesFromCaseTypes (pure core, the app-wide rule) =====

test('resolveCaseSourcesFromCaseTypes: reviewing a Case Type grants its source', () => {
  const sources = sourcesFor(
    ['CoraUserRoles: Reviews = product-sale-review'],
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

test('resolveCaseSourcesFromCaseTypes: allocation policy is not carried per Case Type', () => {
  const sources = sourcesFor(
    ['CoraUserRoles: Reviews = complaints'],
    [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
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

test('resolveCaseSourcesFromCaseTypes: projects the three dashboard cadence thresholds', () => {
  const sources = sourcesFor(
    ['CoraUserRoles: Reviews = complaints'],
    [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
        config: minimalConfig({
          actionCentreSlaDays: { awaitingFrontline: 30 },
          breachWindowHours: 48,
          reviewSlaWorkingDays: 7,
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
      reviewSlaWorkingDays: 7,
    },
  ]);
});

test('resolveCaseSourcesFromCaseTypes: a Case Type declaring no threshold carries no threshold key', () => {
  const [source] = sourcesFor(
    ['CoraUserRoles: Reviews = complaints'],
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
  assert.equal(Object.hasOwn(source, 'reviewSlaWorkingDays'), false);
});

test('allocationSourcesFromCaseSources: projects only allocation list identity', () => {
  const caseSources = sourcesFor(
    ['CoraUserRoles: ReviewerManager'],
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

  const result = allocationSourcesFromCaseSources(caseSources, [
    'complaints',
    'example-review',
  ]);

  assert.deepEqual(result, [
    { slug: 'complaints', listName: 'Cases-Complaints' },
    { slug: 'example-review', listName: 'Cases-ExampleReview' },
  ]);
});

test('allocationSourcesFromCaseSources: a Maintainer who reviews one Case Type draws only from that Case Type', () => {
  const caseSources = sourcesFor(
    ['CORA Owner Delegates', 'CoraUserRoles: Reviews = complaints'],
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
  assert.equal(caseSources.length, 2, 'the Maintainer can read every list');

  assert.deepEqual(
    allocationSourcesFromCaseSources(caseSources, ['complaints']),
    [{ slug: 'complaints', listName: 'Cases-Complaints' }]
  );
});

test('allocationSourcesFromCaseSources: owning a Case Type without reviewing it gives no allocation source', () => {
  const caseSources = sourcesFor(
    ['CoraUserRoles: OwnsCaseTypes = complaints'],
    [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
        config: minimalConfig(),
      },
    ]
  );
  assert.equal(caseSources.length, 1);

  assert.deepEqual(allocationSourcesFromCaseSources(caseSources, []), []);
});

test('resolveCaseSourcesFromCaseTypes: a Case Type Owner gets only their Case Type source', () => {
  const sources = sourcesFor(
    ['CoraUserRoles: OwnsCaseTypes = complaints'],
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
    sourcesFor(['CoraUserRoles: JourneyOwnerOf = example-review'], caseTypes),
    [
      {
        slug: 'example-review',
        listName: 'Cases-ExampleReview',
        displayName: 'Example Review',
      },
    ]
  );
});

test('resolveCaseSourcesFromCaseTypes: the bare Reviewer flag does not imply a per-type list', () => {
  const sources = sourcesFor(
    ['CoraUserRoles: Reviewer'],
    [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
        config: minimalConfig(),
      },
    ]
  );

  assert.deepEqual(sources, []);
});

test('resolveCaseSourcesFromCaseTypes: excludes a Case Type the user holds no role on', () => {
  const sources = sourcesFor(
    ['SomeOtherGroup'],
    [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
        config: minimalConfig(),
      },
    ]
  );

  assert.deepEqual(sources, []);
});

test('resolveCaseSourcesFromCaseTypes: each per-type role grants the source it names', () => {
  const caseTypes = [
    {
      slug: 'stress-review',
      listName: 'Cases-StressReview',
      displayName: 'Stress Review',
      config: minimalConfig(),
    },
  ];

  for (const entry of [
    'CoraUserRoles: Reviews = stress-review',
    'CoraUserRoles: OwnsCaseTypes = stress-review',
    'CoraUserRoles: JourneyOwnerOf = stress-review',
  ]) {
    assert.deepEqual(
      sourcesFor([entry], caseTypes),
      [
        {
          slug: 'stress-review',
          listName: 'Cases-StressReview',
          displayName: 'Stress Review',
        },
      ],
      `${entry} must grant the source it names`
    );
  }
});

test('resolveCaseSourcesFromCaseTypes: Reviewer Managers get every source', () => {
  const caseTypes = [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
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

  const sources = sourcesFor(['CoraUserRoles: ReviewerManager'], caseTypes);

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
    sourcesFor(['CoraUserRoles: Controls'], caseTypes).map(
      (source) => source.slug
    ),
    ['complaints', 'example-review']
  );
});

test('resolveCaseSourcesFromCaseTypes: an Adviser reaches only the Case lists their groups open', () => {
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
  const slugsFor = (/** @type {string[]} */ held) =>
    sourcesFor(['CoraUserRoles: Adviser', ...held], caseTypes).map(
      (source) => source.slug
    );

  assert.deepEqual(slugsFor([]), [], 'no group, no list');
  assert.deepEqual(slugsFor(['Cases - Complaints Write']), ['complaints']);
  assert.deepEqual(slugsFor(['Cases - Example Review Read']), [
    'example-review',
  ]);
  for (const everyList of ['CORA All Cases Read', 'CORA All Cases Write']) {
    assert.deepEqual(
      slugsFor([everyList]),
      ['complaints', 'example-review'],
      everyList
    );
  }
  assert.deepEqual(
    slugsFor(['Frontline', 'Frontline - Complaints']),
    [],
    'the retired frontline groups open nothing'
  );
});

test('resolveCaseSourcesFromCaseTypes: a Case list group opens no source without the Adviser role', () => {
  const caseTypes = [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      displayName: 'Complaints',
      config: minimalConfig(),
    },
  ];
  assert.deepEqual(
    sourcesFor(['Cases - Complaints Write', 'CORA All Cases Read'], caseTypes),
    []
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
    sourcesFor(['CoraUserRoles: ResponsiblePartyManager'], caseTypes).map(
      (source) => source.slug
    ),
    ['complaints', 'example-review']
  );
});

// ===== the caseSources half of resolveAppCaseSources =====

test('resolveAppCaseSources: the bare Reviewer flag alone grants no Case source', async () => {
  // Being a Reviewer is what you can do; which Case Types you review is which
  // lists you work, and only a Case Type in the row's Reviews column crosses
  // from one to the other. What is worth pinning is that no Case Type opens
  // itself to every Reviewer.
  const sources = await caseSourcesFor(['CoraUserRoles: Reviewer']);
  assert.deepEqual(
    sources.map((s) => s.slug),
    [],
    'no registered Case Type may grant itself to every Reviewer'
  );
});

test('resolveAppCaseSources: example-review source carries its declared listName and displayName', async () => {
  const sources = await caseSourcesFor([
    'CoraUserRoles: Reviews = example-review',
  ]);
  const exampleReview = sources.find((s) => s.slug === 'example-review');
  assert.deepEqual(exampleReview, {
    slug: 'example-review',
    listName: 'Cases-ExampleReview',
    displayName: 'Example Review',
    // The end-to-end proof of the projection: this fixture declares diverging
    // cadence thresholds and the three dashboard ones reach the source.
    actionCentreSlaDays: { awaitingFrontline: 30 },
    breachWindowHours: 48,
    reviewSlaWorkingDays: 8,
  });
});

test('resolveAppCaseSources: a Reviewer of Complaints is granted the complaints source', async () => {
  const sources = await caseSourcesFor(['CoraUserRoles: Reviews = complaints']);
  assert.deepEqual(sources, [
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      displayName: 'Complaints',
    },
  ]);
});

test('resolveAppCaseSources: Reviewer Managers are granted every manifest Case Type as a source', async () => {
  const sources = await caseSourcesFor(['CoraUserRoles: ReviewerManager']);
  assert.deepEqual(
    sources.map((s) => s.slug).sort(),
    Object.keys(CASE_TYPE_IMPORTERS).sort()
  );
});

test('resolveAppCaseSources: Maintainers can sample Cases from every Question Bank source', async () => {
  const sources = await caseSourcesFor([permissions.maintainer]);
  assert.deepEqual(
    sources.map((s) => s.slug).sort(),
    Object.keys(CASE_TYPE_IMPORTERS).sort()
  );
});

test('resolveCaseSourcesFromCaseTypes: the Maintainer group spans every source, and no other group grants one', () => {
  const source = {
    slug: 'example-review',
    listName: 'Cases-ExampleReview',
    displayName: 'Example Review',
    config: minimalConfig(),
  };
  assert.equal(
    resolveCaseSourcesFromCaseTypes([permissions.maintainer], [source]).length,
    1
  );
  // The groups that used to hold a role, and the ones that open its list now:
  // groups only open lists, so none of them grants a source on its own.
  for (const group of [
    'Reviewers - Example Review',
    'CaseTypeOwner - Example Review',
    'JourneyOwner - Example Review',
    'Frontline - Example Review',
    'Reviewer Managers',
    'Controls',
    'Frontline',
    'ResponsibleParty-Managers',
    'Cases - Example Review Write',
    'CORA All Cases Write',
  ]) {
    assert.deepEqual(
      resolveCaseSourcesFromCaseTypes([group], [source]),
      [],
      group
    );
  }
});
test('resolveAppCaseSources: complaints carries its explicit Case list', async () => {
  const sources = await caseSourcesFor(['CoraUserRoles: ReviewerManager']);
  const complaints = sources.find((s) => s.slug === 'complaints');
  assert.equal(complaints?.listName, 'Cases-Complaints');
});

test('resolveAppCaseSources: returns no sources when the user holds no role', async () => {
  const sources = await caseSourcesFor(['SomeOtherGroup']);
  assert.deepEqual(sources, []);
});

test('resolveAppCaseSources: threads only a Case Type Owner eligible source to app surfaces', async () => {
  const context = await quietlyResolveAppCaseSources(
    ['CoraUserRoles: OwnsCaseTypes = complaints'],
    []
  );

  assert.deepEqual(
    context.caseSources.map((source) => source.slug),
    ['complaints']
  );
  assert.deepEqual(context.journeyCaseSources, []);
  assert.deepEqual(context.unavailableCaseTypes, []);
});

// ===== each column of the CoraUserRoles row =====

test('resolveCaseSourcesFromCaseTypes: a Case Type in any per-type column of the roles row grants its source', () => {
  const caseTypes = [
    {
      slug: 'stress-review',
      listName: 'Cases-StressReview',
      displayName: 'Stress Review',
      config: minimalConfig(),
    },
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      displayName: 'Complaints',
      config: minimalConfig(),
    },
  ];
  for (const column of /** @type {const} */ ([
    'reviews',
    'ownsCaseTypes',
    'journeyOwnerOf',
  ])) {
    const sources = resolveCaseSourcesFromCaseTypes([], caseTypes, {
      ...noRoles(),
      [column]: ['stress-review'],
    });
    assert.deepEqual(
      sources.map((source) => source.slug),
      ['stress-review'],
      column
    );
  }
});

test('resolveCaseSourcesFromCaseTypes: each broad role in the roles row spans every source', () => {
  const caseTypes = [
    {
      slug: 'stress-review',
      listName: 'Cases-StressReview',
      displayName: 'Stress Review',
      config: minimalConfig(),
    },
    {
      slug: 'complaints',
      listName: 'Cases-Complaints',
      displayName: 'Complaints',
      config: minimalConfig(),
    },
  ];
  for (const flag of /** @type {const} */ ([
    'reviewerManager',
    'controls',
    'responsiblePartyManager',
  ])) {
    assert.equal(
      resolveCaseSourcesFromCaseTypes([], caseTypes, {
        ...noRoles(),
        [flag]: true,
      }).length,
      2,
      flag
    );
  }
});

test('resolveCaseSourcesFromCaseTypes: the bare Reviewer column grants no Case source', () => {
  const sources = resolveCaseSourcesFromCaseTypes(
    [],
    [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
        config: minimalConfig(),
      },
    ],
    { ...noRoles(), reviewer: true }
  );
  assert.deepEqual(sources, []);
});

test('resolveAppCaseSources: the roles row reaches the sources handed to app surfaces', async () => {
  const context = await quietlyResolveAppCaseSources([], ['complaints'], {
    userRoles: { ...noRoles(), journeyOwnerOf: ['complaints'] },
  });
  assert.deepEqual(
    context.caseSources.map((source) => source.slug),
    ['complaints']
  );
  assert.deepEqual(
    context.journeyCaseSources.map((source) => source.slug),
    ['complaints']
  );
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
 * `resolveAppCaseSources`, and its Case-source half, with the console captured.
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
  const { groups, roles } = holding(userGroups);
  const { result } = await captureConsoleError(() =>
    resolveAppCaseSources(groups, ownedJourneyCaseTypes, {
      userRoles: roles,
      ...options,
    })
  );
  return result;
}

/**
 * @param {Parameters<typeof caseSourcesFor>[0]} userGroups
 * @param {Parameters<typeof caseSourcesFor>[1]} [options]
 * @returns {ReturnType<typeof caseSourcesFor>}
 */
async function quietlyResolveCaseSources(userGroups, options) {
  const { result } = await captureConsoleError(() =>
    caseSourcesFor(userGroups, options)
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
    resolveAppCaseSources([], [], {
      userRoles: holding(['CoraUserRoles: ReviewerManager']).roles,
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
    caseSourcesFor([], {
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
    await quietlyResolveAppCaseSources(['CoraUserRoles: ReviewerManager'], [], {
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
      await quietlyResolveAppCaseSources(
        ['CoraUserRoles: ReviewerManager'],
        [],
        {
          importers: /** @type {any} */ ({
            'example-review': async () => ({
              default: minimalConfig({ listName }),
            }),
          }),
        }
      );

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
    await quietlyResolveAppCaseSources(['CoraUserRoles: ReviewerManager'], [], {
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
    [
      'CoraUserRoles: ReviewerManager',
      'CoraUserRoles: Reviews = example-review',
    ],
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
    allocationSourcesFromCaseSources(context.caseSources, [
      'example-review',
      'complaints',
    ]).map((s) => s.slug),
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

test('resolveAppCaseSources: a user whose only Case Type is broken gets an empty list, not a crash', async () => {
  const sources = await quietlyResolveCaseSources(
    ['CoraUserRoles: Reviews = example-review'],
    {
      importers: importersWithBrokenExampleReview(),
    }
  );

  assert.deepEqual(sources, []);
});
