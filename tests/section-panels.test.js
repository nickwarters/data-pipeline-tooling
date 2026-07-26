// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { SECTION_REGISTRY, tabEntries } from '../src/lib/section-registry.js';

installDom();

const { SECTION_PANELS } =
  await import('../src/pages/cora-case-review/section-panels.js');

/**
 * The point of the panel map (#512): the Case Review render loop no longer
 * branches on Section id, so a Section added to the registry with no panel used
 * to be invisible — it got a tab and an empty panel. These two assertions are
 * the replacement for that branch chain's implicit exhaustiveness.
 */

test('every tab Section has a panel renderer', () => {
  assert.deepEqual(
    tabEntries()
      .map((entry) => entry.id)
      .sort(),
    Object.keys(SECTION_PANELS).sort()
  );
});

test('adding a tab Section without a panel breaks the correspondence', () => {
  const withNewSection = [
    ...SECTION_REGISTRY,
    {
      id: /** @type {any} */ ('reworkedThing'),
      tab: true,
      tabOrder: 10,
      summaryBlock: false,
      summaryOrder: 0,
      showInSummaryDefault: true,
    },
  ];
  const ids = tabEntries(withNewSection)
    .map((entry) => entry.id)
    .sort();
  assert.notDeepEqual(ids, Object.keys(SECTION_PANELS).sort());
  assert.equal(
    ids.filter((id) => !(id in SECTION_PANELS)).join(),
    'reworkedThing'
  );
});

test('conversation is not a panel — it is a floating overlay', () => {
  assert.equal('conversation' in SECTION_PANELS, false);
});

test('every panel renderer is a function of one context object', () => {
  for (const [id, render] of Object.entries(SECTION_PANELS)) {
    assert.equal(typeof render, 'function', `${id} renderer`);
    assert.equal(render.length, 1, `${id} renderer arity`);
  }
});
