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
  holderGroup,
  planGrant,
  planRevoke,
  roleGroups,
  roleTitle,
} from '../src/services/access-roles.js';
import {
  frontlineListAccessGroupName,
  permissions,
  resolveCapabilities,
} from '../src/services/permissions.js';

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

/** Every group any role is made of, for the Case Types the suite has. */
const UNIVERSE = [
  ...new Set(
    allRoles(CASE_TYPES).flatMap((ref) => {
      const parts = roleGroups(ref, CASE_TYPES);
      return parts ? [...parts.groups, ...parts.requires] : [];
    })
  ),
];

/** @param {string[]} groups */
function* subsets(groups) {
  for (let mask = 0; mask < 1 << groups.length; mask += 1) {
    yield groups.filter((_, index) => mask & (1 << index));
  }
}

test('granting any role to a person with nothing shows the matching capability', () => {
  for (const ref of allRoles(CASE_TYPES)) {
    const { groups } = planGrant(ref, [], CASE_TYPES);
    const caps = resolveCapabilities(groups);
    const slug = ref.caseType ?? '';
    const shown = {
      reviewer: caps.listAccessCaseTypes.includes(slug) && caps.isReviewer,
      'reviewer-manager': caps.isReviewerManager,
      controls: caps.isControls,
      'case-type-owner': caps.ownedCaseTypes.includes(slug),
      'journey-owner': caps.ownedJourneyCaseTypes.includes(slug),
    }[/** @type {'reviewer'} */ (ref.id)];
    assert.equal(shown, true, `${ref.id} ${slug}`);
    assert.equal(
      caps.isMaintainer,
      false,
      `${ref.id} never makes a Maintainer`
    );
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

test('a Reviewer grant adds the Case Type group and the shared Reviewers group, only what is missing', () => {
  const ref = role('reviewer', COMPLAINTS.slug);
  assert.deepEqual(planGrant(ref, [], CASE_TYPES), {
    groups: [`Reviewers - ${COMPLAINTS.displayName}`, permissions.reviewer],
    refusal: null,
  });
  assert.deepEqual(planGrant(ref, [permissions.reviewer], CASE_TYPES).groups, [
    `Reviewers - ${COMPLAINTS.displayName}`,
  ]);
  assert.equal(
    planGrant(
      ref,
      [`Reviewers - ${COMPLAINTS.displayName}`, permissions.reviewer],
      CASE_TYPES
    ).refusal,
    'They already have this access.'
  );
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
  ]);
  const journey = planGrant(
    role('journey-owner', COMPLAINTS.slug),
    [],
    CASE_TYPES
  ).groups;
  assert.deepEqual(journey, [
    frontlineListAccessGroupName(COMPLAINTS.displayName),
    `JourneyOwner - ${COMPLAINTS.displayName}`,
  ]);
  assert.match(
    grantNote(role('case-type-owner', COMPLAINTS.slug), CASE_TYPES) ?? '',
    /Reviewer access to Complaints/
  );
  assert.equal(grantNote(role('controls'), CASE_TYPES), null);
});

test('removing a Reviewer keeps the shared Reviewers group while another Case Type still needs it', () => {
  const held = [
    `Reviewers - ${COMPLAINTS.displayName}`,
    `Reviewers - ${OTHER?.displayName}`,
    permissions.reviewer,
  ];
  assert.deepEqual(
    planRevoke(role('reviewer', COMPLAINTS.slug), held, CASE_TYPES),
    { groups: [`Reviewers - ${COMPLAINTS.displayName}`], refusal: null }
  );
  assert.deepEqual(
    planRevoke(
      role('reviewer', COMPLAINTS.slug),
      held.slice(0, 1).concat(permissions.reviewer),
      CASE_TYPES
    ).groups,
    [`Reviewers - ${COMPLAINTS.displayName}`, permissions.reviewer],
    'the last Reviewer role takes the shared group with it'
  );
});

test('a Reviewer role cannot be removed while the Case Type Owner role that needs it is held', () => {
  const held = [
    `Reviewers - ${COMPLAINTS.displayName}`,
    permissions.reviewer,
    `CaseTypeOwner - ${COMPLAINTS.displayName}`,
  ];
  assert.deepEqual(
    planRevoke(role('reviewer', COMPLAINTS.slug), held, CASE_TYPES),
    { groups: [], refusal: 'Remove Case Type Owner for Complaints first.' }
  );
  assert.deepEqual(
    planRevoke(role('case-type-owner', COMPLAINTS.slug), held, CASE_TYPES)
      .groups,
    [`CaseTypeOwner - ${COMPLAINTS.displayName}`],
    'removing the owner role leaves the Reviewer access it was built on'
  );
});

test('removing a Journey Owner never removes the frontline list access', () => {
  const frontline = frontlineListAccessGroupName(COMPLAINTS.displayName);
  const held = [frontline, `JourneyOwner - ${COMPLAINTS.displayName}`];
  assert.deepEqual(
    planRevoke(role('journey-owner', COMPLAINTS.slug), held, CASE_TYPES).groups,
    [`JourneyOwner - ${COMPLAINTS.displayName}`]
  );
});

test('a revoke plan never names a group the person does not hold', () => {
  for (const ref of allRoles(CASE_TYPES)) {
    for (const held of subsets(UNIVERSE)) {
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
    missing: [permissions.reviewer],
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
  ]);
  assert.deepEqual(
    find([`JourneyOwner - ${name}`], 'journey-owner', COMPLAINTS.slug)?.missing,
    [frontlineListAccessGroupName(name)]
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

test('each role names the group whose members hold it', () => {
  assert.equal(
    holderGroup(role('reviewer', COMPLAINTS.slug), CASE_TYPES),
    `Reviewers - ${COMPLAINTS.displayName}`
  );
  assert.equal(
    holderGroup(role('reviewer-manager'), CASE_TYPES),
    permissions.reviewerManager
  );
  assert.equal(holderGroup(role('case-type-owner'), CASE_TYPES), null);
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
        for (const group of UNIVERSE.filter((name) => name.includes(' - '))) {
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
