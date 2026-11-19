// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCESS_ROLES,
  allRoles,
  describeChange,
  grantNote,
  heldRoles,
  planGrant,
  planRevoke,
  roleHolders,
  roleParts,
  roleTitle,
} from '../src/services/access-roles.js';
import {
  allCaseListGroups,
  caseListGroupNames,
  frontlineListAccessGroupName,
  permissions,
  resolveCapabilities,
} from '../src/services/permissions.js';
import {
  isRoleEntry,
  noRoles,
  roleCaseTypeEntry,
  roleFlagEntry,
  withRoleEntries,
} from '../src/services/user-roles.js';

const CASE_TYPES = permissions.caseTypes;
const [COMPLAINTS] = CASE_TYPES;
const OTHER = CASE_TYPES.find((type) => type.slug !== COMPLAINTS.slug);
assert.ok(OTHER, 'the suite needs two Case Types');

/** @param {string} id @param {string | null} [caseType] */
const role = (id, caseType = null) =>
  /** @type {import('../src/services/access-roles.js').RoleRef} */ ({
    id,
    caseType,
  });

/** @param {import('../src/services/access-roles.js').RoleRef} ref */
const partsOf = (ref) => {
  const parts = roleParts(ref, CASE_TYPES);
  return parts ? [...parts.parts, ...parts.requires] : [];
};

/** Every group and role entry any role is made of, for the Case Types the suite has. */
const UNIVERSE = [...new Set(allRoles(CASE_TYPES).flatMap(partsOf))];

/**
 * Everything a role could share a part with: the parts of every role on the
 * same Case Type, or of the site-wide roles, plus the frontline group that
 * keeps a Case list open. Small enough to try every combination of.
 *
 * @param {import('../src/services/access-roles.js').RoleRef} ref
 */
const neighbourhood = (ref) => [
  ...new Set([
    ...allRoles(CASE_TYPES)
      .filter((other) => other.caseType === ref.caseType)
      .flatMap(partsOf),
    roleFlagEntry('reviewer'),
    ...CASE_TYPES.filter((type) => type.slug === ref.caseType).map((type) =>
      frontlineListAccessGroupName(type.displayName)
    ),
  ]),
];

const COMPLAINTS_WRITE = caseListGroupNames(COMPLAINTS.displayName).write;

/** @param {string[]} groups */
function* subsets(groups) {
  for (let mask = 0; mask < 1 << groups.length; mask += 1) {
    yield groups.filter((_, index) => mask & (1 << index));
  }
}

test('granting any role to a person with nothing shows the matching capability through the groups and the row alike', () => {
  for (const ref of allRoles(CASE_TYPES)) {
    const { groups } = planGrant(ref, [], CASE_TYPES);
    const slug = ref.caseType ?? '';
    const byGroups = resolveCapabilities(
      groups.filter((part) => !isRoleEntry(part))
    );
    const byRow = resolveCapabilities(
      [],
      permissions,
      withRoleEntries(noRoles(), { add: groups.filter(isRoleEntry) })
    );
    for (const [model, caps] of /** @type {const} */ ([
      ['groups', byGroups],
      ['row', byRow],
    ])) {
      const shown = {
        reviewer: caps.listAccessCaseTypes.includes(slug) && caps.isReviewer,
        'reviewer-manager': caps.isReviewerManager,
        controls: caps.isControls,
        'case-type-owner': caps.ownedCaseTypes.includes(slug),
        'journey-owner': caps.ownedJourneyCaseTypes.includes(slug),
      }[/** @type {'reviewer'} */ (ref.id)];
      assert.equal(shown, true, `${ref.id} ${slug} through the ${model}`);
      assert.equal(
        caps.isMaintainer,
        false,
        `${ref.id} never makes a Maintainer`
      );
    }
    assert.equal(
      heldRoles(groups, CASE_TYPES).find(
        (held) => held.id === ref.id && held.caseType === ref.caseType
      )?.complete,
      true,
      `${ref.id} ${slug} reads back as a complete role`
    );
  }
});

