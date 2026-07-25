// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CASE_TYPE_IMPORTERS } from '../case-types/manifest.js';
import { resolveCaseSources } from '../src/setup/resolve-eligible-case-types.js';
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
  const sources = await resolveCaseSources(['Reviewer Managers']);
  const bySlug = new Map(sources.map((s) => [s.slug, s]));

  for (const slug of Object.keys(CASE_TYPE_IMPORTERS)) {
    const source = bySlug.get(slug);
    assert.ok(
      source,
      `resolveCaseSources(['Reviewer Managers']) did not resolve manifest ` +
        `slug "${slug}". Every Case Type must be group-derivable — a manager ` +
        `holds every source.`
    );
    assert.ok(
      typeof source.listName === 'string' && source.listName.length > 0,
      `Case source "${slug}" resolved without an explicit listName. Declare ` +
        `config.listName or rely on the Cases-{PascalSlug} convention — there ` +
        `is no hidden default list.`
    );
  }
});

test('eligibility: a user holding no groups resolves no sources (purely group-derived, no slug allow-list)', async () => {
  const sources = await resolveCaseSources([]);
  assert.deepEqual(
    sources,
    [],
    'With no group membership, no Case source should be eligible. Eligibility ' +
      'must be derived from groups alone, never from a slug gate.'
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
    'Dashboard/eligibility visibility is now purely group-derived. The slug ' +
      'gate (DASHBOARD_ENABLED_SLUGS) and resolveEligibleCaseTypes were ' +
      'removed — no module may reference them.'
  );
});

test('permissions.caseTypes: names every manifest slug so its display name and derived groups resolve', () => {
  const permissionSlugs = permissions.caseTypes.map((c) => c.slug).sort();
  assert.deepEqual(
    permissionSlugs,
    Object.keys(CASE_TYPE_IMPORTERS).sort(),
    'permissions.caseTypes is derived from CASE_TYPES (case-types/manifest.js), ' +
      'so it must cover exactly the manifest slugs — per-Case-Type group names ' +
      'and display names resolve for every Case Type.'
  );
});

test('permissions.caseTypes: each displayName matches the Case Type config displayName', async () => {
  // The one remaining duplicate of a display name is the config's own
  // `displayName` (#508 hoisted the permissions copy into the manifest). This is
  // the assertion that registry and config still agree — a mismatch would
  // silently derive the wrong SharePoint group names.
  for (const { slug, displayName } of permissions.caseTypes) {
    const { default: config } = await CASE_TYPE_IMPORTERS[slug]();
    assert.equal(
      displayName,
      config.displayName,
      `permissions.caseTypes displayName for "${slug}" ("${displayName}") must ` +
        `match its Case Type config displayName ("${config.displayName}").`
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

test('mock responsible-party persona uses the current Adviser group', () => {
  assert.ok(personas['responsible-party'].groups.includes('Advisers'));
  assert.ok(
    !personas['responsible-party'].groups.includes('CR-ResponsibleParty')
  );
});
