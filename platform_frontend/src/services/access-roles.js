// @ts-check
import {
  allCaseListGroups,
  caseListGroupNames,
  caseTypeGroupNames,
  frontlineListAccessGroupName,
  permissions,
} from './permissions.js';
import { roleCaseTypeEntry, roleFlagEntry } from './user-roles.js';

/** @typedef {{ slug: string, displayName: string }} CaseTypeRef */
/** @typedef {'reviewer' | 'reviewer-manager' | 'controls' | 'case-type-owner' | 'journey-owner'} AccessRoleId */

/**
 * One role a person holds or may be given: a role id and, for a per-Case-Type role, the Case Type slug.
 *
 * @typedef {{ id: AccessRoleId, caseType: string | null }} RoleRef
 */

/**
 * A role the person holds; `missing` counts the parts that would complete it, and a per-Case-Type role with no Case Type is an orphan.
 *
 * @typedef {RoleRef & { complete: boolean, missing: string[] }} HeldRole
 */

/**
 * What a role is made of. Each part is a group or a role entry of the person's
 * `CoraUserRoles` row, and the two are planned together as one list: `parts`
 * are added on a grant and removed on a revoke, `requires` are only ever
 * added, and holding any one of `holders` is what holding the role means.
 *
 * @typedef {{ parts: string[], requires: string[], holders: string[] }} RoleParts
 */

/**
 * @typedef {{
 *   id: AccessRoleId,
 *   label: string,
 *   perCaseType: boolean,
 *   parts: (caseType: CaseTypeRef) => RoleParts,
 *   grantNote?: (caseType: string) => string,
 * }} RoleSpec
 */

// While the roles move from groups to the roles row, a role is held through
// either and given through both, so each part list leads with the old group
// and its row entry — the two ways a person can be found to hold it — and then
// names the new Case list group that opens what the role works on.

/** @param {CaseTypeRef} caseType */
const legacyReviewerGroups = (caseType) => [
  caseTypeGroupNames(caseType.displayName).listAccess,
  permissions.reviewer,
];

/** @param {CaseTypeRef} caseType */
const caseListWrite = (caseType) =>
  caseListGroupNames(caseType.displayName).write;

// The internal roles a Maintainer may grant; the Maintainer and frontline roles are deliberately absent.
/** @type {readonly RoleSpec[]} */
const SPECS = [
  {
    id: 'reviewer',
    label: 'Reviewer',
    perCaseType: true,
    parts: (caseType) => {
      const entry = roleCaseTypeEntry('reviews', caseType.slug);
      return {
        parts: [
          ...legacyReviewerGroups(caseType),
          entry,
          caseListWrite(caseType),
        ],
        requires: [],
        holders: [caseTypeGroupNames(caseType.displayName).listAccess, entry],
      };
    },
  },
  {
    id: 'reviewer-manager',
    label: 'Reviewer Manager',
    perCaseType: false,
    parts: () =>
      siteWide(
        permissions.reviewerManager,
        'reviewerManager',
        allCaseListGroups.read
      ),
  },
  {
    id: 'controls',
    label: 'Controls',
    perCaseType: false,
    parts: () =>
      siteWide(permissions.controls, 'controls', allCaseListGroups.write),
  },
  {
    id: 'case-type-owner',
    label: 'Case Type Owner',
    perCaseType: true,
    parts: (caseType) => {
      const group = caseTypeGroupNames(caseType.displayName).caseTypeOwner;
      const entry = roleCaseTypeEntry('ownsCaseTypes', caseType.slug);
      return {
        parts: [group, entry, caseListWrite(caseType)],
        // The old owner group opens no list, so reading it through the old
        // groups needs Reviewer access as well.
        requires: legacyReviewerGroups(caseType),
        holders: [group, entry],
      };
    },
    grantNote: (caseType) =>
      `Also gives Reviewer access to ${caseType} when that is missing.`,
  },
  {
    id: 'journey-owner',
    label: 'Journey Owner',
    perCaseType: true,
    parts: (caseType) => {
      const group = caseTypeGroupNames(caseType.displayName).journeyOwner;
      const entry = roleCaseTypeEntry('journeyOwnerOf', caseType.slug);
      return {
        parts: [group, entry, caseListWrite(caseType)],
        // Frontline provisioning owns this group, so a revoke never takes it away.
        requires: [frontlineListAccessGroupName(caseType.displayName)],
        holders: [group, entry],
      };
    },
    grantNote: (caseType) =>
      `Also gives frontline access to ${caseType} Cases when that is missing.`,
  },
];

/**
 * A site-wide role: its old group, its yes/no column, and the group opening every Case list it reads.
 *
 * @param {string} group
 * @param {import('./user-roles.js').RoleFlag} flag
 * @param {string} allCasesGroup
 * @returns {RoleParts}
 */
