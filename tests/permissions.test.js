// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCapabilities,
  permissions,
} from '../src/services/permissions.js';

/** @type {import('../src/services/permissions.js').PermissionsConfig} */
const sampleConfig = {
  reviewer: 'Reviewers',
  reviewerComplaints: 'Reviewers - Complaints',
  caseTypeOwners: {
    'example-review': 'CaseTypeOwner - Example Review',
    'kyc-review': 'CaseTypeOwners-KycReview',
    journeyOwnerComplaints: 'JourneyOwner - Complaints',
    caseTypeOwnerComplaints: 'CaseTypeOwner - Complaints',
  },
  responsibleParty: 'CR-ResponsibleParty',
  frontlineComplaints: 'Frontline - Complaints',
  reviewerManager: 'Reviewer-Managers',
  responsiblePartyManager: 'ResponsibleParty-Managers',
  maintainer: 'CR-Maintainers',
  qaReviewer: 'QA-Reviewers',
};

test('resolveCapabilities: QA-Reviewers group → isQaReviewer=true', () => {
  const caps = resolveCapabilities(['QA-Reviewers'], sampleConfig);
  assert.equal(caps.isQaReviewer, true);
  assert.equal(caps.isReviewer, false);
});

test('resolveCapabilities: no QA-Reviewers group → isQaReviewer=false', () => {
  const caps = resolveCapabilities(['Reviewers'], sampleConfig);
  assert.equal(caps.isQaReviewer, false);
});

test('resolveCapabilities: QA-Reviewers → isVisitor=false', () => {
  assert.equal(
    resolveCapabilities(['QA-Reviewers'], sampleConfig).isVisitor,
    false
  );
});

test('resolveCapabilities: empty groups → not reviewer, no owned types', () => {
  const caps = resolveCapabilities([], sampleConfig);
  assert.equal(caps.isReviewer, false);
  assert.deepEqual(caps.ownedCaseTypes, []);
});

test('resolveCapabilities: reviewer group → isReviewer=true, no owned types', () => {
  const caps = resolveCapabilities(['Reviewers'], sampleConfig);
  assert.equal(caps.isReviewer, true);
  assert.deepEqual(caps.ownedCaseTypes, []);
});

test('resolveCapabilities: complaints reviewer group is defined only, not active yet', () => {
  const caps = resolveCapabilities(['Reviewers - Complaints'], sampleConfig);
  assert.equal(caps.isReviewer, false);
  assert.deepEqual(caps.ownedCaseTypes, []);
});

test('resolveCapabilities: owner group only → isReviewer=false, owned slug returned', () => {
  const caps = resolveCapabilities(
    ['CaseTypeOwner - Example Review'],
    sampleConfig
  );
  assert.equal(caps.isReviewer, false);
  assert.deepEqual(caps.ownedCaseTypes, ['example-review']);
});

test('resolveCapabilities: admin (both groups) → reviewer + owned types', () => {
  const caps = resolveCapabilities(
    ['Reviewers', 'CaseTypeOwner - Example Review'],
    sampleConfig
  );
  assert.equal(caps.isReviewer, true);
  assert.deepEqual(caps.ownedCaseTypes, ['example-review']);
});

test('resolveCapabilities: multiple ownership groups → all owned slugs returned', () => {
  const caps = resolveCapabilities(
    ['CaseTypeOwner - Example Review', 'CaseTypeOwners-KycReview'],
    sampleConfig
  );
  assert.deepEqual(caps.ownedCaseTypes.sort(), [
    'example-review',
    'kyc-review',
  ]);
});

test('resolveCapabilities: complaints owner groups → owned complaints types returned', () => {
  const caps = resolveCapabilities(
    ['JourneyOwner - Complaints', 'CaseTypeOwner - Complaints'],
    sampleConfig
  );
  assert.deepEqual(caps.ownedCaseTypes.sort(), [
    'caseTypeOwnerComplaints',
    'journeyOwnerComplaints',
  ]);
});

test('resolveCapabilities: unknown group is silently ignored', () => {
  const caps = resolveCapabilities(
    ['SomeOtherGroup', 'Reviewers'],
    sampleConfig
  );
  assert.equal(caps.isReviewer, true);
  assert.deepEqual(caps.ownedCaseTypes, []);
});

test('resolveCapabilities: responsible party group → isResponsibleParty=true', () => {
  const caps = resolveCapabilities(['CR-ResponsibleParty'], sampleConfig);
  assert.equal(caps.isResponsibleParty, true);
  assert.equal(caps.isReviewer, false);
  assert.deepEqual(caps.ownedCaseTypes, []);
});

test('resolveCapabilities: frontline complaints group is defined only, not active yet', () => {
  const caps = resolveCapabilities(['Frontline - Complaints'], sampleConfig);
  assert.equal(caps.isResponsibleParty, false);
  assert.equal(caps.isReviewer, false);
  assert.deepEqual(caps.ownedCaseTypes, []);
});

