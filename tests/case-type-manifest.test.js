// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CASE_TYPES,
  CASE_TYPE_IMPORTERS,
  QUESTION_BANK_IMPORTERS,
  DuplicateCaseTypeError,
  UnknownCaseTypeError,
  displayNameFor,
  loadCaseTypeConfig,
  registerCaseType,
} from '../case-types/manifest.js';
import { CaseReviewViewModel } from '../src/lib/case-review-view-model.js';
import { validateCaptureGroups } from '../src/evaluators/issue-capture.js';
import {
  validateGeneralQuestions,
  validateAnswerKeyNamespace,
} from '../src/evaluators/general-questions.js';

/**
 * The three assertions below pin today's registry as a CLOSED set: they name
 * `complaints` literally, because `UnknownCaseTypeError` puts the known slugs in
 * a message a developer reads. A new Case Type is therefore SUPPOSED to move
 * them — which, to someone who has just run the scaffold, looks identical to
 * having broken something. Say so in the failure itself; the scaffold's closing
 * message names these same three tests.
 */
const SCAFFOLD_NOTE =
  'EXPECTED FAILURE if you have just run scripts/scaffold_case_type.py — you ' +
  'have not broken anything. This is a contract test over the Case Type ' +
  'registry (case-types/manifest.js) and it pins the known slugs as a closed ' +
  'set, so registering a Case Type legitimately moves it. Add your new slug to ' +
  'the expected list here and in the two sibling assertions in this file. If ' +
  'you have NOT just scaffolded a Case Type, this is a real failure: a slug ' +
  'has appeared in or vanished from the registry.';

test('case type manifest: known Case Type slugs resolve to their static import functions', async () => {
  const knownSlugs = ['complaints'];
  assert.deepEqual(
    Object.keys(CASE_TYPE_IMPORTERS).sort(),
    knownSlugs,
    SCAFFOLD_NOTE
  );

  for (const slug of knownSlugs) {
    assert.equal(typeof CASE_TYPE_IMPORTERS[slug], 'function');
    const config = await loadCaseTypeConfig(slug);
    assert.ok(Array.isArray(config.questions), `${slug} has questions`);
  }
});

test('case type manifest: CASE_TYPES is the single registry every derived map comes from (#508)', () => {
  assert.ok(Array.isArray(CASE_TYPES) && CASE_TYPES.length > 0);

  for (const entry of CASE_TYPES) {
    assert.equal(typeof entry.slug, 'string');
    assert.ok(entry.slug.length > 0, 'each entry declares a slug');
    assert.equal(typeof entry.displayName, 'string');
    assert.ok(
      entry.displayName.length > 0,
      `${entry.slug} declares a display name`
    );
    assert.equal(
      CASE_TYPE_IMPORTERS[entry.slug],
      entry.importer,
      `CASE_TYPE_IMPORTERS["${entry.slug}"] must be the registry entry's importer`
    );
    if (entry.bank) {
      assert.equal(
        QUESTION_BANK_IMPORTERS[entry.slug],
        entry.bank,
        `QUESTION_BANK_IMPORTERS["${entry.slug}"] must be the registry entry's bank importer`
      );
    }
  }

  assert.deepEqual(
    Object.keys(CASE_TYPE_IMPORTERS).sort(),
    CASE_TYPES.map((entry) => entry.slug).sort()
  );
  assert.deepEqual(
    Object.keys(QUESTION_BANK_IMPORTERS).sort(),
    CASE_TYPES.filter((entry) => entry.bank)
      .map((entry) => entry.slug)
      .sort()
  );
});

test('case type manifest: registry entries are frozen, so the one copy of a display name stays one copy (#527)', () => {
  for (const entry of CASE_TYPES) {
    assert.ok(
      Object.isFrozen(entry),
      `${entry.slug}'s registry entry must be frozen — the display name it ` +
        'carries composes three SharePoint group names, and both the ' +
        'capability and eligibility sides read it'
    );
    assert.throws(
      () => {
        /** @type {any} */ (entry).displayName = 'Mutated In Place';
      },
      TypeError,
      `${entry.slug}'s display name must not be mutable in place`
    );
  }
});

