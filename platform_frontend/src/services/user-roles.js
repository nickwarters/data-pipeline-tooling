// @ts-check
/**
 * What a person may do in CORA, as one row of the `CoraUserRoles` list.
 *
 * SharePoint groups decide which Case lists a person can open; this row
 * decides what the app lets them do there. A site-wide function is a yes/no
 * column, and a role held per Case Type is a multi-choice column of Case Type
 * slugs, so a new Case Type is a new choice value rather than a new column.
 *
 * The row is also spelled as a list of **role entries** — one string per
 * yes/no column that is set and per slug a multi-choice column holds. The
 * Access page plans a change over a person's groups and their role entries in
 * one list, so a role made of groups and row columns is planned, logged and
 * applied by the same code. An entry cannot be mistaken for a group: it carries
 * a colon, which SharePoint refuses in a group name.
 */

/** The list every environment shares, because the roles it holds apply in every environment. */
export const USER_ROLES_LIST_NAME = 'CoraUserRoles';

/**
 * @typedef {{
 *   adviser: boolean,
 *   controls: boolean,
 *   reviewerManager: boolean,
 *   responsiblePartyManager: boolean,
 *   reviewer: boolean,
 *   reviews: string[],
 *   ownsCaseTypes: string[],
 *   journeyOwnerOf: string[]
 * }} UserRoles
 */

/** @typedef {'adviser' | 'controls' | 'reviewerManager' | 'responsiblePartyManager' | 'reviewer'} RoleFlag */
/** @typedef {'reviews' | 'ownsCaseTypes' | 'journeyOwnerOf'} RoleCaseTypeList */

/**
 * Each yes/no field and the SharePoint column it is stored in.
 *
 * @type {Readonly<Record<RoleFlag, string>>}
 */
export const ROLE_FLAG_COLUMNS = Object.freeze({
  adviser: 'Adviser',
  controls: 'Controls',
  reviewerManager: 'ReviewerManager',
  responsiblePartyManager: 'ResponsiblePartyManager',
  reviewer: 'Reviewer',
});

/**
 * Each per-Case-Type field and the multi-choice column it is stored in.
 *
 * @type {Readonly<Record<RoleCaseTypeList, string>>}
 */
export const ROLE_CASE_TYPE_COLUMNS = Object.freeze({
  reviews: 'Reviews',
  ownsCaseTypes: 'OwnsCaseTypes',
  journeyOwnerOf: 'JourneyOwnerOf',
});

const FLAGS = /** @type {RoleFlag[]} */ (Object.keys(ROLE_FLAG_COLUMNS));
const CASE_TYPE_LISTS = /** @type {RoleCaseTypeList[]} */ (
  Object.keys(ROLE_CASE_TYPE_COLUMNS)
);

/**
 * The roles of somebody with no row: nothing at all.
 *
 * @returns {UserRoles}
 */
export function noRoles() {
  return {
    adviser: false,
    controls: false,
    reviewerManager: false,
    responsiblePartyManager: false,
    reviewer: false,
    reviews: [],
    ownsCaseTypes: [],
    journeyOwnerOf: [],
  };
}

/**
 * The entry for a yes/no column that is set.
 *
 * @param {RoleFlag} flag
 * @returns {string}
 */
export function roleFlagEntry(flag) {
  return `${USER_ROLES_LIST_NAME}: ${ROLE_FLAG_COLUMNS[flag]}`;
}

/**
 * The entry for one Case Type held in a multi-choice column.
 *
 * @param {RoleCaseTypeList} list
 * @param {string} slug
 * @returns {string}
 */
export function roleCaseTypeEntry(list, slug) {
  return `${USER_ROLES_LIST_NAME}: ${ROLE_CASE_TYPE_COLUMNS[list]} = ${slug}`;
}

/**
 * The row as the entries it holds, flags first, each list in its stored order.
 *
 * @param {UserRoles} roles
 * @returns {string[]}
 */
export function roleEntries(roles) {
  return [
    ...FLAGS.filter((flag) => roles[flag]).map(roleFlagEntry),
    ...CASE_TYPE_LISTS.flatMap((list) =>
      roles[list].map((slug) => roleCaseTypeEntry(list, slug))
    ),
  ];
}

/**
 * The row with some entries set and others cleared; an entry it does not recognise is refused rather than dropped.
 *
 * @param {UserRoles} roles
 * @param {{ add?: readonly string[], remove?: readonly string[] }} change
 * @returns {UserRoles}
 */
export function withRoleEntries(roles, change) {
  const next = {
    ...roles,
    reviews: [...roles.reviews],
    ownsCaseTypes: [...roles.ownsCaseTypes],
    journeyOwnerOf: [...roles.journeyOwnerOf],
  };
  for (const [entries, on] of /** @type {const} */ ([
    [change.remove ?? [], false],
    [change.add ?? [], true],
  ])) {
    for (const entry of entries) applyEntry(next, entry, on);
  }
  return next;
}

/**
 * @param {UserRoles} roles
 * @param {string} entry
 * @param {boolean} on
 */
function applyEntry(roles, entry, on) {
  const flag = FLAGS.find((candidate) => roleFlagEntry(candidate) === entry);
  if (flag) {
    roles[flag] = on;
    return;
  }
  for (const list of CASE_TYPE_LISTS) {
    const prefix = `${USER_ROLES_LIST_NAME}: ${ROLE_CASE_TYPE_COLUMNS[list]} = `;
    if (!entry.startsWith(prefix)) continue;
    const slug = entry.slice(prefix.length);
    const held = roles[list].filter((value) => value !== slug);
    roles[list] = on ? [...held, slug] : held;
    return;
  }
  throw new Error(`"${entry}" is not a column of ${USER_ROLES_LIST_NAME}.`);
}
