// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allCaseListGroups,
  caseListGroupNames,
  permissions,
  resolveCapabilities,
} from '../src/services/permissions.js';
import { noRoles } from '../src/services/user-roles.js';
import { CASE_TYPES } from '../case-types/manifest.js';

/** @type {import('../src/services/permissions.js').PermissionsConfig} */
const sampleConfig = {
  maintainer: 'CORA Owner Delegates',
  caseTypes: [
    { slug: 'example-review', displayName: 'Example Review' },
    { slug: 'complaints', displayName: 'Complaints' },
  ],
};

/** @param {Partial<import('../src/services/user-roles.js').UserRoles>} roles */
const row = (roles) => ({ ...noRoles(), ...roles });

/** @param {Partial<import('../src/services/user-roles.js').UserRoles>} roles */
const capsOf = (roles) => resolveCapabilities([], sampleConfig, row(roles));

test('resolveCapabilities: nobody with no row and no group is a Visitor with no capabilities', () => {
  const caps = resolveCapabilities([], sampleConfig);
  assert.equal(caps.isReviewer, false);
  assert.equal(caps.isAdviser, false);
  assert.equal(caps.isControls, false);
  assert.deepEqual(caps.listAccessCaseTypes, []);
  assert.deepEqual(caps.ownedCaseTypes, []);
  assert.deepEqual(caps.ownedJourneyCaseTypes, []);
  assert.equal(caps.isVisitor, true);
});

test('resolveCapabilities: each yes/no column of the roles row grants its role', () => {
  for (const [flag, capability] of /** @type {const} */ ([
    ['adviser', 'isAdviser'],
    ['controls', 'isControls'],
    ['reviewerManager', 'isReviewerManager'],
    ['responsiblePartyManager', 'isResponsiblePartyManager'],
    ['reviewer', 'isReviewer'],
  ])) {
    const caps = capsOf({ [flag]: true });
    assert.equal(caps[capability], true, flag);
    assert.equal(caps.isVisitor, false, flag);
  }
});

test('resolveCapabilities: the bare Reviewer flag is a Reviewer of no Case Type', () => {
  const caps = capsOf({ reviewer: true });
  assert.equal(caps.isReviewer, true);
  assert.deepEqual(caps.listAccessCaseTypes, []);
});

test('resolveCapabilities: reviewing Case Types implies being a Reviewer, in registry order', () => {
  const caps = capsOf({ reviews: ['complaints', 'example-review'] });
  assert.equal(caps.isReviewer, true);
  assert.deepEqual(caps.listAccessCaseTypes, ['example-review', 'complaints']);
  assert.equal(caps.isVisitor, false);
});

test('resolveCapabilities: owning a Case Type makes a Case Type Owner, not a Reviewer', () => {
  const caps = capsOf({ ownsCaseTypes: ['example-review'] });
  assert.deepEqual(caps.ownedCaseTypes, ['example-review']);
  assert.equal(caps.isReviewer, false);
  assert.deepEqual(caps.listAccessCaseTypes, []);
  assert.equal(caps.isVisitor, false);
});

test('resolveCapabilities: a Journey Owner is not a Case Type Owner', () => {
  const caps = capsOf({ journeyOwnerOf: ['complaints'] });
  assert.deepEqual(caps.ownedJourneyCaseTypes, ['complaints']);
  assert.deepEqual(caps.ownedCaseTypes, []);
  assert.equal(caps.isVisitor, false);
});

test('resolveCapabilities: an Adviser holds no per-Case-Type role', () => {
  const caps = capsOf({ adviser: true });
  assert.deepEqual(caps.listAccessCaseTypes, []);
  assert.deepEqual(caps.ownedCaseTypes, []);
  assert.deepEqual(caps.ownedJourneyCaseTypes, []);
});