test('case type manifest: importing the manifest evaluates no Case Type module (importers stay thunks)', () => {
  // ADR-0004's lazy-load property, and the constraint that lets the
  // boot-critical, synchronous permissions config read display names from this
  // registry without eagerly loading a single Case Type config (#508, #493).
  for (const entry of CASE_TYPES) {
    assert.equal(
      typeof entry.importer,
      'function',
      `${entry.slug}'s importer must be an un-invoked thunk, not an awaited module`
    );
    assert.ok(
      !(entry.importer instanceof Promise),
      `${entry.slug}'s importer must not be a Promise`
    );
    if (entry.bank) assert.equal(typeof entry.bank, 'function');
  }

  // The thunks are the only path to a Case Type module: no static import of a
  // config or bank artifact may appear in the manifest source.
  const source = readFileSync(
    new URL('../case-types/manifest.js', import.meta.url),
    'utf8'
  );
  const staticSpecifiers = [
    ...source.matchAll(/(?:^|\n)import\s[\s\S]*?from\s+['"]([^'"]+)['"]/g),
  ].map(([, specifier]) => specifier);
  assert.deepEqual(
    staticSpecifiers.sort(),
    ['../src/evaluators/configured-outcome.js', './load-bank.js'],
    'the manifest may statically import only its loader and the outcome validator — every Case Type module is reached through a thunk'
  );
});

test('case type manifest: every registered Case Type module evaluates and passes the load-time gates', async () => {
  // Boot loads *every* registered Case Type (resolve-eligible-case-types.js
  // Promise.all's the whole manifest before eligibility is applied), so a module
  // that throws at evaluation — an unknown shared General Question key, a
  // malformed capture group, a reserved answer-key namespace — costs the whole
  // app its boot, not just its own Case Type. This sweep keeps that failure in
  // CI, and stays true for Case Types added after this test was written.
  const slugs = Object.keys(CASE_TYPE_IMPORTERS);
  assert.ok(slugs.length > 0, 'expected at least one registered Case Type');

  for (const slug of slugs) {
    const config = await loadCaseTypeConfig(slug);
    assert.doesNotThrow(
      () => validateGeneralQuestions(config.generalQuestions),
      `${slug} General Questions`
    );
    assert.doesNotThrow(
      () => validateCaptureGroups(config.captureGroups ?? []),
      `${slug} Issue Capture Groups`
    );
    assert.doesNotThrow(
      () => validateAnswerKeyNamespace(config.questions),
      `${slug} Question Definition ids`
    );
  }
});

test('case type manifest: unknown Case Type slugs reject with a developer-useful error', async () => {
  const slug = '../unexpected';

  // Captured rather than matched with a predicate: a predicate that returns
  // false reports only "the error did not pass the predicate", which tells a
  // developer nothing about which half moved.
  const error = await loadCaseTypeConfig(slug).then(
    () => assert.fail('expected loadCaseTypeConfig to reject'),
    (reason) => reason
  );

  assert.ok(error instanceof UnknownCaseTypeError);
  assert.equal(error.name, 'UnknownCaseTypeError');
  assert.equal(error.slug, slug);
  assert.equal(error.knownSlugs.join(','), 'complaints', SCAFFOLD_NOTE);
  assert.equal(
    error.message,
    `Unsupported Case Type slug "${slug}". Known Case Type slugs: complaints.`,
    SCAFFOLD_NOTE
  );
});

test('case type manifest: displayNameFor returns the registry display name, synchronously and lazily (#527)', () => {
  assert.equal(displayNameFor('complaints'), 'Complaints');

  // Reading a name must not evaluate a Case Type module — permissions and
  // eligibility both read it on the boot path (ADR-0004).
  for (const entry of CASE_TYPES)
    assert.equal(typeof entry.importer, 'function');
});

test('case type manifest: displayNameFor fails loudly for an unregistered slug (#527)', () => {
  assert.throws(
    () => displayNameFor('../unexpected'),
    (error) =>
      error instanceof UnknownCaseTypeError &&
      error.slug === '../unexpected' &&
      error.knownSlugs.includes('complaints'),
    'an absent display name must throw, never silently yield nothing — that ' +
      'is how a Case Type became invisible to its own Reviewers'
  );
});