function siteWide(group, flag, allCasesGroup) {
  const entry = roleFlagEntry(flag);
  return {
    parts: [group, entry, allCasesGroup],
    requires: [],
    holders: [group, entry],
  };
}

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
 * What a role is made of, or `null` when the role is not one this page can manage.
 *
 * @param {RoleRef} role
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {RoleParts | null}
 */
export function roleParts(role, caseTypes) {
  const spec = specFor(role.id);
  const caseType = caseTypeOf(role, caseTypes);
  if (!spec || caseType === undefined) return null;
  // A Reviewer with no Case Type is only the site-wide group or flag, which opens no list.
  if (caseType === null && role.id === 'reviewer') {
    const entry = roleFlagEntry('reviewer');
    return {
      parts: [permissions.reviewer, entry],
      requires: [],
      holders: [permissions.reviewer, entry],
    };
  }
  // A role must name a Case Type exactly when it is per Case Type.
  if ((caseType === null) === spec.perCaseType) return null;
  return spec.parts(/** @type {CaseTypeRef} */ (caseType));
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
 * The groups and role entries whose holders hold a role, which is also how a person is found to hold it.
 *
 * @param {RoleRef} role
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {string[]}
 */
export function roleHolders(role, caseTypes) {
  return roleParts(role, caseTypes)?.holders ?? [];
}

/**
 * The parts of a role `heldRoles` found, which is always one `roleParts` can describe.
 *
 * @param {RoleRef} held
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {RoleParts}
 */
function heldParts(held, caseTypes) {
  return /** @type {RoleParts} */ (roleParts(held, caseTypes));
}

/**
 * @param {RoleRef} a
 * @param {RoleRef} b
 */
const sameRole = (a, b) => a.id === b.id && a.caseType === b.caseType;

/**
 * The roles a person holds, read off their groups and role entries, each flagged when it is only half provisioned.
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
    const parts = roleParts(role, caseTypes);
    if (!parts || !parts.holders.some(has)) continue;
    const missing = [...parts.requires, ...parts.parts].filter(
      (group) => !has(group)
    );
    held.push({ ...role, complete: missing.length === 0, missing });
  }
  const hasCaseTypeReviewer = held.some(
    (role) => role.id === 'reviewer' && role.caseType !== null
  );
  const orphanReviewer = /** @type {RoleParts} */ (
    roleParts({ id: 'reviewer', caseType: null }, caseTypes)
  );
  if (orphanReviewer.holders.some(has) && !hasCaseTypeReviewer) {
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
  const parts = roleParts(role, caseTypes);
  if (!parts || (specFor(role.id)?.perCaseType && role.caseType === null)) {
    return { groups: [], refusal: 'Choose a Case Type.' };
  }
  const groups = [...parts.requires, ...parts.parts].filter(
    (group) => !personGroups.includes(group)
  );
  return groups.length === 0
    ? { groups, refusal: 'They already have this access.' }
    : { groups, refusal: null };
}

/**
 * What taking a role away would remove, keeping any part another held role
 * still needs. A frontline party of a Case Type is given its Case list's Write
 * group by the notifications pipeline, not by this page, so a person who holds
 * that type's frontline group keeps the Write group too.
 *
 * @param {RoleRef} role
 * @param {readonly string[]} personGroups
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {{ groups: string[], refusal: string | null }}
 */
export function planRevoke(role, personGroups, caseTypes) {
  const parts = roleParts(role, caseTypes);
  const others = heldRoles(personGroups, caseTypes).filter(
    (held) => !sameRole(held, role)
  );
  if (!parts || !parts.holders.some((part) => personGroups.includes(part))) {
    return { groups: [], refusal: 'They do not hold this access.' };
  }
  const dependent = others.find((held) => {
    if (held.caseType !== role.caseType) return false;
    const theirs = heldParts(held, caseTypes);
    return theirs.requires.some((group) => parts.parts.includes(group));
  });
  if (dependent) {
    const spec = specFor(dependent.id);
    const caseTypeName = caseTypeNameOf(dependent, caseTypes);
    return {
      groups: [],
      refusal: `Remove ${spec?.label} for ${caseTypeName} first.`,
    };
  }
  const neededElsewhere = new Set([
    ...others.flatMap((held) => {
      const theirs = heldParts(held, caseTypes);
      return [...theirs.parts, ...theirs.requires];
    }),
    ...caseTypes
      .filter((caseType) =>
        personGroups.includes(
          frontlineListAccessGroupName(caseType.displayName)
        )
      )
      .map(caseListWrite),
  ]);
  return {
    groups: parts.parts.filter(
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
