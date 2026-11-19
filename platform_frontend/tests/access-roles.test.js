// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCESS_ROLES,
  allRoles,
  describeChange,
  heldRoles,
  planGrant,
  planRevoke,
  roleHolder,
  roleParts,
  roleTitle,
} from '../src/services/access-roles.js';
import {
  allCaseListGroups,
  caseListGroupNames,
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
const partsOf = (ref) => roleParts(ref, CASE_TYPES)?.parts ?? [];

/** Every group and role entry any role is made of, for the Case Types the suite has. */
const UNIVERSE = [...new Set(allRoles(CASE_TYPES).flatMap(partsOf))];

/**
 * Everything a role could share a part with: the parts of every role on the
 * same Case Type, or of the site-wide roles, plus the bare Reviewer and
 * Adviser flags. Small enough to try every combination of.
 *
 * @param {import('../src/services/access-roles.js').RoleRef} ref
 */
const neighbourhood = (ref) => [
  ...new Set([
    ...allRoles(CASE_TYPES)
      .filter((other) => other.caseType === ref.caseType)
      .flatMap(partsOf),
    roleFlagEntry('reviewer'),
    roleFlagEntry('adviser'),
  ]),
];

const COMPLAINTS_WRITE = caseListGroupNames(COMPLAINTS.displayName).write;
const REVIEWS = roleCaseTypeEntry('reviews', COMPLAINTS.slug);
const OWNS = roleCaseTypeEntry('ownsCaseTypes', COMPLAINTS.slug);
const JOURNEY = roleCaseTypeEntry('journeyOwnerOf', COMPLAINTS.slug);

/** @param {string[]} groups */
function* subsets(groups) {
  for (let mask = 0; mask < 1 << groups.length; mask += 1) {
    yield groups.filter((_, index) => mask & (1 << index));
  }
}

test('granting any role to a person with nothing shows the matching capability, and reads back complete', () => {
  for (const ref of allRoles(CASE_TYPES)) {
    const { groups } = planGrant(ref, [], CASE_TYPES);
    const slug = ref.caseType ?? '';
    const caps = resolveCapabilities(
      groups.filter((part) => !isRoleEntry(part)),
      permissions,
      withRoleEntries(noRoles(), { add: groups.filter(isRoleEntry) })
    );
    const shown = {
      reviewer: caps.listAccessCaseTypes.includes(slug) && caps.isReviewer,
      'reviewer-manager': caps.isReviewerManager,
      controls: caps.isControls,
      'case-type-owner': caps.ownedCaseTypes.includes(slug),
      'journey-owner': caps.ownedJourneyCaseTypes.includes(slug),
      'can-search-cases': caps.canSearchCases && !caps.isControls,
      'can-change-outcome': caps.canChangeOutcome && !caps.isControls,
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

test('the roles on offer are the internal ones, and none gives the Maintainer or a frontline role', () => {
  const offered = ACCESS_ROLES.map((entry) => entry.id).sort();
  assert.deepEqual(offered, [
    'can-change-outcome',
    'can-search-cases',
    'case-type-owner',
    'controls',
    'journey-owner',
    'reviewer',
    'reviewer-manager',
  ]);
  const forbidden = [
    permissions.maintainer,
    roleFlagEntry('adviser'),
    roleFlagEntry('responsiblePartyManager'),
  ];
  for (const ref of allRoles(CASE_TYPES)) {
    const groups = planGrant(ref, [], CASE_TYPES).groups;
    for (const group of forbidden) assert.ok(!groups.includes(group), group);
  }
});

test('a per-type role grant adds its row entry and the Case list Write group, only what is missing', () => {
  for (const [id, entry] of [
    ['reviewer', REVIEWS],
    ['case-type-owner', OWNS],
    ['journey-owner', JOURNEY],
  ]) {
    const ref = role(id, COMPLAINTS.slug);
    assert.deepEqual(planGrant(ref, [], CASE_TYPES), {
      groups: [entry, COMPLAINTS_WRITE],
      refusal: null,
    });
    assert.deepEqual(
      planGrant(ref, [COMPLAINTS_WRITE], CASE_TYPES).groups,
      [entry],
      `${id}: a Case list already open is not opened again`
    );
    assert.equal(
      planGrant(ref, [entry, COMPLAINTS_WRITE], CASE_TYPES).refusal,
      'They already have this access.'
    );
  }
});

test('a site-wide role grant adds its row flag and the group opening every Case list it works on', () => {
  assert.deepEqual(planGrant(role('controls'), [], CASE_TYPES).groups, [
    roleFlagEntry('controls'),
    allCaseListGroups.write,
  ]);
  assert.deepEqual(planGrant(role('reviewer-manager'), [], CASE_TYPES).groups, [
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

test('removing one role on a Case Type keeps its Case list open while another role there still needs it', () => {
  const held = [REVIEWS, OWNS, COMPLAINTS_WRITE];
  assert.deepEqual(
    planRevoke(role('reviewer', COMPLAINTS.slug), held, CASE_TYPES),
    { groups: [REVIEWS], refusal: null }
  );
  assert.deepEqual(
    planRevoke(
      role('reviewer', COMPLAINTS.slug),
      [REVIEWS, COMPLAINTS_WRITE],
      CASE_TYPES
    ).groups,
    [REVIEWS, COMPLAINTS_WRITE],
    'the last role on the Case Type closes its list'
  );
});

test('a Case Type Owner can be removed as a Reviewer without losing the list they own', () => {
  const held = [REVIEWS, OWNS, COMPLAINTS_WRITE];
  assert.equal(
    planRevoke(role('reviewer', COMPLAINTS.slug), held, CASE_TYPES).refusal,
    null
  );
  assert.deepEqual(
    planRevoke(role('case-type-owner', COMPLAINTS.slug), held, CASE_TYPES)
      .groups,
    [OWNS]
  );
});

test('an Adviser keeps every Case list Write group they hold, which the notifications pipeline gave them', () => {
  const held = [REVIEWS, COMPLAINTS_WRITE, roleFlagEntry('adviser')];
  assert.deepEqual(
    planRevoke(role('reviewer', COMPLAINTS.slug), held, CASE_TYPES).groups,
    [REVIEWS]
  );
});

test('a revoke plan never names a part the person does not hold', () => {
  for (const ref of allRoles(CASE_TYPES)) {
    for (const held of subsets(neighbourhood(ref))) {
      const { groups } = planRevoke(ref, held, CASE_TYPES);
      for (const group of groups) {
        assert.ok(held.includes(group), `${ref.id}: ${group} is not held`);
      }
    }
  }
});

test('a revoke plan for a role the person does not hold removes nothing, even with its list open', () => {
  assert.deepEqual(planRevoke(role('controls'), [], CASE_TYPES), {
    groups: [],
    refusal: 'They do not hold this access.',
  });
  assert.equal(
    planRevoke(
      role('reviewer', COMPLAINTS.slug),
      [COMPLAINTS_WRITE],
      CASE_TYPES
    ).refusal,
    'They do not hold this access.'
  );
});

test('a role whose Case list is not open is flagged with what is missing', () => {
  assert.deepEqual(heldRoles([REVIEWS], CASE_TYPES), [
    {
      id: 'reviewer',
      caseType: COMPLAINTS.slug,
      complete: false,
      missing: [COMPLAINTS_WRITE],
    },
  ]);
  assert.deepEqual(heldRoles([roleFlagEntry('controls')], CASE_TYPES), [
    {
      id: 'controls',
      caseType: null,
      complete: false,
      missing: [allCaseListGroups.write],
    },
  ]);
});

test('an open Case list alone, or an old role group, is no role at all', () => {
  for (const group of [
    COMPLAINTS_WRITE,
    allCaseListGroups.write,
    `Reviewers - ${COMPLAINTS.displayName}`,
    `CaseTypeOwner - ${COMPLAINTS.displayName}`,
    'Controls',
    'Reviewers',
  ]) {
    assert.deepEqual(heldRoles([group], CASE_TYPES), [], group);
  }
});

test("the row's bare Reviewer flag alone is a Reviewer with no Case Type, which can be removed but not completed", () => {
  const flag = roleFlagEntry('reviewer');
  const held = heldRoles([flag], CASE_TYPES);
  assert.deepEqual(held, [
    { id: 'reviewer', caseType: null, complete: false, missing: [] },
  ]);
  assert.equal(roleTitle(held[0], CASE_TYPES), 'Reviewer (no Case Type)');
  assert.deepEqual(planRevoke(held[0], [flag], CASE_TYPES), {
    groups: [flag],
    refusal: null,
  });
});

test('people holding nothing hold no roles, and a Case Type outside the registry is ignored', () => {
  assert.deepEqual(heldRoles([], CASE_TYPES), []);
  assert.deepEqual(
    heldRoles([roleCaseTypeEntry('reviews', 'nowhere')], CASE_TYPES),
    []
  );
  assert.equal(
    planGrant(role('reviewer', 'nowhere'), [], CASE_TYPES).refusal,
    'Choose a Case Type.'
  );
});

test('each role names the row entry whose holders hold it', () => {
  assert.equal(
    roleHolder(role('reviewer', COMPLAINTS.slug), CASE_TYPES),
    REVIEWS
  );
  assert.equal(
    roleHolder(role('reviewer-manager'), CASE_TYPES),
    roleFlagEntry('reviewerManager')
  );
  assert.equal(roleHolder(role('case-type-owner'), CASE_TYPES), null);
});

test('the copy speaks of roles and Case Types, never of groups or row entries', () => {
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
        for (const part of UNIVERSE) {
          assert.ok(!text.includes(part), text);
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

test('taking a permission away from somebody who is also Controls keeps the all-lists group Controls needs', () => {
  const held = [
    roleFlagEntry('controls'),
    roleFlagEntry('canChangeOutcome'),
    'CORA All Cases Write',
  ];
  assert.deepEqual(
    planRevoke({ id: 'can-change-outcome', caseType: null }, held, CASE_TYPES)
      .groups,
    [roleFlagEntry('canChangeOutcome')]
  );
});
