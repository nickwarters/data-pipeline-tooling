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
