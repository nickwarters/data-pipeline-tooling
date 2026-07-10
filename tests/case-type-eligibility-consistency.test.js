// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CASE_TYPE_IMPORTERS } from '../case-types/manifest.js';
import {
  DASHBOARD_ENABLED_SLUGS,
  resolveEligibleCaseTypes,
} from '../src/setup/resolve-eligible-case-types.js';

// Case Types known to be URL-openable (case-types/manifest.js) but not yet
// surfaced on any dashboard (src/setup/resolve-eligible-case-types.js). Each
// entry here is a conscious, reviewed staging decision — not drift — per the
// comment on DASHBOARD_ENABLED_SLUGS:
//
// - 'product-sale-review' — Slice 8 "first real Case Type" is still rolling
//   out; not yet ready for dashboard-driven queue/allocation flows.
// - 'stress-review' — a perf/hardening harness (case-types/stress-review.js:
//   "Not a production Case Type"), never meant to reach a dashboard.
// - 'complaints' — deliberately mock-only until list-backed Case Types are
//   wired into the mock client (case-types/complaints.js); premature on
//   dashboards that assume list-backed querying.
//
// Adding a Case Type slug to CASE_TYPE_IMPORTERS without also either (a)
// enabling it here or (b) adding it to NOT_YET_DASHBOARD_ENABLED below must
// fail this test — see the "no undecided slugs" assertion.
const NOT_YET_DASHBOARD_ENABLED = [
  'product-sale-review',
  'stress-review',
  'complaints',
];

// Groups chosen so every Case Type's eligibleGroups/reviewerGroup matches:
// Reviewer-Managers short-circuits resolveEligibleCaseSourcesFromCaseTypes
// to return every dashboard-enabled Case Type regardless of its own group
// configuration.
const EVERYONE_ELIGIBLE_GROUPS = ['Reviewer-Managers'];

test('case type manifests: every dashboard-eligible slug is openable via CASE_TYPE_IMPORTERS', async () => {
  const eligibleSlugs = await resolveEligibleCaseTypes(
    EVERYONE_ELIGIBLE_GROUPS
  );

  for (const slug of eligibleSlugs) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(CASE_TYPE_IMPORTERS, slug),
      `resolveEligibleCaseTypes() returned "${slug}", which is eligible for ` +
        `dashboards but has no importer in CASE_TYPE_IMPORTERS ` +
        `(case-types/manifest.js). A Case Type must be openable via ` +
        `#/case/:caseType/:id before it can appear on a dashboard.`
    );
  }
});

test('case type manifests: DASHBOARD_ENABLED_SLUGS only names known Case Types', () => {
  for (const slug of DASHBOARD_ENABLED_SLUGS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(CASE_TYPE_IMPORTERS, slug),
      `DASHBOARD_ENABLED_SLUGS names "${slug}", which is not a key of ` +
        `CASE_TYPE_IMPORTERS (case-types/manifest.js). Remove it or add a ` +
        `matching entry to the manifest.`
    );
  }
});

test('case type manifests: every manifest slug has a conscious dashboard-eligibility decision', () => {
  const manifestSlugs = Object.keys(CASE_TYPE_IMPORTERS).sort();
  const decidedSlugs = [
    ...DASHBOARD_ENABLED_SLUGS,
    ...NOT_YET_DASHBOARD_ENABLED,
  ].sort();

  assert.deepEqual(
    manifestSlugs,
    decidedSlugs,
    'CASE_TYPE_IMPORTERS (case-types/manifest.js) and the combined ' +
      'DASHBOARD_ENABLED_SLUGS + NOT_YET_DASHBOARD_ENABLED lists have ' +
      'diverged. A new Case Type slug in the manifest must be added to ' +
      'either DASHBOARD_ENABLED_SLUGS (src/setup/resolve-eligible-case-types.js) ' +
      'to enable it on dashboards, or to NOT_YET_DASHBOARD_ENABLED in this ' +
      'test file (with a comment explaining why it is staged) to record ' +
      'that the omission is deliberate.'
  );

  // The two arrays must also be disjoint - a slug should not be both
  // enabled and explicitly marked as not-yet-enabled.
  const overlap = DASHBOARD_ENABLED_SLUGS.filter((slug) =>
    NOT_YET_DASHBOARD_ENABLED.includes(slug)
  );
  assert.deepEqual(
    overlap,
    [],
    'A slug cannot be in both DASHBOARD_ENABLED_SLUGS and ' +
      'NOT_YET_DASHBOARD_ENABLED.'
  );
});
