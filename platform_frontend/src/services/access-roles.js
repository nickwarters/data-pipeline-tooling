// @ts-check
import { allCaseListGroups, caseListGroupNames } from './permissions.js';
import { roleCaseTypeEntry, roleFlagEntry } from './user-roles.js';

/** @typedef {{ slug: string, displayName: string }} CaseTypeRef */
/** @typedef {'reviewer' | 'reviewer-manager' | 'controls' | 'case-type-owner' | 'journey-owner' | 'can-search-cases' | 'can-change-outcome'} AccessRoleId */

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
 * What a role is made of: the role entry of the person's `CoraUserRoles` row
 * that says they hold it, and the group that opens the Case lists it works
 * on. The two are planned together as one list, `parts`, which a grant adds
 * and a revoke removes; holding `entry` is what holding the role means.
 *
 * @typedef {{ entry: string, parts: string[] }} RoleParts
 */

/**
 * @typedef {{
 *   id: AccessRoleId,
 *   label: string,
 *   perCaseType: boolean,
 *   parts: (caseType: CaseTypeRef) => RoleParts,
 * }} RoleSpec
 */

/** @param {CaseTypeRef} caseType */
const caseListWrite = (caseType) =>
  caseListGroupNames(caseType.displayName).write;

/**
 * A role held in a row entry, and the group that opens the lists it needs.
 *
 * @param {string} entry
 * @param {string} accessGroup
 * @returns {RoleParts}
 */
const made = (entry, accessGroup) => ({ entry, parts: [entry, accessGroup] });

// The internal roles a Maintainer may grant; the Maintainer and frontline roles are deliberately absent.
/** @type {readonly RoleSpec[]} */
const SPECS = [
  {
    id: 'reviewer',
    label: 'Reviewer',
    perCaseType: true,
    parts: (caseType) =>
      made(
        roleCaseTypeEntry('reviews', caseType.slug),
        caseListWrite(caseType)
      ),
  },
  {
    id: 'reviewer-manager',
    label: 'Reviewer Manager',
    perCaseType: false,
    parts: () => made(roleFlagEntry('reviewerManager'), allCaseListGroups.read),
  },
  {
    id: 'controls',
    label: 'Controls',
    perCaseType: false,
    parts: () => made(roleFlagEntry('controls'), allCaseListGroups.write),
  },
  {
    id: 'case-type-owner',
    label: 'Case Type Owner',
    perCaseType: true,
    // An owner reads and writes their own Case Type's list without being one
    // of its Reviewers.
    parts: (caseType) =>
      made(
        roleCaseTypeEntry('ownsCaseTypes', caseType.slug),
        caseListWrite(caseType)
      ),
  },
  {
    id: 'journey-owner',
    label: 'Journey Owner',
    perCaseType: true,
    parts: (caseType) =>
      made(
        roleCaseTypeEntry('journeyOwnerOf', caseType.slug),
        caseListWrite(caseType)
      ),
  },
  // Two things Controls can do, each grantable alone. A search reads every
  // Case list; changing an Outcome writes to the Case it is on, which may be
  // of any Case Type.
  {
    id: 'can-search-cases',
    label: 'Search all Cases',
    perCaseType: false,
    parts: () => made(roleFlagEntry('canSearchCases'), allCaseListGroups.read),
  },
  {
    id: 'can-change-outcome',
    label: 'Change an Outcome',
    perCaseType: false,
    parts: () =>
      made(roleFlagEntry('canChangeOutcome'), allCaseListGroups.write),
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
  // A Reviewer with no Case Type is only the row's bare flag, which opens no list.
  if (caseType === null && role.id === 'reviewer') {
    const entry = roleFlagEntry('reviewer');
    return { entry, parts: [entry] };
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
 * The role entry whose holders hold a role, or `null` for a role this page cannot manage.
 *
 * @param {RoleRef} role
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {string | null}
 */
export function roleHolder(role, caseTypes) {
  return roleParts(role, caseTypes)?.entry ?? null;
}

/**
 * @param {RoleRef} a
 * @param {RoleRef} b
 */
const sameRole = (a, b) => a.id === b.id && a.caseType === b.caseType;

/**
 * The roles a person holds, read off their role entries, each flagged when the group it needs is missing.
 *
 * @param {readonly string[]} personGroups
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {HeldRole[]}
 */
export function heldRoles(personGroups, caseTypes) {
  const has = (/** @type {string} */ part) => personGroups.includes(part);
  /** @type {HeldRole[]} */
  const held = [];
  for (const role of allRoles(caseTypes)) {
    const parts = roleParts(role, caseTypes);
    if (!parts || !has(parts.entry)) continue;
    const missing = parts.parts.filter((part) => !has(part));
    held.push({ ...role, complete: missing.length === 0, missing });
  }
  const hasCaseTypeReviewer = held.some(
    (role) => role.id === 'reviewer' && role.caseType !== null
  );
  if (has(roleFlagEntry('reviewer')) && !hasCaseTypeReviewer) {
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
  const groups = parts.parts.filter((part) => !personGroups.includes(part));
  return groups.length === 0
    ? { groups, refusal: 'They already have this access.' }
    : { groups, refusal: null };
}

/**
 * What taking a role away would remove, keeping any group another held role
 * still needs. An **Adviser** is given the Case list Write groups of the Case
 * Types they are a frontline party on by the notifications pipeline, not by
 * this page, so an Adviser keeps every Case list Write group they hold.
 *
 * @param {RoleRef} role
 * @param {readonly string[]} personGroups
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {{ groups: string[], refusal: string | null }}
 */
export function planRevoke(role, personGroups, caseTypes) {
  const parts = roleParts(role, caseTypes);
  if (!parts || !personGroups.includes(parts.entry)) {
    return { groups: [], refusal: 'They do not hold this access.' };
  }
  const others = heldRoles(personGroups, caseTypes).filter(
    (held) => !sameRole(held, role)
  );
  const neededElsewhere = new Set([
    ...others.flatMap(
      (held) => /** @type {RoleParts} */ (roleParts(held, caseTypes)).parts
    ),
    ...(personGroups.includes(roleFlagEntry('adviser'))
      ? caseTypes.map(caseListWrite)
      : []),
  ]);
  return {
    groups: parts.parts.filter(
      (part) => personGroups.includes(part) && !neededElsewhere.has(part)
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
    'can-search-cases': {
      grant: [`Let ${who} search all Cases`, `Let ${who} search all Cases`],
      revoke: [
        `Stop ${who} searching all Cases`,
        `Stopped ${who} searching all Cases`,
      ],
    },
    'can-change-outcome': {
      grant: [`Let ${who} change an Outcome`, `Let ${who} change an Outcome`],
      revoke: [
        `Stop ${who} changing an Outcome`,
        `Stopped ${who} changing an Outcome`,
      ],
    },
  };
  const [imperative, past] = phrases[role.id]?.[action] ?? [
    `${action} ${role.id} for ${who}`,
    `${action} ${role.id} for ${who}`,
  ];
  return { imperative, past };
}
