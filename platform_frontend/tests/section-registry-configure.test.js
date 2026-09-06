// @ts-check
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import {
  configureSections,
  getSectionPlugin,
  resetSectionRegistry,
  sectionIds,
} from '../src/sections/registry.js';

installDom();

// Capability: the composition root tells the Section engine what this
// application is made of, and says so once.

/**
 * A Section that carries nothing but the facts the engine reads off it.
 *
 * @param {string} id
 * @returns {any}
 */
function fakeSection(id) {
  return {
    id,
    tab: true,
    tabOrder: 1,
    summaryBlock: false,
    summaryOrder: 0,
    showInSummaryDefault: false,
    defaultLabels: { tab: id, heading: id },
    evaluateAccess: () => 'hidden',
    view: () => null,
  };
}

afterEach(() => {
  resetSectionRegistry();
});

test('configureSections replaces the registry wholesale', () => {
  configureSections([fakeSection('alpha'), fakeSection('beta')]);

  assert.deepEqual(sectionIds(), ['alpha', 'beta']);
  assert.equal(
    getSectionPlugin('details'),
    undefined,
    'a Section the configured list omits is not in the registry'
  );
});

test('configureSections rejects a duplicate id, and names it', () => {
  assert.throws(
    () =>
      configureSections([
        fakeSection('alpha'),
        fakeSection('beta'),
        fakeSection('alpha'),
      ]),
    /duplicate Section id "alpha"/,
    'a Section listed twice is a mistake in the list, not an override'
  );
});

test('configureSections rejects an entry with no id', () => {
  assert.throws(
    () => configureSections([/** @type {any} */ ({ tab: true })]),
    /every Section needs an id/
  );
});
