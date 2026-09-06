// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import { APP_CONFIG } from '../src/app-config.js';
import { sectionIds } from '../src/sections/registry.js';

installDom();

// Capability: the composition root names what this application is made of, and
// the Section id union is projected from that naming rather than restated.

/** The Sections this application composes, as a set — the array order carries
 * no meaning, so nothing here asserts one. */
const COMPOSED_SECTION_IDS = [
  'amendOutcome',
  'appealRequest',
  'appealReview',
  'conversation',
  'details',
  'issues',
  'notes',
  'questions',
  'remediation',
  'summary',
];

test('APP_CONFIG composes the ten Sections this application has', () => {
  assert.deepEqual(
    APP_CONFIG.sectionPlugins.map((plugin) => plugin.id).sort(),
    COMPOSED_SECTION_IDS
  );
});

test('the composition root and the engine still name the same Sections', () => {
  // Two lists exist for exactly as long as it takes boot to start handing the
  // engine the composed one. Nothing else would notice them drifting apart.
  assert.deepEqual([...sectionIds()].sort(), COMPOSED_SECTION_IDS);
});

test('the Section union rejects an id this application does not compose', () => {
  /** @type {(id: import('../src/app-config.js').Section) => string} */
  const takesSection = (id) => id;

  assert.equal(takesSection('details'), 'details');

  // Nothing here fails at runtime — an unknown id is a `tsc` failure, and this
  // line is where it is provoked. The directive is the assertion: if it ever
  // reports itself unused, the union has widened to `string` and every
  // mistyped Section key has stopped being a compile error.
  // @ts-expect-error 'nope' is not a Section this application composes
  assert.equal(takesSection('nope'), 'nope');
});