test('resolveCapabilities: a Case Type in the row that the application does not have grants nothing', () => {
  const caps = capsOf({
    reviews: ['retired-type'],
    ownsCaseTypes: ['retired-type'],
    journeyOwnerOf: ['retired-type'],
  });
  assert.deepEqual(caps.listAccessCaseTypes, []);
  assert.deepEqual(caps.ownedCaseTypes, []);
  assert.deepEqual(caps.ownedJourneyCaseTypes, []);
  assert.equal(caps.isVisitor, true);
});

test('resolveCapabilities: only Controls may search across every Case Type', () => {
  assert.equal(capsOf({ controls: true }).canSearchCases, true);
  for (const roles of [
    { reviewer: true },
    { adviser: true },
    { reviewerManager: true },
    { responsiblePartyManager: true },
    { ownsCaseTypes: ['example-review'] },
    { journeyOwnerOf: ['example-review'] },
    {},
  ]) {
    assert.equal(
      capsOf(roles).canSearchCases,
      false,
      `${JSON.stringify(roles)} must not reach cross-Case-Type search`
    );
  }
  assert.equal(
    resolveCapabilities(['CORA Owner Delegates'], sampleConfig).canSearchCases,
    false,
    'a Maintainer must not reach cross-Case-Type search'
  );
});

test('resolveCapabilities: the Maintainer is the one role still held in a group', () => {
  const caps = resolveCapabilities(['CORA Owner Delegates'], sampleConfig);
  assert.equal(caps.isMaintainer, true);
  assert.equal(caps.isVisitor, false);
});

test('resolveCapabilities: no other group grants a role, the old role groups and the Case list groups alike', () => {
  for (const group of [
    'Reviewers',
    'Frontline',
    'Controls',
    'Reviewer Managers',
    'ResponsibleParty-Managers',
    'Reviewers - Complaints',
    'Frontline - Complaints',
    'CaseTypeOwner - Complaints',
    'JourneyOwner - Complaints',
    caseListGroupNames('Complaints').read,
    caseListGroupNames('Complaints').write,
    allCaseListGroups.read,
    allCaseListGroups.write,
  ]) {
    assert.equal(
      resolveCapabilities([group], sampleConfig).isVisitor,
      true,
      `${group} must grant nothing`
    );
  }
});

test('resolveCapabilities: defaults to the exported permissions config and a row with nothing', () => {
  const caps = resolveCapabilities([]);
  assert.equal(caps.isVisitor, true);
  assert.deepEqual(
    resolveCapabilities([], undefined, row({ reviews: ['complaints'] }))
      .listAccessCaseTypes,
    ['complaints']
  );
});

test('permissions: exported config names the Maintainer group and the Case Type list', () => {
  assert.equal(permissions.maintainer, 'CORA Owner Delegates');
  assert.ok(Array.isArray(permissions.caseTypes));
  assert.ok(
    permissions.caseTypes.some(
      (t) => t.slug === 'complaints' && t.displayName === 'Complaints'
    )
  );
});

test('permissions.caseTypes: derived from the CASE_TYPES manifest registry, not hand-listed', () => {
  assert.deepEqual(
    permissions.caseTypes,
    CASE_TYPES.map(({ slug, displayName }) => ({ slug, displayName })),
    'permissions.caseTypes must project the one Case Type registry, in order'
  );

  // Deriving must not have cost the boot path its laziness: no Case Type module
  // is evaluated by importing permissions.js.
  for (const entry of CASE_TYPES) {
    assert.equal(typeof entry.importer, 'function');
  }
});

test('caseListGroupNames: the Case list groups derive from the registry display name', () => {
  const complaints = permissions.caseTypes.find((t) => t.slug === 'complaints');
  assert.ok(complaints);
  assert.deepEqual(caseListGroupNames(complaints.displayName), {
    read: 'Cases - Complaints Read',
    write: 'Cases - Complaints Write',
  });
  assert.deepEqual(allCaseListGroups, {
    read: 'CORA All Cases Read',
    write: 'CORA All Cases Write',
  });
});