test('the roles on offer are the internal ones, and none gives the Maintainer or a frontline group', () => {
  const offered = ACCESS_ROLES.map((entry) => entry.id).sort();
  assert.deepEqual(offered, [
    'case-type-owner',
    'controls',
    'journey-owner',
    'reviewer',
    'reviewer-manager',
  ]);
  const forbidden = [
    permissions.maintainer,
    permissions.adviser,
    permissions.responsiblePartyManager,
  ];
  for (const ref of allRoles(CASE_TYPES)) {
    const groups = planGrant(ref, [], CASE_TYPES).groups;
    for (const group of forbidden) assert.ok(!groups.includes(group), group);
  }
});

test('a Reviewer grant adds the old groups, the row entry and the Case list Write group, only what is missing', () => {
  const ref = role('reviewer', COMPLAINTS.slug);
  const all = [
    `Reviewers - ${COMPLAINTS.displayName}`,
    permissions.reviewer,
    roleCaseTypeEntry('reviews', COMPLAINTS.slug),
    COMPLAINTS_WRITE,
  ];
  assert.deepEqual(planGrant(ref, [], CASE_TYPES), {
    groups: all,
    refusal: null,
  });
  assert.deepEqual(
    planGrant(ref, [permissions.reviewer], CASE_TYPES).groups,
    all.filter((part) => part !== permissions.reviewer)
  );
  assert.equal(
    planGrant(ref, all, CASE_TYPES).refusal,
    'They already have this access.'
  );
});

test('a site-wide role grant adds its old group, its row flag and the group opening every Case list it works on', () => {
  assert.deepEqual(planGrant(role('controls'), [], CASE_TYPES).groups, [
    permissions.controls,
    roleFlagEntry('controls'),
    allCaseListGroups.write,
  ]);
  assert.deepEqual(planGrant(role('reviewer-manager'), [], CASE_TYPES).groups, [
    permissions.reviewerManager,
    roleFlagEntry('reviewerManager'),
    allCaseListGroups.read,
  ]);
});

test('a per-Case-Type grant with no Case Type is refused', () => {
  for (const spec of ACCESS_ROLES.filter((entry) => entry.perCaseType)) {
    assert.equal(
      planGrant(role(spec.id), [], CASE_TYPES).refusal,
      'Choose a Case Type.',
      spec.id
    );
  }
});

test('a Case Type Owner grant also gives the Reviewer access its list needs, and a Journey Owner the frontline list access', () => {
  const owner = planGrant(
    role('case-type-owner', COMPLAINTS.slug),
    [],
    CASE_TYPES
  ).groups;
  assert.deepEqual(owner, [
    `Reviewers - ${COMPLAINTS.displayName}`,
    permissions.reviewer,
    `CaseTypeOwner - ${COMPLAINTS.displayName}`,
    roleCaseTypeEntry('ownsCaseTypes', COMPLAINTS.slug),
    COMPLAINTS_WRITE,
  ]);
  const journey = planGrant(
    role('journey-owner', COMPLAINTS.slug),
    [],
    CASE_TYPES
  ).groups;
  assert.deepEqual(journey, [
    frontlineListAccessGroupName(COMPLAINTS.displayName),
    `JourneyOwner - ${COMPLAINTS.displayName}`,
    roleCaseTypeEntry('journeyOwnerOf', COMPLAINTS.slug),
    COMPLAINTS_WRITE,
  ]);
  assert.match(
    grantNote(role('case-type-owner', COMPLAINTS.slug), CASE_TYPES) ?? '',
    /Reviewer access to Complaints/
  );
  assert.equal(grantNote(role('controls'), CASE_TYPES), null);
});

test('removing a Reviewer keeps the shared Reviewers group while another Case Type still needs it', () => {
  const complaints = planGrant(
    role('reviewer', COMPLAINTS.slug),
    [],
    CASE_TYPES
  ).groups;
  const other = planGrant(role('reviewer', OTHER?.slug), [], CASE_TYPES).groups;
  const own = complaints.filter((part) => part !== permissions.reviewer);
  assert.deepEqual(
    planRevoke(
      role('reviewer', COMPLAINTS.slug),
      [...new Set([...complaints, ...other])],
      CASE_TYPES
    ),
    { groups: own, refusal: null }
  );
  assert.deepEqual(
    planRevoke(role('reviewer', COMPLAINTS.slug), complaints, CASE_TYPES)
      .groups,
    complaints,
    'the last Reviewer role takes the shared group with it'
  );
});