test('case type manifest: registerCaseType keeps the derived maps in step with the registry (#527)', () => {
  const importer = async () => ({ default: /** @type {any} */ ({}) });
  const bank = async () => ({ default: /** @type {any} */ ({}) });
  registerCaseType({
    slug: 'late-registered',
    displayName: 'Late Registered',
    importer,
    bank,
  });

  try {
    assert.equal(displayNameFor('late-registered'), 'Late Registered');
    assert.equal(CASE_TYPE_IMPORTERS['late-registered'], importer);
    assert.equal(QUESTION_BANK_IMPORTERS['late-registered'], bank);
    assert.ok(
      CASE_TYPES.some((entry) => entry.slug === 'late-registered'),
      'registration lands on the registry itself, not only on the derived maps'
    );
  } finally {
    const index = CASE_TYPES.findIndex((e) => e.slug === 'late-registered');
    /** @type {import('../case-types/manifest.js').CaseTypeEntry[]} */ (
      CASE_TYPES
    ).splice(index, 1);
    delete CASE_TYPE_IMPORTERS['late-registered'];
    delete QUESTION_BANK_IMPORTERS['late-registered'];
  }
});

test('case type manifest: registerCaseType rejects a duplicate slug (#527)', () => {
  // A second entry for a live slug is the divergence #527 exists to prevent,
  // in its most dangerous form: `displayNameFor` reads the FIRST row,
  // `CASE_TYPE_IMPORTERS` takes the LAST, and `permissions.caseTypes` carries
  // BOTH. A never-provisioned `Reviewers - <second display name>` group then
  // grants list access to the original slug, bound to a substituted importer
  // that can point at a different SharePoint list.
  const before = CASE_TYPES.length;
  assert.throws(
    () =>
      registerCaseType({
        slug: 'complaints',
        displayName: 'Complaints v2',
        importer: async () => ({
          default: /** @type {any} */ ({ listName: 'Cases-Evil' }),
        }),
      }),
    (error) =>
      error instanceof DuplicateCaseTypeError &&
      error.slug === 'complaints' &&
      /already registered/.test(error.message)
  );

  assert.equal(CASE_TYPES.length, before, 'the rejected entry never lands');
  assert.equal(displayNameFor('complaints'), 'Complaints');
  assert.equal(
    CASE_TYPE_IMPORTERS['complaints'],
    CASE_TYPES.find((entry) => entry.slug === 'complaints')?.importer,
    'the original importer must not be substituted'
  );
});

test('case type manifest: registerCaseType rejects an entry that cannot compose group names (#527)', () => {
  // An unvalidated entry reaches `caseTypeGroupNames(undefined)` and provisions
  // `Reviewers - undefined` — a group name that grants a real Case source and
  // that somebody could actually be put in.
  const before = CASE_TYPES.length;
  const importer = async () => ({ default: /** @type {any} */ ({}) });

  for (const [entry, why] of [
    [{ displayName: 'No Slug', importer }, 'a missing slug'],
    [{ slug: '', displayName: 'Blank Slug', importer }, 'a blank slug'],
    [{ slug: 'no-name', importer }, 'a missing display name'],
    [{ slug: 'blank-name', displayName: '   ', importer }, 'a blank name'],
    [{ slug: 'no-importer', displayName: 'No Importer' }, 'no importer'],
  ]) {
    assert.throws(
      () => registerCaseType(/** @type {any} */ (entry)),
      TypeError,
      `registerCaseType must reject ${why}`
    );
  }

  assert.equal(CASE_TYPES.length, before, 'no partial entry lands');
});

