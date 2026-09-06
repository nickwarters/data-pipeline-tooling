// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { installDom } from './_dom-stub.js';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import { makeLoader } from './helpers/case-loader.js';
import { configureAppSections } from './helpers/configure-sections.js';
import { APP_CONFIG } from '../src/app-config.js';
import {
  evaluateSectionsAccess,
  getSectionPlugin,
  getSectionPlugins,
} from '../src/sections/registry.js';
import { ROLES } from '../src/services/section-access.js';
import { checkCaseTypes } from '../scripts/verify-config.js';
import complaintsConfig from '../case-types/complaints.js';

installDom();
configureAppSections();
isolateBrowserGlobals();

// Capability: a Section the library never names is a Section like any other.
//
// Second Review is composed by `src/app-config.js` and nothing else. These
// tests are the proof that the composition root delivered what it claimed:
// the engine gained no line for it, and it is in the id union, the build gate,
// the tab order and the access matrix all the same.

/** @param {any} [overrides] @returns {any} */
function demoConfig(overrides = {}) {
  return {
    listName: 'Cases-Demo',
    questions: [],
    computeOutcome: () => 'good',
    outcomeOptions: [{ id: 'good', wording: 'Good', severity: 0 }],
    defaultOutcomeId: 'good',
    ...overrides,
  };
}

/** @param {any} config @returns {any} */
function demoEntry(config) {
  return {
    slug: 'demo',
    displayName: 'Demo',
    importer: async () => ({ default: config }),
  };
}

// --- 1. The engine gained nothing ---

test('the Section engine names no plugin, so adding one does not touch it', () => {
  const engine = readFileSync(
    new URL('../src/sections/registry.js', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(
    engine,
    /-plugin\.js'/,
    'the engine imports no Section module'
  );
  assert.doesNotMatch(
    engine,
    /secondReview/,
    'and does not name this one anywhere'
  );
});

test('the composition root is the only module that names it', () => {
  assert.ok(
    APP_CONFIG.sectionPlugins.some((plugin) => plugin.id === 'secondReview')
  );
  assert.equal(getSectionPlugin('secondReview')?.id, 'secondReview');
});

// --- 2. It is in the Section id union ---

test('a Case Type may key `sections` by it, and a typo is a compile error', () => {
  /** @type {import('../src/sharepoint-client.js').CaseTypeConfig['sections']} */
  const sections = {
    summary: {},
    secondReview: {},
    // @ts-expect-error 'secondReviewX' is not a Section this application
    // composes. This is the property the rejected application-owned second
    // registry could not provide: it would have forced `sections` to widen to
    // `Record<string, SectionConfig>` and moved this check to runtime.
    secondReviewX: {},
  };

  assert.deepEqual(Object.keys(sections ?? {}), [
    'summary',
    'secondReview',
    'secondReviewX',
  ]);
});

test('the Case Type that composes it declares it', () => {
  assert.ok(
    Object.hasOwn(complaintsConfig.sections ?? {}, 'secondReview'),
    'complaints declares the Section, which is what puts it in that Case Type'
  );
});

// --- 3. The build gate rejects the typo too ---

test('verify-config rejects a Section key nothing composes', async () => {
  const accepted = await checkCaseTypes({
    caseTypes: [
      demoEntry(demoConfig({ sections: { summary: {}, secondReview: {} } })),
    ],
  });
  assert.deepEqual(accepted, [], 'the composed id passes the gate');

  const rejected = await checkCaseTypes({
    caseTypes: [
      demoEntry(demoConfig({ sections: { summary: {}, secondReviewX: {} } })),
    ],
  });
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].message, /secondReviewX/);
});

// --- 4. Its fractional order slots it between Questions and Issues ---

test('the tab order places it between Questions and Issues, renumbering neither', () => {
  const tabs = getSectionPlugins()
    .filter((plugin) => plugin.tab)
    .sort((a, b) => a.tabOrder - b.tabOrder)
    .map((plugin) => plugin.id);

  assert.deepEqual(tabs, [
    'details',
    'questions',
    'secondReview',
    'issues',
    'summary',
    'remediation',
    'notes',
    'appealRequest',
    'appealReview',
    'amendOutcome',
  ]);
  assert.equal(getSectionPlugin('questions')?.tabOrder, 2);
  assert.equal(getSectionPlugin('issues')?.tabOrder, 3);
});

// --- 5. Access still gates it ---

test('it is hidden for every role, whether or not the Case Type declares it', () => {
  const caseRow = /** @type {any} */ ({ status: 'In-progress' });

  for (const role of ROLES) {
    const declared = evaluateSectionsAccess({
      caseRow,
      roles: [role],
      config: /** @type {any} */ ({ sections: { secondReview: {} } }),
    });
    assert.equal(declared.secondReview, 'hidden', `declared × ${role}`);

    const omitted = evaluateSectionsAccess({
      caseRow,
      roles: [role],
      config: /** @type {any} */ ({ sections: { summary: {} } }),
    });
    assert.equal(omitted.secondReview, 'hidden', `omitted × ${role}`);
  }
});

test('its view renders nothing while it is a stub', () => {
  // Nothing reaches it — access is `hidden` everywhere — but a Section that
  // returned a half-built panel the day someone widened access would be worse
  // than one that returns nothing, so the stub says so out loud.
  assert.equal(
    getSectionPlugin('secondReview')?.view(/** @type {any} */ ({})),
    null
  );
});

test('a Section hidden for everyone does not deny access to the Case', async () => {
  // `case-loader.js` denies a Case when EVERY Section is hidden, which is
  // vacuously true over an empty list. A Section that is hidden for everyone
  // cannot turn that guard on — asserted rather than reasoned about, because
  // the equivalent asymmetry with the old Admin Details Section produced an
  // access-denied page for the one role its Section was built for.
  const loader = makeLoader();
  await loader.load();

  assert.equal(loader.accessDenied, false);
  assert.equal(loader.access.secondReview, 'hidden');
  assert.ok(
    Object.values(loader.access).some((mode) => mode !== 'hidden'),
    'the Assigned Reviewer still sees something'
  );
});