test('resolveCapabilities: no responsible party group → isResponsibleParty=false', () => {
  const caps = resolveCapabilities(['Reviewers'], sampleConfig);
  assert.equal(caps.isResponsibleParty, false);
});

test('resolveCapabilities: defaults to exported permissions config when none passed', () => {
  // Sanity: default-config call returns a Capabilities shape without throwing.
  const caps = resolveCapabilities([]);
  assert.equal(typeof caps.isReviewer, 'boolean');
  assert.ok(Array.isArray(caps.ownedCaseTypes));
});

test('permissions: exported config has expected shape', () => {
  assert.equal(typeof permissions.reviewer, 'string');
  assert.equal(typeof permissions.responsibleParty, 'string');
  assert.equal(typeof permissions.caseTypeOwners, 'object');
});

test('permissions: default config preserves core reviewer and responsible party groups', () => {
  assert.equal(permissions.reviewer, 'Reviewers');
  assert.equal(permissions.responsibleParty, 'CR-ResponsibleParty');
});

test('permissions: default config defines complaints reviewer and frontline groups', () => {
  assert.equal(permissions.reviewerComplaints, 'Reviewers - Complaints');
  assert.equal(permissions.frontlineComplaints, 'Frontline - Complaints');
});

test('permissions: default config includes complaints owner groups', () => {
  assert.equal(
    permissions.caseTypeOwners.journeyOwnerComplaints,
    'JourneyOwner - Complaints'
  );
  assert.equal(
    permissions.caseTypeOwners.caseTypeOwnerComplaints,
    'CaseTypeOwner - Complaints'
  );
});

test('resolveCapabilities: Reviewer-Managers group → isReviewerManager=true', () => {
  const caps = resolveCapabilities(['Reviewer-Managers'], sampleConfig);
  assert.equal(caps.isReviewerManager, true);
  assert.equal(caps.isReviewer, false);
});

test('resolveCapabilities: no Reviewer-Managers group → isReviewerManager=false', () => {
  const caps = resolveCapabilities(['Reviewers'], sampleConfig);
  assert.equal(caps.isReviewerManager, false);
});

test('resolveCapabilities: ResponsibleParty-Managers group → isResponsiblePartyManager=true', () => {
  const caps = resolveCapabilities(['ResponsibleParty-Managers'], sampleConfig);
  assert.equal(caps.isResponsiblePartyManager, true);
  assert.equal(caps.isReviewer, false);
});

test('resolveCapabilities: no ResponsibleParty-Managers group → isResponsiblePartyManager=false', () => {
  const caps = resolveCapabilities(['Reviewers'], sampleConfig);
  assert.equal(caps.isResponsiblePartyManager, false);
});

test('resolveCapabilities: CR-Maintainers group → isMaintainer=true', () => {
  const caps = resolveCapabilities(['CR-Maintainers'], sampleConfig);
  assert.equal(caps.isMaintainer, true);
  assert.equal(caps.isReviewer, false);
});

test('resolveCapabilities: no CR-Maintainers group → isMaintainer=false', () => {
  const caps = resolveCapabilities(['Reviewers'], sampleConfig);
  assert.equal(caps.isMaintainer, false);
});

test('resolveCapabilities: empty groups → isVisitor=true (derived)', () => {
  const caps = resolveCapabilities([], sampleConfig);
  assert.equal(caps.isVisitor, true);
});

test('resolveCapabilities: Reviewers → isVisitor=false', () => {
  assert.equal(
    resolveCapabilities(['Reviewers'], sampleConfig).isVisitor,
    false
  );
});

test('resolveCapabilities: Reviewers - Complaints → isVisitor=true until wired', () => {
  assert.equal(
    resolveCapabilities(['Reviewers - Complaints'], sampleConfig).isVisitor,
    true
  );
});

test('resolveCapabilities: Reviewer-Managers → isVisitor=false', () => {
  assert.equal(
    resolveCapabilities(['Reviewer-Managers'], sampleConfig).isVisitor,
    false
  );
});

test('resolveCapabilities: ResponsibleParty-Managers → isVisitor=false', () => {
  assert.equal(
    resolveCapabilities(['ResponsibleParty-Managers'], sampleConfig).isVisitor,
    false
  );
});

test('resolveCapabilities: CR-Maintainers → isVisitor=false', () => {
  assert.equal(
    resolveCapabilities(['CR-Maintainers'], sampleConfig).isVisitor,
    false
  );
});

test('resolveCapabilities: CR-ResponsibleParty → isVisitor=false', () => {
  assert.equal(
    resolveCapabilities(['CR-ResponsibleParty'], sampleConfig).isVisitor,
    false
  );
});

test('resolveCapabilities: Frontline - Complaints → isVisitor=true until wired', () => {
  assert.equal(
    resolveCapabilities(['Frontline - Complaints'], sampleConfig).isVisitor,
    true
  );
});

test('resolveCapabilities: owner of a Case Type → isVisitor=false', () => {
  assert.equal(
    resolveCapabilities(['CaseTypeOwner - Example Review'], sampleConfig)
      .isVisitor,
    false
  );
});
