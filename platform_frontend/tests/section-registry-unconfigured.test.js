// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateSectionsAccess,
  getSectionPlugin,
  getSectionPlugins,
  registerSectionPlugin,
  sectionIds,
  summaryBlockIds,
} from '../src/sections/registry.js';

// Capability: an engine nobody has composed refuses to answer.
//
// This file deliberately never configures the engine, and it is a file of its
// own for that reason: the test runner gives each file its own process, so this
// is the only place the module can be observed in the state boot finds it in.

/**
 * Every read, because the failure this guards against is not "one accessor
 * returned nothing" — it is an empty registry answering plausibly. The Case
 * loader asks whether every Section is hidden, which is vacuously true over no
 * Sections, so an empty engine denies access to every Case and renders a blank
 * application with nothing in the console.
 *
 * @type {[string, () => unknown][]}
 */
const READS = [
  ['sectionIds', () => sectionIds()],
  ['getSectionPlugins', () => getSectionPlugins()],
  ['getSectionPlugin', () => getSectionPlugin('details')],
  ['summaryBlockIds', () => summaryBlockIds()],
  [
    'evaluateSectionsAccess',
    () =>
      evaluateSectionsAccess({
        caseRow: /** @type {any} */ ({ status: 'Allocated' }),
        roles: [],
      }),
  ],
];

for (const [name, read] of READS) {
  test(`${name} throws before the engine is configured`, () => {
    assert.throws(read, {
      message: /Sections read before configureSections\(\)/,
    });
  });
}

test('the message says whose job the configuring is', () => {
  assert.throws(() => sectionIds(), /boot must configure the engine/);
});

test('registering onto an unconfigured engine throws rather than seeding it', () => {
  assert.throws(
    () => registerSectionPlugin(/** @type {any} */ ({ id: 'sneaked' })),
    /configureSections/,
    'a registration is an addition to a composition, never a substitute for one'
  );
});
