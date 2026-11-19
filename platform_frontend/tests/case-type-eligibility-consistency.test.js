// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CASE_TYPE_IMPORTERS, displayNameFor } from '../case-types/manifest.js';
import { caseSourcesFor } from './_case-sources-for.js';
import { permissions } from '../src/services/permissions.js';
import { personas } from '../dev/fixtures/personas.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..', 'src');

/**
 * Recursively collect every `.js` file under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function jsFilesUnder(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

test('eligibility: Reviewer Managers resolve every manifest slug to a source with an explicit listName', async () => {
  const sources = await caseSourcesFor(['CoraUserRoles: ReviewerManager']);
  const bySlug = new Map(sources.map((s) => [s.slug, s]));

  for (const slug of Object.keys(CASE_TYPE_IMPORTERS)) {
    const source = bySlug.get(slug);
    assert.ok(
      source,
      `A Reviewer Manager did not resolve manifest slug "${slug}". A ` +
        `manager holds every source.`
    );
    assert.ok(
      typeof source.listName === 'string' && source.listName.length > 0,
      `Case source "${slug}" resolved without an explicit listName. Declare ` +
        `config.listName or rely on the Cases-{PascalSlug} convention — there ` +
        `is no hidden default list.`
    );
  }
});

test('eligibility: a user holding no roles resolves no sources (purely role-derived, no slug allow-list)', async () => {
  const sources = await caseSourcesFor([]);
  assert.deepEqual(
    sources,
    [],
    'With no roles, no Case source should be eligible. Eligibility must be ' +
      'derived from roles alone, never from a slug gate.'
  );
});

test('eligibility: no module references a removed slug-gate (DASHBOARD_ENABLED_SLUGS / resolveEligibleCaseTypes)', () => {
  const offenders = [];
  for (const file of jsFilesUnder(srcRoot)) {
    const text = readFileSync(file, 'utf8');
    if (
      text.includes('DASHBOARD_ENABLED_SLUGS') ||
      text.includes('resolveEligibleCaseTypes')
    ) {
      offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Dashboard/eligibility visibility is now purely role-derived. The slug ' +
      'gate (DASHBOARD_ENABLED_SLUGS) and resolveEligibleCaseTypes were ' +
      'removed — no module may reference them.'
  );
});

test('permissions.caseTypes: names every manifest slug so a role on any of them resolves', () => {
  const permissionSlugs = permissions.caseTypes.map((c) => c.slug).sort();
  assert.deepEqual(
    permissionSlugs,
    Object.keys(CASE_TYPE_IMPORTERS).sort(),
    'permissions.caseTypes is derived from CASE_TYPES (case-types/manifest.js), ' +
      'so it must cover exactly the manifest slugs — a role held on any Case ' +
      'Type, and its display name, resolve.'
  );
});

test('case types: no config module restates its display name — the registry is the one copy', async () => {
  // The permissions copy was hoisted into the registry and the config copy
  // deleted, so there is nothing left to drift. A config that restated the
  // name would let two surfaces derive DIFFERENT Case list group names.
  for (const [slug, importer] of Object.entries(CASE_TYPE_IMPORTERS)) {
    const { default: config } = await importer();
    assert.ok(
      !Object.hasOwn(config, 'displayName'),
      `Case Type "${slug}" declares displayName on its config module. The ` +
        `display name composes its provisioned Case list group names and ` +
        `lives ONLY on its CASE_TYPES entry (case-types/manifest.js).`
    );
  }
});

test('case types: the registry names every manifest slug, so displayNameFor never comes back short', () => {
  for (const slug of Object.keys(CASE_TYPE_IMPORTERS)) {
    const name = displayNameFor(slug);
    assert.ok(
      typeof name === 'string' && name.length > 0,
      `Case Type "${slug}" resolved no display name; its Case list groups ` +
        `could not be named.`
    );
  }
});

test('case types: every manifest config explicitly declares its Case list', async () => {
  for (const [slug, importer] of Object.entries(CASE_TYPE_IMPORTERS)) {
    const { default: config } = await importer();
    assert.ok(
      config.listName,
      `Case Type "${slug}" must declare listName; runtime naming fallbacks hide provisioning mistakes.`
    );
  }
});

test('mock responsible-party persona is an Adviser through their roles row', () => {
  // The Adviser role is a column of the roles row now, not a group, so the
  // fixture must not lean on the retired `Frontline` group to grant it.
  const persona = personas['responsible-party'];
  assert.equal(persona.roles?.adviser, true);
  for (const retired of ['Frontline', 'Advisers', 'CR-ResponsibleParty']) {
    assert.ok(!persona.groups.includes(retired), retired);
  }
});