test('case type manifest: rejects invalid outcome configuration before a Case Type is used', async () => {
  const baseConfig = {
    questions: [],
    computeOutcome: () => ({ outcome: 'pass' }),
    outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
    defaultOutcomeId: 'pass',
  };
  const cases = [
    {
      config: { ...baseConfig, questions: undefined },
      message: /Case Type "invalid".*questions must be an array/,
    },
    {
      config: { ...baseConfig, outcomeOptions: [] },
      message: /Case Type "invalid".*outcomeOptions/,
    },
    {
      config: { ...baseConfig, defaultOutcomeId: 'ghost' },
      message: /Case Type "invalid".*defaultOutcomeId "ghost"/,
    },
    {
      config: {
        ...baseConfig,
        outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: NaN }],
      },
      message: /Case Type "invalid".*severity/,
    },
    {
      config: {
        ...baseConfig,
        outcomeOptions: [
          { id: 'pass', wording: 'Pass', severity: 0 },
          { id: 'pass', wording: 'Another pass', severity: 50 },
        ],
      },
      message: /Case Type "invalid".*duplicate outcome id "pass"/,
    },
    {
      config: {
        ...baseConfig,
        questions: [
          {
            id: 'q1',
            text: 'Q1',
            responseType: 'single-choice',
            optionOutcomes: { No: 'ghost' },
            deprecated: false,
          },
        ],
      },
      message: /Case Type "invalid".*unknown outcome id "ghost"/,
    },
  ];

  for (const { config, message } of cases) {
    await assert.rejects(
      loadCaseTypeConfig('invalid', {
        invalid: async () => ({ default: /** @type {any} */ (config) }),
      }),
      message
    );
  }
});

test('CaseReviewViewModel.load(): unknown primary Case Type slug sets a clear user-facing error state', async () => {
  /** @type {any[]} */
  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => errors.push(args);

  try {
    const vm = new CaseReviewViewModel({
      client: /** @type {any} */ ({
        getCase: async () => ({
          id: 'c1',
          caseType: '../unexpected',
          title: 'T',
          status: 'In-progress',
          assignedReviewer: 'u1',
          responsibleParty: 'u2',
          answers: {},
          conversation: [],
          notes: '',
          completedAt: null,
          etag: 'e1',
        }),
        getCurrentUser: async () => ({ id: 'u1', displayName: 'User 1' }),
        getExportHash: async () => null,
        resolveUsers: async () => ({}),
      }),
      saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
      caseId: 'c1',
      currentUserId: 'u1',
      capabilities: null,
    });

    await vm.load();

    assert.equal(
      vm.error,
      'This Case cannot be opened because its Case Type is not supported. Ask a maintainer to add "../unexpected" to the Case Type manifest.'
    );
    assert.equal(vm.loaded, false);
    assert.equal(vm.config, null);
    assert.equal(errors.length, 1);
    assert.ok(errors[0][0] instanceof UnknownCaseTypeError);
    assert.equal(errors[0][0].slug, '../unexpected');
    assert.deepEqual(errors[0][0].knownSlugs, ['complaints'], SCAFFOLD_NOTE);
  } finally {
    console.error = originalConsoleError;
  }
});

test('CaseReviewViewModel.load(): invalid Case Type outcome configuration sets a clear user-facing error state', async () => {
  const slug = 'invalid-outcome-config';
  const originalConsoleError = console.error;
  console.error = () => {};
  CASE_TYPE_IMPORTERS[slug] = async () => ({
    default: /** @type {any} */ ({
      questions: [],
      computeOutcome: () => ({ outcome: 'pass' }),
      outcomeOptions: [],
      defaultOutcomeId: 'pass',
    }),
  });

  try {
    const vm = new CaseReviewViewModel({
      client: /** @type {any} */ ({
        getCase: async () => null,
        getCurrentUser: async () => ({ id: 'u1', displayName: 'User 1' }),
      }),
      saveQueue: /** @type {any} */ ({ loadCase: () => {}, enqueue: () => {} }),
      caseId: 'c1',
      currentUserId: 'u1',
      capabilities: null,
      caseType: slug,
    });

    await vm.load();

    assert.equal(
      vm.error,
      'This Case cannot be opened because its Case Type outcome configuration is invalid. Ask a maintainer to correct it.'
    );
    assert.equal(vm.loaded, false);
    assert.equal(vm.config, null);
  } finally {
    delete CASE_TYPE_IMPORTERS[slug];
    console.error = originalConsoleError;
  }
});
