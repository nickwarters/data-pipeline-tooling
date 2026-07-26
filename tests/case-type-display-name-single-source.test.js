// @ts-check
// One display name, two consumers (#527).
//
// A Case Type's display name composes the three provisioned SharePoint group
// names (`Reviewers - X`, `CaseTypeOwner - X`, `JourneyOwner - X`). Two
// independent consumers derive them:
//
//   1. `permissions.caseTypes` / `resolveCapabilities()` — the capability side
//   2. `resolveCaseSources()` — the Case-source eligibility side
//
// Before #527 each read a DIFFERENT copy of the name (the registry entry vs the
// Case Type config module), so drift made a user resolve the capability but not
// the source, or the reverse. This test proves there is now exactly ONE copy:
// it renames the registry entry and asserts BOTH consumers move with it.
//
// The rename must land before `permissions.js` is first evaluated (it projects
// `CASE_TYPES` at module scope), so every import below is dynamic and ordered.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const manifest = await import('../case-types/manifest.js');

const complaints = manifest.CASE_TYPES.find((c) => c.slug === 'complaints');
assert.ok(complaints, 'the complaints Case Type must be registered');
const ORIGINAL_NAME = complaints.displayName;
const RENAMED = 'Renamed Complaints';
complaints.displayName = RENAMED;

const { permissions, resolveCapabilities, caseTypeGroupNames } =
  await import('../src/services/permissions.js');
const { resolveCaseSources } =
  await import('../src/setup/resolve-eligible-case-types.js');

const renamedGroups = caseTypeGroupNames(RENAMED);
const staleGroups = caseTypeGroupNames(ORIGINAL_NAME);

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
  const viaListAccess = await resolveCaseSources([renamedGroups.listAccess]);
  assert.deepEqual(
    viaListAccess.map((s) => s.slug),
    ['complaints'],
    'resolveCaseSources() must derive `Reviewers - <name>` from the SAME ' +
      'registry entry the capability side reads.'
  );

  for (const group of [renamedGroups.caseTypeOwner, renamedGroups.journeyOwner])
    assert.deepEqual(
      (await resolveCaseSources([group])).map((s) => s.slug),
      ['complaints'],
      `${group} must resolve the complaints source from the registry name`
    );

  // The stale `Reviewers - Complaints` is deliberately excluded here: the
  // complaints config declares it explicitly in `eligibleGroups`, an alias that
  // does not derive from the display name at all.
  for (const group of [staleGroups.caseTypeOwner, staleGroups.journeyOwner])
    assert.deepEqual(
      await resolveCaseSources([group]),
      [],
      `${group} names the OLD display name — nothing may still derive from it`
    );
});

test('registry rename: the resolved Case source reports the registry display name', async () => {
  const [source] = await resolveCaseSources([renamedGroups.listAccess]);
  assert.equal(
    source?.displayName,
    RENAMED,
    'CaseSource.displayName is the registry name, not a config copy'
  );
});
