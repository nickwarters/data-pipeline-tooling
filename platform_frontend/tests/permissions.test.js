// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCapabilities,
  caseTypeGroupNames,
  permissions,
  readUserRoles,
} from '../src/services/permissions.js';
import { noRoles } from '../src/services/user-roles.js';
import { CASE_TYPES } from '../case-types/manifest.js';

/** @type {import('../src/services/permissions.js').PermissionsConfig} */
const sampleConfig = {
  reviewer: 'Reviewers',
  adviser: 'Frontline',
  controls: 'Controls',
  reviewerManager: 'Reviewer Managers',
  responsiblePartyManager: 'ResponsibleParty-Managers',
  maintainer: 'CORA Owner Delegates',
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

test('resolveCapabilities: Frontline group → isAdviser=true', () => {
  const caps = resolveCapabilities(['Frontline'], sampleConfig);
  assert.equal(caps.isAdviser, true);
  assert.equal(caps.isReviewer, false);
  assert.equal(caps.isVisitor, false);
});

// `Frontline` (site-wide functional) and `Frontline - <type>` (per-Case-Type
// list access) share a prefix but are different groups on different axes. Every
// match in this module is exact equality, and these two tests are what keeps it
// that way: a prefix or `startsWith` match would make either group silently
// grant the other's access.
test('resolveCapabilities: Frontline - <type> does not grant the Frontline capability', () => {
  const caps = resolveCapabilities(['Frontline - Complaints'], sampleConfig);

  assert.equal(caps.isAdviser, false);
  // Nor does it grant list access, which is `Reviewers - <type>`'s axis: the
  // frontline list-access group is a SharePoint ACL this layer never reads.
  assert.deepEqual(caps.listAccessCaseTypes, []);
  assert.equal(caps.isReviewer, false);
  assert.equal(caps.isVisitor, true);
});

test('resolveCapabilities: Frontline does not grant any per-Case-Type access', () => {
  const caps = resolveCapabilities(['Frontline'], sampleConfig);

  assert.equal(caps.isAdviser, true);
  assert.deepEqual(caps.listAccessCaseTypes, []);
  assert.deepEqual(caps.ownedCaseTypes, []);
  assert.deepEqual(caps.ownedJourneyCaseTypes, []);
});

test('resolveCapabilities: Controls group → isControls=true', () => {
  const caps = resolveCapabilities(['Controls'], sampleConfig);
  assert.equal(caps.isControls, true);
  assert.equal(caps.isReviewer, false);
  assert.equal(caps.isVisitor, false);
});

test('resolveCapabilities: only Controls may search across every Case Type', () => {
  assert.equal(
    resolveCapabilities(['Controls'], sampleConfig).canSearchCases,
    true
  );
  for (const groups of [
    ['Reviewers'],
    ['Frontline'],
    ['Reviewer Managers'],
    ['ResponsibleParty-Managers'],
    ['CaseTypeOwner - Example Review'],
    ['JourneyOwner - Example Review'],
    ['CORA Owner Delegates'],
    [],
  ]) {
    assert.equal(
      resolveCapabilities(groups, sampleConfig).canSearchCases,
      false,
      `${groups.join(', ') || 'no groups'} must not reach cross-Case-Type search`
    );
  }
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

test('resolveCapabilities: Reviewer Managers group → isReviewerManager=true', () => {
  const caps = resolveCapabilities(['Reviewer Managers'], sampleConfig);
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

test('resolveCapabilities: CORA Owner Delegates group → isMaintainer=true', () => {
  const caps = resolveCapabilities(['CORA Owner Delegates'], sampleConfig);
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
    ['Reviewers - Complaints', 'JourneyOwner - Complaints'],
    permissions
  );
  assert.equal(caps.isReviewer, true);
  assert.deepEqual(caps.listAccessCaseTypes, ['complaints']);
  assert.deepEqual(caps.ownedJourneyCaseTypes, ['complaints']);
});

test('permissions: exported config exposes the functional group names and Case Type list', () => {
  assert.equal(permissions.reviewer, 'Reviewers');
  assert.equal(permissions.adviser, 'Frontline');
  assert.equal(permissions.controls, 'Controls');
  assert.equal(permissions.reviewerManager, 'Reviewer Managers');
  assert.equal(
    permissions.responsiblePartyManager,
    'ResponsibleParty-Managers'
  );
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

test('permissions.caseTypes: group names still derive from the registry display names', () => {
  const complaints = permissions.caseTypes.find((t) => t.slug === 'complaints');
  assert.ok(complaints);
  assert.deepEqual(caseTypeGroupNames(complaints.displayName), {
    listAccess: 'Reviewers - Complaints',
    caseTypeOwner: 'CaseTypeOwner - Complaints',
    journeyOwner: 'JourneyOwner - Complaints',
  });
});

// ===== the CoraUserRoles row grants alongside the groups =====

/** @param {Partial<import('../src/services/user-roles.js').UserRoles>} roles */
const row = (roles) => ({ ...noRoles(), ...roles });

test('resolveCapabilities: each yes/no column of the roles row grants its role with no group', () => {
  for (const [flag, capability] of /** @type {const} */ ([
    ['adviser', 'isAdviser'],
    ['controls', 'isControls'],
    ['reviewerManager', 'isReviewerManager'],
    ['responsiblePartyManager', 'isResponsiblePartyManager'],
    ['reviewer', 'isReviewer'],
  ])) {
    const caps = resolveCapabilities([], sampleConfig, row({ [flag]: true }));
    assert.equal(caps[capability], true, flag);
    assert.equal(caps.isVisitor, false, flag);
  }
});

test('resolveCapabilities: a Case Type held in the roles row grants the same as its group', () => {
  const caps = resolveCapabilities(
    [],
    sampleConfig,
    row({
      reviews: ['complaints'],
      ownsCaseTypes: ['example-review'],
      journeyOwnerOf: ['complaints'],
    })
  );
  assert.deepEqual(caps.listAccessCaseTypes, ['complaints']);
  assert.equal(caps.isReviewer, true);
  assert.deepEqual(caps.ownedCaseTypes, ['example-review']);
  assert.deepEqual(caps.ownedJourneyCaseTypes, ['complaints']);
});

test('resolveCapabilities: the groups and the roles row together grant each role once', () => {
  const caps = resolveCapabilities(
    ['Reviewers - Complaints', 'Controls'],
    sampleConfig,
    row({ reviews: ['complaints', 'example-review'], controls: true })
  );
  assert.deepEqual(caps.listAccessCaseTypes, ['example-review', 'complaints']);
  assert.equal(caps.isControls, true);
});

test('resolveCapabilities: a Case Type in the roles row that the application does not have grants nothing', () => {
  const caps = resolveCapabilities(
    [],
    sampleConfig,
    row({
      reviews: ['retired-type'],
      ownsCaseTypes: ['retired-type'],
      journeyOwnerOf: ['retired-type'],
    })
  );
  assert.deepEqual(caps.listAccessCaseTypes, []);
  assert.deepEqual(caps.ownedCaseTypes, []);
  assert.deepEqual(caps.ownedJourneyCaseTypes, []);
  assert.equal(caps.isVisitor, true);
});

test('resolveCapabilities: a Maintainer is still granted by its group alone', () => {
  // The group that owns every other group, and may edit the roles list, cannot
  // live in that list: nothing in the row makes someone a Maintainer.
  assert.equal(
    resolveCapabilities(['CORA Owner Delegates'], sampleConfig, noRoles())
      .isMaintainer,
    true
  );
});

test("readUserRoles: returns the person's roles row", async () => {
  const roles = row({ controls: true, reviews: ['complaints'] });
  /** @type {string[]} */
  const asked = [];
  const client = {
    getUserRoles: async (/** @type {string} */ account) => {
      asked.push(account);
      return roles;
    },
  };
  assert.deepEqual(await readUserRoles(client, 'DOMAIN\\alice'), roles);
  assert.deepEqual(asked, ['DOMAIN\\alice']);
});

test('readUserRoles: a roles row that cannot be read grants nothing and is reported', async () => {
  const original = console.warn;
  /** @type {any[][]} */
  const warned = [];
  console.warn = (...args) => warned.push(args);
  try {
    const failure = new Error('list not found');
    const roles = await readUserRoles(
      {
        getUserRoles: async () => {
          throw failure;
        },
      },
      'DOMAIN\\alice'
    );
    assert.deepEqual(roles, noRoles());
    assert.equal(warned.length, 1);
    assert.equal(warned[0][1], failure);
  } finally {
    console.warn = original;
  }
});
