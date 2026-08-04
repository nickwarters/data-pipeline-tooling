// @ts-check
// One display name, two consumers.
//
// A Case Type's display name composes the three provisioned SharePoint group
// names (`Reviewers - X`, `CaseTypeOwner - X`, `JourneyOwner - X`). Two
// independent consumers derive them:
//
//   1. `permissions.caseTypes` / `resolveCapabilities()` — the capability side
//   2. `resolveAppCaseSources()` — the Case-source eligibility side
//
// Each used to read a DIFFERENT copy of the name (the registry entry vs the
// Case Type config module), so drift made a user resolve the capability but not
// the source, or the reverse. This test proves there is now exactly ONE copy:
// it renames the registry entry and asserts BOTH consumers move with it.
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
  caseTypeGroupNames,
} from '../src/services/permissions.js';
import { caseSourcesFor } from './_case-sources-for.js';

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

const renamedGroups = caseTypeGroupNames(RENAMED);
const staleGroups = caseTypeGroupNames(ORIGINAL.displayName);

test('registry rename: permissions.caseTypes moves with the registry display name', () => {
  assert.deepEqual(
    permissions.caseTypes.find((c) => c.slug === 'complaints'),
    { slug: 'complaints', displayName: RENAMED },
    'permissions.caseTypes projects CASE_TYPES, so it must carry the renamed ' +
      'display name — not a second copy from the Case Type config module.'
  );
});

test('registry rename: resolveCapabilities derives its group names from the renamed registry entry', () => {
  const renamed = resolveCapabilities([
    renamedGroups.listAccess,
    renamedGroups.caseTypeOwner,
    renamedGroups.journeyOwner,
  ]);
  assert.deepEqual(renamed.listAccessCaseTypes, ['complaints']);
  assert.deepEqual(renamed.ownedCaseTypes, ['complaints']);
  assert.deepEqual(renamed.ownedJourneyCaseTypes, ['complaints']);

  const stale = resolveCapabilities([
    staleGroups.listAccess,
    staleGroups.caseTypeOwner,
    staleGroups.journeyOwner,
  ]);
  assert.deepEqual(stale.listAccessCaseTypes, []);
  assert.deepEqual(stale.ownedCaseTypes, []);
  assert.deepEqual(stale.ownedJourneyCaseTypes, []);
});

test('registry rename: Case source eligibility moves with the registry display name too', async () => {
  const viaListAccess = await caseSourcesFor([renamedGroups.listAccess]);
  assert.deepEqual(
    viaListAccess.map((s) => s.slug),
    ['complaints'],
    'resolveAppCaseSources() must derive `Reviewers - <name>` from the SAME ' +
      'registry entry the capability side reads.'
  );

  for (const group of [renamedGroups.caseTypeOwner, renamedGroups.journeyOwner])
    assert.deepEqual(
      (await caseSourcesFor([group])).map((s) => s.slug),
      ['complaints'],
      `${group} must resolve the complaints source from the registry name`
    );

  // All THREE stale names, list access included. A rename must move the access
  // it granted, or someone left in the decommissioned SharePoint group keeps
  // reaching the Cases. `listAccess` used to be excluded here because the
  // complaints config restated `Reviewers - Complaints` in `eligibleGroups` — a
  // live third copy that kept granting after the rename. That copy is gone.
  for (const group of [
    staleGroups.listAccess,
    staleGroups.caseTypeOwner,
    staleGroups.journeyOwner,
  ])
    assert.deepEqual(
      await caseSourcesFor([group]),
      [],
      `${group} names the OLD display name — nothing may still derive from it`
    );
});

test('registry rename: the resolved Case source reports the registry display name', async () => {
  const [source] = await caseSourcesFor([renamedGroups.listAccess]);
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

  const groups = caseTypeGroupNames('Late Single Source');
  const capabilities = resolveCapabilities([groups.listAccess]);
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

  const sources = await caseSourcesFor([groups.listAccess]);
  assert.deepEqual(
    sources.map((s) => s.slug),
    ['late-single-source'],
    'and the eligibility side must agree with it'
  );
});
