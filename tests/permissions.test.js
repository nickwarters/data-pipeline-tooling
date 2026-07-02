// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCapabilities,
  caseTypeGroupNames,
  permissions,
} from '../src/services/permissions.js';

/** @type {import('../src/services/permissions.js').PermissionsConfig} */
const sampleConfig = {
  reviewer: 'Reviewers',
  adviser: 'Advisers',
  controls: 'Controls',
  reviewerManager: 'Reviewer-Managers',
  responsiblePartyManager: 'ResponsibleParty-Managers',
  maintainer: 'CR-Maintainers',
  caseTypes: [
    { slug: 'example-review', displayName: 'Example Review' },
    { slug: 'complaints', displayName: 'Complaints' },
  ],
};

test('caseTypeGroupNames: composes all three group names from the display name', () => {
  assert.deepEqual(caseTypeGroupNames('Example Review'), {
    listAccess: 'Reviewers - Example Review',
    caseTypeOwner: 'CaseTypeOwner - Example Review',
    journeyOwner: 'JourneyOwner - Example Review',
  });
});

test('resolveCapabilities: empty groups → visitor with no capabilities', () => {
  const caps = resolveCapabilities([], sampleConfig);
  assert.equal(caps.isReviewer, false);
  assert.equal(caps.isAdviser, false);
  assert.equal(caps.isControls, false);
  assert.deepEqual(caps.listAccessCaseTypes, []);
  assert.deepEqual(caps.ownedCaseTypes, []);
  assert.deepEqual(caps.ownedJourneyCaseTypes, []);
  assert.equal(caps.isVisitor, true);
});

test('resolveCapabilities: standalone Reviewers → isReviewer, no list access', () => {
  const caps = resolveCapabilities(['Reviewers'], sampleConfig);
  assert.equal(caps.isReviewer, true);
  assert.deepEqual(caps.listAccessCaseTypes, []);
  assert.equal(caps.isVisitor, false);
});

test('resolveCapabilities: Reviewers - <type> implies isReviewer and records list access', () => {
  const caps = resolveCapabilities(
    ['Reviewers - Example Review'],
    sampleConfig
  );
  assert.equal(caps.isReviewer, true);
  assert.deepEqual(caps.listAccessCaseTypes, ['example-review']);
  assert.equal(caps.isVisitor, false);
});

test('resolveCapabilities: multiple Reviewers - <type> groups accumulate list access', () => {
  const caps = resolveCapabilities(
    ['Reviewers - Example Review', 'Reviewers - Complaints'],
    sampleConfig
  );
  assert.equal(caps.isReviewer, true);
  assert.deepEqual(caps.listAccessCaseTypes.sort(), [
    'complaints',
    'example-review',
  ]);
});

test('resolveCapabilities: Advisers group → isAdviser=true', () => {
  const caps = resolveCapabilities(['Advisers'], sampleConfig);
  assert.equal(caps.isAdviser, true);
  assert.equal(caps.isReviewer, false);
  assert.equal(caps.isVisitor, false);
});

test('resolveCapabilities: Controls group → isControls=true', () => {
  const caps = resolveCapabilities(['Controls'], sampleConfig);
  assert.equal(caps.isControls, true);
  assert.equal(caps.isReviewer, false);
  assert.equal(caps.isVisitor, false);
});

test('resolveCapabilities: CaseTypeOwner - <type> → owned slug, not a reviewer', () => {
  const caps = resolveCapabilities(
    ['CaseTypeOwner - Example Review'],
    sampleConfig
  );
  assert.equal(caps.isReviewer, false);
  assert.deepEqual(caps.ownedCaseTypes, ['example-review']);
  assert.deepEqual(caps.ownedJourneyCaseTypes, []);
  assert.equal(caps.isVisitor, false);
});

