// @ts-check
import {
  caseTypeGroupNames,
  frontlineListAccessGroupName,
  permissions,
} from './permissions.js';

/** @typedef {{ slug: string, displayName: string }} CaseTypeRef */
/** @typedef {'reviewer' | 'reviewer-manager' | 'controls' | 'case-type-owner' | 'journey-owner'} AccessRoleId */

/**
 * One role a person holds or may be given: a role id and, for a per-Case-Type role, the Case Type slug.
 *
 * @typedef {{ id: AccessRoleId, caseType: string | null }} RoleRef
 */

/**
 * A role the person holds; `missing` counts the groups that would complete it, and a per-Case-Type role with no Case Type is an orphan.
 *
 * @typedef {RoleRef & { complete: boolean, missing: string[] }} HeldRole
 */

/**
 * The groups a role is made of: `groups` are added on a grant and removed on a revoke, `requires` are only ever added.
 *
 * @typedef {{ groups: string[], requires: string[] }} RoleGroups
 */

/**
 * @typedef {{
 *   id: AccessRoleId,
 *   label: string,
 *   perCaseType: boolean,
 *   groups: (caseType: CaseTypeRef) => string[],
 *   requires: (caseType: CaseTypeRef) => string[],
 *   grantNote?: (caseType: string) => string,
 * }} RoleSpec
 */

/** @param {CaseTypeRef} caseType */
const reviewerGroups = (caseType) => [
  caseTypeGroupNames(caseType.displayName).listAccess,
  permissions.reviewer,
];

// The internal roles a Maintainer may grant; the Maintainer and frontline roles are deliberately absent.
/** @type {readonly RoleSpec[]} */
const SPECS = [
  {
    id: 'reviewer',
    label: 'Reviewer',
    perCaseType: true,
    groups: reviewerGroups,
    requires: () => [],
  },
  {
    id: 'reviewer-manager',
    label: 'Reviewer Manager',
    perCaseType: false,
    groups: () => [permissions.reviewerManager],
    requires: () => [],
  },
  {
    id: 'controls',
    label: 'Controls',
    perCaseType: false,
    groups: () => [permissions.controls],
    requires: () => [],
  },
  {
    id: 'case-type-owner',
    label: 'Case Type Owner',
    perCaseType: true,
    groups: (caseType) => [
      caseTypeGroupNames(caseType.displayName).caseTypeOwner,
    ],
    // The owner group is not a list ACL, so reading the list needs Reviewer access as well.
    requires: reviewerGroups,
    grantNote: (caseType) =>
      `Also gives Reviewer access to ${caseType} when that is missing.`,
  },
  {
    id: 'journey-owner',
    label: 'Journey Owner',
    perCaseType: true,
    groups: (caseType) => [
      caseTypeGroupNames(caseType.displayName).journeyOwner,
    ],
    // Frontline provisioning owns this group, so a revoke never takes it away.
    requires: (caseType) => [
      frontlineListAccessGroupName(caseType.displayName),
    ],
    grantNote: (caseType) =>
      `Also gives frontline access to ${caseType} Cases when that is missing.`,
  },
];

/** @type {readonly { id: AccessRoleId, label: string, perCaseType: boolean }[]} */
export const ACCESS_ROLES = SPECS.map(({ id, label, perCaseType }) => ({
  id,
  label,
  perCaseType,
}));

/**
 * @param {AccessRoleId | string} id
 * @returns {RoleSpec | undefined}
 */
function specFor(id) {
  return SPECS.find((spec) => spec.id === id);
}

/**
 * @param {RoleRef} role
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {CaseTypeRef | null | undefined} `undefined` when the role names a Case Type this application does not have
 */
function caseTypeOf(role, caseTypes) {
  if (role.caseType === null) return null;
  return caseTypes.find((caseType) => caseType.slug === role.caseType);
}

/**
 * The groups a role is made of, or `null` when the role is not one this page can manage.
 *
 * @param {RoleRef} role
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {RoleGroups | null}
 */