test('a Reviewer who is also a frontline party of the Case Type keeps its Case list Write group', () => {
  const held = [
    ...planGrant(role('reviewer', COMPLAINTS.slug), [], CASE_TYPES).groups,
    frontlineListAccessGroupName(COMPLAINTS.displayName),
  ];
  const { groups } = planRevoke(
    role('reviewer', COMPLAINTS.slug),
    held,
    CASE_TYPES
  );
  assert.ok(!groups.includes(COMPLAINTS_WRITE));
  assert.ok(groups.includes(roleCaseTypeEntry('reviews', COMPLAINTS.slug)));
});

test('a Reviewer role cannot be removed while the Case Type Owner role that needs it is held', () => {
  const held = planGrant(
    role('case-type-owner', COMPLAINTS.slug),
    [],
    CASE_TYPES
  ).groups;
  assert.deepEqual(
    planRevoke(role('reviewer', COMPLAINTS.slug), held, CASE_TYPES),
    { groups: [], refusal: 'Remove Case Type Owner for Complaints first.' }
  );
  assert.deepEqual(
    planRevoke(role('case-type-owner', COMPLAINTS.slug), held, CASE_TYPES)
      .groups,
    [
      `CaseTypeOwner - ${COMPLAINTS.displayName}`,
      roleCaseTypeEntry('ownsCaseTypes', COMPLAINTS.slug),
    ],
    'removing the owner role leaves the Reviewer access it was built on, and the Case list that opens'
  );
});

test('removing a Journey Owner never removes the frontline list access', () => {
  const held = planGrant(
    role('journey-owner', COMPLAINTS.slug),
    [],
    CASE_TYPES
  ).groups;
  assert.deepEqual(
    planRevoke(role('journey-owner', COMPLAINTS.slug), held, CASE_TYPES).groups,
    [
      `JourneyOwner - ${COMPLAINTS.displayName}`,
      roleCaseTypeEntry('journeyOwnerOf', COMPLAINTS.slug),
    ],
    'the frontline group stays, and so does the Case list it opens'
  );
});

test('a revoke plan never names a group the person does not hold', () => {
  for (const ref of allRoles(CASE_TYPES)) {
    for (const held of subsets(neighbourhood(ref))) {
      const { groups } = planRevoke(ref, held, CASE_TYPES);
      for (const group of groups) {
        assert.ok(held.includes(group), `${ref.id}: ${group} is not held`);
      }
    }
  }
});

test('a revoke plan for a role the person does not hold removes nothing', () => {
  assert.deepEqual(planRevoke(role('controls'), [], CASE_TYPES), {
    groups: [],
    refusal: 'They do not hold this access.',
  });
});

test('half-provisioned roles are flagged with what is missing', () => {
  const name = COMPLAINTS.displayName;
  const find = (
    /** @type {string[]} */ groups,
    /** @type {string} */ id,
    /** @type {string | null} */ caseType
  ) =>
    heldRoles(groups, CASE_TYPES).find(
      (held) => held.id === id && held.caseType === caseType
    );

  assert.deepEqual(find([`Reviewers - ${name}`], 'reviewer', COMPLAINTS.slug), {
    id: 'reviewer',
    caseType: COMPLAINTS.slug,
    complete: false,
    missing: [
      permissions.reviewer,
      roleCaseTypeEntry('reviews', COMPLAINTS.slug),
      COMPLAINTS_WRITE,
    ],
  });
  const owner = find(
    [`CaseTypeOwner - ${name}`],
    'case-type-owner',
    COMPLAINTS.slug
  );
  assert.equal(owner?.complete, false);
  assert.deepEqual(owner?.missing, [
    `Reviewers - ${name}`,
    permissions.reviewer,
    roleCaseTypeEntry('ownsCaseTypes', COMPLAINTS.slug),
    COMPLAINTS_WRITE,
  ]);
  assert.deepEqual(
    find([`JourneyOwner - ${name}`], 'journey-owner', COMPLAINTS.slug)?.missing,
    [
      frontlineListAccessGroupName(name),
      roleCaseTypeEntry('journeyOwnerOf', COMPLAINTS.slug),
      caseListGroupNames(name).write,
    ]
  );
});

