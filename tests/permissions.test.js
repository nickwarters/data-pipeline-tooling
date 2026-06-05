// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCapabilities, permissions } from '../src/services/permissions.js';

/** @type {import('../src/services/permissions.js').PermissionsConfig} */
const sampleConfig = {
  reviewer: 'Reviewers',
  caseTypeOwners: {
    'hello-review': 'CaseTypeOwners-HelloReview',
    'kyc-review': 'CaseTypeOwners-KycReview',
  },
  responsibleParty: 'CR-ResponsibleParty',
  reviewerManager: 'Reviewer-Managers',
  responsiblePartyManager: 'ResponsibleParty-Managers',
  maintainer: 'CR-Maintainers',
};

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

test('resolveCapabilities: owner group only → isReviewer=false, owned slug returned', () => {
  const caps = resolveCapabilities(['CaseTypeOwners-HelloReview'], sampleConfig);
  assert.equal(caps.isReviewer, false);
  assert.deepEqual(caps.ownedCaseTypes, ['hello-review']);
});

test('resolveCapabilities: admin (both groups) → reviewer + owned types', () => {
  const caps = resolveCapabilities(
    ['Reviewers', 'CaseTypeOwners-HelloReview'],
    sampleConfig
  );
  assert.equal(caps.isReviewer, true);
  assert.deepEqual(caps.ownedCaseTypes, ['hello-review']);
});

test('resolveCapabilities: multiple ownership groups → all owned slugs returned', () => {
  const caps = resolveCapabilities(
    ['CaseTypeOwners-HelloReview', 'CaseTypeOwners-KycReview'],
    sampleConfig
  );
  assert.deepEqual(caps.ownedCaseTypes.sort(), ['hello-review', 'kyc-review']);
});

test('resolveCapabilities: unknown group is silently ignored', () => {
  const caps = resolveCapabilities(['SomeOtherGroup', 'Reviewers'], sampleConfig);
  assert.equal(caps.isReviewer, true);
  assert.deepEqual(caps.ownedCaseTypes, []);
});

test('resolveCapabilities: responsible party group → isResponsibleParty=true', () => {
  const caps = resolveCapabilities(['CR-ResponsibleParty'], sampleConfig);
  assert.equal(caps.isResponsibleParty, true);
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
  assert.equal(typeof permissions.caseTypeOwners, 'object');
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
  assert.equal(resolveCapabilities(['Reviewers'], sampleConfig).isVisitor, false);
});

test('resolveCapabilities: Reviewer-Managers → isVisitor=false', () => {
  assert.equal(resolveCapabilities(['Reviewer-Managers'], sampleConfig).isVisitor, false);
});

test('resolveCapabilities: ResponsibleParty-Managers → isVisitor=false', () => {
  assert.equal(resolveCapabilities(['ResponsibleParty-Managers'], sampleConfig).isVisitor, false);
});

test('resolveCapabilities: CR-Maintainers → isVisitor=false', () => {
  assert.equal(resolveCapabilities(['CR-Maintainers'], sampleConfig).isVisitor, false);
});

test('resolveCapabilities: CR-ResponsibleParty → isVisitor=false', () => {
  assert.equal(resolveCapabilities(['CR-ResponsibleParty'], sampleConfig).isVisitor, false);
});

test('resolveCapabilities: owner of a Case Type → isVisitor=false', () => {
  assert.equal(resolveCapabilities(['CaseTypeOwners-HelloReview'], sampleConfig).isVisitor, false);
});
