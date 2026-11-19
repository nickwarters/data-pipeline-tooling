// @ts-check
// One display name, and roles that do not hang on it.
//
// A Case Type's display name composes the SharePoint groups that open its Case
// list (`Cases - X Read`, `Cases - X Write`). A person's roles on it are held in
// their `CoraUserRoles` row by the Case Type's slug. Two independent consumers
// read those roles:
//
//   1. `permissions.caseTypes` / `resolveCapabilities()` — the capability side
//   2. `resolveAppCaseSources()` — the Case-source eligibility side
//
// They used to derive group names from different copies of the display name,
// so drift made a user resolve the capability but not the source, or the
// reverse. This test renames the registry entry and asserts that the display
// name moves everywhere it is read, and that neither consumer's answer about a
// person moves with it, because both key the person's roles by slug.
//
// Every import below is static. `permissions.caseTypes` is derived ON READ from
// the live registry, so no ordering workaround is needed: a rename (or a late
// `registerCaseType`) is seen by both consumers whenever it happens.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { CASE_TYPES, registerCaseType } from '../case-types/manifest.js';
import {
  permissions,
  resolveCapabilities,
} from '../src/services/permissions.js';
import { planGrant } from '../src/services/access-roles.js';
import { caseSourcesFor, holding } from './_case-sources-for.js';

/** @typedef {import('../case-types/manifest.js').CaseTypeEntry} CaseTypeEntry */

// Registry entries are frozen, so a rename REPLACES the entry rather than
// mutating it in place — and the original is put back afterwards. Leaving a
// renamed production Case Type behind would only be invisible because
// `node --test` gives each file its own process.
const registry = /** @type {CaseTypeEntry[]} */ (CASE_TYPES);
const index = registry.findIndex((entry) => entry.slug === 'complaints');
assert.ok(index >= 0, 'the complaints Case Type must be registered');
const ORIGINAL = registry[index];
const RENAMED = 'Renamed Complaints';
registry[index] = Object.freeze({ ...ORIGINAL, displayName: RENAMED });
after(() => {
  registry[index] = ORIGINAL;
});

const REVIEWS = 'CoraUserRoles: Reviews = complaints';
const OWNS = 'CoraUserRoles: OwnsCaseTypes = complaints';
const JOURNEY = 'CoraUserRoles: JourneyOwnerOf = complaints';

test('registry rename: permissions.caseTypes moves with the registry display name', () => {
  assert.deepEqual(
    permissions.caseTypes.find((c) => c.slug === 'complaints'),
    { slug: 'complaints', displayName: RENAMED },
    'permissions.caseTypes projects CASE_TYPES, so it must carry the renamed ' +
      'display name — not a second copy from the Case Type config module.'
  );
});

test('registry rename: the roles a person holds do not move, because the row names the slug', async () => {
  const { groups, roles } = holding([REVIEWS, OWNS, JOURNEY]);
  const capabilities = resolveCapabilities(groups, permissions, roles);
  assert.deepEqual(capabilities.listAccessCaseTypes, ['complaints']);
  assert.deepEqual(capabilities.ownedCaseTypes, ['complaints']);
  assert.deepEqual(capabilities.ownedJourneyCaseTypes, ['complaints']);

  for (const entry of [REVIEWS, OWNS, JOURNEY]) {
    assert.deepEqual(
      (await caseSourcesFor([entry])).map((s) => s.slug),
      ['complaints'],
      `${entry} must resolve the complaints source however it is displayed`
    );
  }
});

test('registry rename: the Case list group a role is given moves with the display name', () => {
  const { groups } = planGrant(
    { id: 'reviewer', caseType: 'complaints' },
    [],
    permissions.caseTypes
  );
  assert.ok(groups.includes(`Cases - ${RENAMED} Write`), String(groups));
  assert.ok(
    !groups.includes(`Cases - ${ORIGINAL.displayName} Write`),
    'nothing may still derive a group from the old display name'
  );
});

test('registry rename: the resolved Case source reports the registry display name', async () => {
  const [source] = await caseSourcesFor([REVIEWS]);
  assert.equal(
    source?.displayName,
    RENAMED,
    'CaseSource.displayName is the registry name, not a config copy'
  );
});

test('a Case Type registered AFTER permissions.js was evaluated reaches BOTH consumers', async () => {
  // The regression this file exists to prevent, in its sharpest form.
  // `permissions.caseTypes` used to be a module-scope snapshot of `CASE_TYPES`,
  // so anything registered later was invisible to the capability side while
  // the eligibility side saw it: a user the capability layer called a Visitor
  // was simultaneously granted that Case Type's source.
  registerCaseType({
    slug: 'late-single-source',
    displayName: 'Late Single Source',
    importer: async () => ({
      default: /** @type {any} */ ({
        listName: 'Cases-LateSingleSource',
        questions: [],
        outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
        defaultOutcomeId: 'pass',
      }),
    }),
  });

  const late = 'CoraUserRoles: Reviews = late-single-source';
  const { groups, roles } = holding([late]);
  const capabilities = resolveCapabilities(groups, permissions, roles);
  assert.deepEqual(
    capabilities.listAccessCaseTypes,
    ['late-single-source'],
    'the capability side must read the live registry, not a boot-time snapshot'
  );
  assert.equal(capabilities.isReviewer, true, 'list access implies Reviewer');
  assert.equal(
    capabilities.isVisitor,
    false,
    'a user granted a Case source is never simultaneously a Visitor'
  );

  const sources = await caseSourcesFor([late]);
  assert.deepEqual(
    sources.map((s) => s.slug),
    ['late-single-source'],
    'and the eligibility side must agree with it'
  );
});