export function roleGroups(role, caseTypes) {
  const spec = specFor(role.id);
  const caseType = caseTypeOf(role, caseTypes);
  if (!spec || caseType === undefined) return null;
  // A Reviewer with no Case Type is only the site-wide group, which opens no list.
  if (caseType === null && role.id === 'reviewer') {
    return { groups: [permissions.reviewer], requires: [] };
  }
  // A role must name a Case Type exactly when it is per Case Type.
  if ((caseType === null) === spec.perCaseType) return null;
  const forCaseType = /** @type {CaseTypeRef} */ (caseType);
  return {
    groups: spec.groups(forCaseType),
    requires: spec.requires(forCaseType),
  };
}

/**
 * Every role a person could hold: each site-wide role once, each per-Case-Type role once per Case Type.
 *
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {RoleRef[]}
 */
export function allRoles(caseTypes) {
  return SPECS.flatMap(
    (spec) =>
      /** @type {RoleRef[]} */ (
        spec.perCaseType
          ? caseTypes.map((caseType) => ({
              id: spec.id,
              caseType: caseType.slug,
            }))
          : [{ id: spec.id, caseType: null }]
      )
  );
}

/**
 * The group whose members hold a role, which is also how a person is found to hold it.
 *
 * @param {RoleRef} role
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {string | null}
 */
export function holderGroup(role, caseTypes) {
  return roleGroups(role, caseTypes)?.groups[0] ?? null;
}

/**
 * The groups of a role `heldRoles` found, which is always one `roleGroups` can describe.
 *
 * @param {RoleRef} held
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {RoleGroups}
 */
function heldParts(held, caseTypes) {
  return /** @type {RoleGroups} */ (roleGroups(held, caseTypes));
}

/**
 * @param {RoleRef} a
 * @param {RoleRef} b
 */
const sameRole = (a, b) => a.id === b.id && a.caseType === b.caseType;

/**
 * The roles a person holds, read off their groups, each flagged when it is only half provisioned.
 *
 * @param {readonly string[]} personGroups
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {HeldRole[]}
 */
export function heldRoles(personGroups, caseTypes) {
  const has = (/** @type {string} */ group) => personGroups.includes(group);
  /** @type {HeldRole[]} */
  const held = [];
  for (const role of allRoles(caseTypes)) {
    const parts = roleGroups(role, caseTypes);
    if (!parts || !has(parts.groups[0])) continue;
    const missing = [...parts.requires, ...parts.groups].filter(
      (group) => !has(group)
    );
    held.push({ ...role, complete: missing.length === 0, missing });
  }
  const hasCaseTypeReviewer = held.some(
    (role) => role.id === 'reviewer' && role.caseType !== null
  );
  if (has(permissions.reviewer) && !hasCaseTypeReviewer) {
    held.push({ id: 'reviewer', caseType: null, complete: false, missing: [] });
  }
  return held;
}

/**
 * @param {RoleRef} role
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {string}
 */
function caseTypeNameOf(role, caseTypes) {
  return caseTypeOf(role, caseTypes)?.displayName ?? role.caseType ?? '';
}

/**
 * What giving a role would add, or why it cannot be given.
 *
 * @param {RoleRef} role
 * @param {readonly string[]} personGroups
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {{ groups: string[], refusal: string | null }}
 */
export function planGrant(role, personGroups, caseTypes) {
  const parts = roleGroups(role, caseTypes);
  if (!parts || (specFor(role.id)?.perCaseType && role.caseType === null)) {
    return { groups: [], refusal: 'Choose a Case Type.' };
  }
  const groups = [...parts.requires, ...parts.groups].filter(
    (group) => !personGroups.includes(group)
  );
  return groups.length === 0
    ? { groups, refusal: 'They already have this access.' }
    : { groups, refusal: null };
}

/**
 * What taking a role away would remove, keeping any group another held role still needs.
 *
 * @param {RoleRef} role
 * @param {readonly string[]} personGroups
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {{ groups: string[], refusal: string | null }}
 */