test('resolveCapabilities: multiple CaseTypeOwner groups → all owned slugs returned', () => {
  const caps = resolveCapabilities(
    ['CaseTypeOwner - Example Review', 'CaseTypeOwner - Complaints'],
    sampleConfig
  );
  assert.deepEqual(caps.ownedCaseTypes.sort(), [
    'complaints',
    'example-review',
  ]);
});

test('resolveCapabilities: JourneyOwner - <type> → journey slug, NOT a Case Type Owner', () => {
  const caps = resolveCapabilities(['JourneyOwner - Complaints'], sampleConfig);
  assert.deepEqual(caps.ownedJourneyCaseTypes, ['complaints']);
  assert.deepEqual(caps.ownedCaseTypes, []);
  assert.equal(caps.isReviewer, false);
  assert.equal(caps.isVisitor, false);
});

test('resolveCapabilities: admin (Reviewers + owner) → reviewer + owned types', () => {
  const caps = resolveCapabilities(
    ['Reviewers', 'CaseTypeOwner - Example Review'],
    sampleConfig
  );
  assert.equal(caps.isReviewer, true);
  assert.deepEqual(caps.ownedCaseTypes, ['example-review']);
});

test('resolveCapabilities: Reviewer-Managers group → isReviewerManager=true', () => {
  const caps = resolveCapabilities(['Reviewer-Managers'], sampleConfig);
  assert.equal(caps.isReviewerManager, true);
  assert.equal(caps.isReviewer, false);
  assert.equal(caps.isVisitor, false);
});

test('resolveCapabilities: ResponsibleParty-Managers group → isResponsiblePartyManager=true', () => {
  const caps = resolveCapabilities(['ResponsibleParty-Managers'], sampleConfig);
  assert.equal(caps.isResponsiblePartyManager, true);
  assert.equal(caps.isReviewer, false);
  assert.equal(caps.isVisitor, false);
});

test('resolveCapabilities: CR-Maintainers group → isMaintainer=true', () => {
  const caps = resolveCapabilities(['CR-Maintainers'], sampleConfig);
  assert.equal(caps.isMaintainer, true);
  assert.equal(caps.isReviewer, false);
  assert.equal(caps.isVisitor, false);
});

test('resolveCapabilities: unknown group is silently ignored', () => {
  const caps = resolveCapabilities(
    ['SomeOtherGroup', 'Reviewers'],
    sampleConfig
  );
  assert.equal(caps.isReviewer, true);
  assert.deepEqual(caps.ownedCaseTypes, []);
  assert.deepEqual(caps.listAccessCaseTypes, []);
});

test('resolveCapabilities: defaults to exported permissions config when none passed', () => {
  const caps = resolveCapabilities(['Reviewers']);
  assert.equal(caps.isReviewer, true);
  assert.ok(Array.isArray(caps.ownedCaseTypes));
  assert.ok(Array.isArray(caps.listAccessCaseTypes));
  assert.ok(Array.isArray(caps.ownedJourneyCaseTypes));
});

test('resolveCapabilities: default config resolves derived per-type group names', () => {
  const caps = resolveCapabilities(
    ['Reviewers - Example Review', 'JourneyOwner - Complaints'],
    permissions
  );
  assert.equal(caps.isReviewer, true);
  assert.deepEqual(caps.listAccessCaseTypes, ['example-review']);
  assert.deepEqual(caps.ownedJourneyCaseTypes, ['complaints']);
});

test('permissions: exported config exposes the functional group names and Case Type list', () => {
  assert.equal(permissions.reviewer, 'Reviewers');
  assert.equal(permissions.adviser, 'Advisers');
  assert.equal(permissions.controls, 'Controls');
  assert.equal(permissions.reviewerManager, 'Reviewer-Managers');
  assert.equal(
    permissions.responsiblePartyManager,
    'ResponsibleParty-Managers'
  );
  assert.equal(permissions.maintainer, 'CR-Maintainers');
  assert.ok(Array.isArray(permissions.caseTypes));
  assert.ok(
    permissions.caseTypes.some(
      (t) => t.slug === 'example-review' && t.displayName === 'Example Review'
    )
  );
});
