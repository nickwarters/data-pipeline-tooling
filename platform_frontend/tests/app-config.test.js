// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import { APP_CONFIG } from '../src/app-config.js';
import { sectionIds } from '../src/sections/registry.js';
import { configureAppSections } from './helpers/configure-sections.js';

installDom();
configureAppSections();

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
  'secondReview',
  'summary',
];

test('APP_CONFIG composes the Sections this application has', () => {
  assert.deepEqual(
    APP_CONFIG.sectionPlugins.map((plugin) => plugin.id).sort(),
    COMPOSED_SECTION_IDS
  );
});

test('the engine runs on the list the composition root hands it', () => {
  // The engine has no list of its own, so this is the composed list coming
  // back out — the same round trip boot makes.
  assert.deepEqual([...sectionIds()].sort(), COMPOSED_SECTION_IDS);
});

test('a Case Type keyed by a Section nothing composes is a compile error', () => {
  // The property the composition root buys over an application-owned second
  // registry: `sections` stays `Partial<Record<Section, …>>`, so a mistyped key
  // is caught by tsc rather than deferred to `verify-config`.
  /** @type {import('../src/sharepoint-client.js').CaseTypeConfig['sections']} */
  const sections = {
    summary: {},
    // @ts-expect-error 'summaryX' is not a Section this application composes.
    // If this directive reports itself unused, `sections` has widened to
    // `Record<string, SectionConfig>` and Case Type keys are unchecked.
    summaryX: {},
  };

  assert.deepEqual(Object.keys(sections ?? {}), ['summary', 'summaryX']);
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

// --- The page half of the composition ---

test('every page entry carries exactly one of `page` and `load`', () => {
  // The contract cannot say "exactly one of", and the router adapter throws on
  // anything else — a mis-shaped entry is a route that cannot mount, which is
  // worth one named line here rather than a console error the first time
  // somebody navigates there.
  for (const plugin of APP_CONFIG.pagePlugins) {
    assert.equal(
      Boolean(plugin.page) !== Boolean(plugin.load),
      true,
      `page "${plugin.id}" must declare a page or a load thunk, never both and never neither`
    );
  }
});

test('every page entry declares at least one path, and a nav item ranks itself', () => {
  for (const plugin of APP_CONFIG.pagePlugins) {
    assert.ok(plugin.paths.length > 0, `page "${plugin.id}" declares no paths`);
    if (plugin.nav) {
      assert.equal(
        typeof plugin.nav.order,
        'number',
        `page "${plugin.id}" has a nav item with no order`
      );
    }
    // `defaultForOrder` is what settles a user two rules both match, so a rule
    // without one would rank as 0 and tie with anything else that forgot.
    if (plugin.defaultFor) {
      assert.equal(
        typeof plugin.defaultForOrder,
        'number',
        `page "${plugin.id}" is a landing rule with no defaultForOrder`
      );
    }
  }
});