test('a role held only through the row is held, and missing the old groups it is still made of', () => {
  const entry = roleCaseTypeEntry('reviews', COMPLAINTS.slug);
  const held = heldRoles([entry, COMPLAINTS_WRITE], CASE_TYPES);
  assert.deepEqual(held, [
    {
      id: 'reviewer',
      caseType: COMPLAINTS.slug,
      complete: false,
      missing: [`Reviewers - ${COMPLAINTS.displayName}`, permissions.reviewer],
    },
  ]);
  assert.deepEqual(
    planRevoke(held[0], [entry, COMPLAINTS_WRITE], CASE_TYPES).groups,
    [entry, COMPLAINTS_WRITE]
  );
});

test("the row's bare Reviewer flag alone is a Reviewer with no Case Type too", () => {
  const flag = roleFlagEntry('reviewer');
  assert.deepEqual(heldRoles([flag], CASE_TYPES), [
    { id: 'reviewer', caseType: null, complete: false, missing: [] },
  ]);
  assert.deepEqual(
    planRevoke(role('reviewer'), [flag, permissions.reviewer], CASE_TYPES)
      .groups,
    [permissions.reviewer, flag]
  );
});

test('the shared Reviewers group alone is a Reviewer with no Case Type, which can be removed but not completed', () => {
  const held = heldRoles([permissions.reviewer], CASE_TYPES);
  assert.deepEqual(held, [
    { id: 'reviewer', caseType: null, complete: false, missing: [] },
  ]);
  assert.equal(roleTitle(held[0], CASE_TYPES), 'Reviewer (no Case Type)');
  assert.deepEqual(planRevoke(held[0], [permissions.reviewer], CASE_TYPES), {
    groups: [permissions.reviewer],
    refusal: null,
  });
});

test('people holding nothing hold no roles, and a group outside the registry is ignored', () => {
  assert.deepEqual(heldRoles([], CASE_TYPES), []);
  assert.deepEqual(heldRoles(['Reviewers - Nowhere'], CASE_TYPES), []);
  assert.equal(
    planGrant(role('reviewer', 'nowhere'), [], CASE_TYPES).refusal,
    'Choose a Case Type.'
  );
});

test('each role names the old group and the row entry whose holders hold it', () => {
  assert.deepEqual(roleHolders(role('reviewer', COMPLAINTS.slug), CASE_TYPES), [
    `Reviewers - ${COMPLAINTS.displayName}`,
    roleCaseTypeEntry('reviews', COMPLAINTS.slug),
  ]);
  assert.deepEqual(roleHolders(role('reviewer-manager'), CASE_TYPES), [
    permissions.reviewerManager,
    roleFlagEntry('reviewerManager'),
  ]);
  assert.deepEqual(roleHolders(role('case-type-owner'), CASE_TYPES), []);
});

test('the copy speaks of roles and Case Types, never of groups', () => {
  const ref = role('reviewer', COMPLAINTS.slug);
  assert.deepEqual(describeChange('grant', ref, 'Alex', CASE_TYPES), {
    imperative: 'Give Alex Reviewer access to Complaints',
    past: 'Gave Alex Reviewer access to Complaints',
  });
  assert.equal(
    describeChange('revoke', ref, 'Alex', CASE_TYPES).imperative,
    "Remove Alex's Reviewer access to Complaints"
  );
  assert.equal(
    describeChange(
      'grant',
      role('case-type-owner', COMPLAINTS.slug),
      'Alex',
      CASE_TYPES
    ).imperative,
    'Make Alex Case Type Owner for Complaints'
  );
  assert.equal(
    describeChange(
      'grant',
      role('journey-owner', COMPLAINTS.slug),
      'Alex',
      CASE_TYPES
    ).imperative,
    'Make Alex Journey Owner for Complaints'
  );
  for (const entry of allRoles(CASE_TYPES)) {
    for (const action of /** @type {const} */ (['grant', 'revoke'])) {
      const { imperative, past } = describeChange(
        action,
        entry,
        'Alex',
        CASE_TYPES
      );
      for (const text of [imperative, past, roleTitle(entry, CASE_TYPES)]) {
        for (const group of UNIVERSE.filter(
          (name) => name.includes(' - ') || isRoleEntry(name)
        )) {
          assert.ok(!text.includes(group), text);
        }
      }
    }
  }
  assert.equal(
    describeChange('grant', role('mystery'), 'Alex', CASE_TYPES).imperative,
    'grant mystery for Alex',
    'an unknown role from the log still reads as something'
  );
});