export function planRevoke(role, personGroups, caseTypes) {
  const parts = roleGroups(role, caseTypes);
  const others = heldRoles(personGroups, caseTypes).filter(
    (held) => !sameRole(held, role)
  );
  if (!parts || !personGroups.includes(parts.groups[0])) {
    return { groups: [], refusal: 'They do not hold this access.' };
  }
  const dependent = others.find((held) => {
    if (held.caseType !== role.caseType) return false;
    const theirs = heldParts(held, caseTypes);
    return theirs.requires.some((group) => parts.groups.includes(group));
  });
  if (dependent) {
    const spec = specFor(dependent.id);
    const caseTypeName = caseTypeNameOf(dependent, caseTypes);
    return {
      groups: [],
      refusal: `Remove ${spec?.label} for ${caseTypeName} first.`,
    };
  }
  const neededElsewhere = new Set(
    others.flatMap((held) => {
      const theirs = heldParts(held, caseTypes);
      return [...theirs.groups, ...theirs.requires];
    })
  );
  return {
    groups: parts.groups.filter(
      (group) => personGroups.includes(group) && !neededElsewhere.has(group)
    ),
    refusal: null,
  };
}

/**
 * The role as a heading reads it, for example `Reviewer, Complaints`.
 *
 * @param {RoleRef} role
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {string}
 */
export function roleTitle(role, caseTypes) {
  const label = specFor(role.id)?.label ?? role.id;
  if (role.caseType === null) {
    return specFor(role.id)?.perCaseType ? `${label} (no Case Type)` : label;
  }
  return `${label}, ${caseTypeNameOf(role, caseTypes)}`;
}

/**
 * A line saying what a grant will also give, or `null` when it gives nothing extra.
 *
 * @param {RoleRef} role
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {string | null}
 */
export function grantNote(role, caseTypes) {
  return specFor(role.id)?.grantNote?.(caseTypeNameOf(role, caseTypes)) ?? null;
}

/**
 * The change in role language, as the instruction and as what was done.
 *
 * @param {'grant' | 'revoke'} action
 * @param {RoleRef} role
 * @param {string} personName
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {{ imperative: string, past: string }}
 */
export function describeChange(action, role, personName, caseTypes) {
  const caseTypeName = caseTypeNameOf(role, caseTypes);
  const to = caseTypeName ? ` to ${caseTypeName}` : '';
  const forType = caseTypeName ? ` for ${caseTypeName}` : '';
  const who = personName;
  /** @type {Record<AccessRoleId, { grant: [string, string], revoke: [string, string] }>} */
  const phrases = {
    reviewer: {
      grant: [
        `Give ${who} Reviewer access${to}`,
        `Gave ${who} Reviewer access${to}`,
      ],
      revoke: [
        `Remove ${who}'s Reviewer access${to}`,
        `Removed ${who}'s Reviewer access${to}`,
      ],
    },
    'reviewer-manager': {
      grant: [
        `Make ${who} a Reviewer Manager`,
        `Made ${who} a Reviewer Manager`,
      ],
      revoke: [
        `Remove ${who} as a Reviewer Manager`,
        `Removed ${who} as a Reviewer Manager`,
      ],
    },
    controls: {
      grant: [`Give ${who} Controls access`, `Gave ${who} Controls access`],
      revoke: [
        `Remove ${who}'s Controls access`,
        `Removed ${who}'s Controls access`,
      ],
    },
    'case-type-owner': {
      grant: [
        `Make ${who} Case Type Owner${forType}`,
        `Made ${who} Case Type Owner${forType}`,
      ],
      revoke: [
        `Remove ${who} as Case Type Owner${forType}`,
        `Removed ${who} as Case Type Owner${forType}`,
      ],
    },
    'journey-owner': {
      grant: [
        `Make ${who} Journey Owner${forType}`,
        `Made ${who} Journey Owner${forType}`,
      ],
      revoke: [
        `Remove ${who} as Journey Owner${forType}`,
        `Removed ${who} as Journey Owner${forType}`,
      ],
    },
  };
  const [imperative, past] = phrases[role.id]?.[action] ?? [
    `${action} ${role.id} for ${who}`,
    `${action} ${role.id} for ${who}`,
  ];
  return { imperative, past };
}
