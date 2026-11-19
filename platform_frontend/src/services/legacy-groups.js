// @ts-check
import {
  allCaseListGroups,
  caseListGroupNames,
  caseTypeGroupNames,
  frontlineListAccessGroupName,
  permissions,
} from './permissions.js';
import { roleCaseTypeEntry, roleFlagEntry } from './user-roles.js';

/**
 * The groups CORA used before a person's roles moved to `CoraUserRoles`, and
 * what each one becomes: role entries on the person's row, and the new groups
 * that open the lists those roles need.
 *
 * This is the one statement of that translation. It exists for the move and
 * goes with the old groups: the backfill reads it to fill the row and the new
 * groups, and nothing else may grow a second copy of it.
 *
 * `CORA Owner Delegates` is not here because it is not legacy: it stays a
 * group, since it owns every other group and is the one that edits the row.
 */

/** @typedef {{ slug: string, displayName: string }} CaseTypeRef */

/**
 * @typedef {{ group: string, entries: string[], accessGroups: string[] }} LegacyGroup
 */

/**
 * Every legacy group and what it becomes, the site-wide ones first and then
 * each Case Type's, in registry order.
 *
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {LegacyGroup[]}
 */
export function legacyGroups(caseTypes) {
  return [
    {
      group: permissions.reviewer,
      entries: [roleFlagEntry('reviewer')],
      accessGroups: [],
    },
    {
      group: permissions.adviser,
      entries: [roleFlagEntry('adviser')],
      accessGroups: [],
    },
    {
      group: permissions.controls,
      entries: [roleFlagEntry('controls')],
      accessGroups: [allCaseListGroups.write],
    },
    {
      group: permissions.reviewerManager,
      entries: [roleFlagEntry('reviewerManager')],
      accessGroups: [allCaseListGroups.read],
    },
    {
      group: permissions.responsiblePartyManager,
      entries: [roleFlagEntry('responsiblePartyManager')],
      accessGroups: [allCaseListGroups.read],
    },
    ...caseTypes.flatMap(({ slug, displayName }) => {
      const old = caseTypeGroupNames(displayName);
      const write = caseListGroupNames(displayName).write;
      return [
        {
          group: old.listAccess,
          entries: [roleCaseTypeEntry('reviews', slug)],
          accessGroups: [write],
        },
        {
          group: frontlineListAccessGroupName(displayName),
          entries: [],
          accessGroups: [write],
        },
        {
          group: old.caseTypeOwner,
          entries: [roleCaseTypeEntry('ownsCaseTypes', slug)],
          accessGroups: [write],
        },
        {
          group: old.journeyOwner,
          entries: [roleCaseTypeEntry('journeyOwnerOf', slug)],
          accessGroups: [write],
        },
      ];
    }),
  ];
}

/**
 * What a person's legacy groups become. The bare `Reviewers` group becomes the
 * Reviewer flag only for somebody who reviews no Case Type, because the flag
 * means "a Reviewer with no list" and a per-type Reviewer is already a
 * Reviewer.
 *
 * @param {readonly string[]} groups
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {{ entries: string[], accessGroups: string[] }}
 */
export function translateLegacyGroups(groups, caseTypes) {
  const held = legacyGroups(caseTypes).filter(({ group }) =>
    groups.includes(group)
  );
  const reviewsAType = caseTypes.some(({ displayName }) =>
    groups.includes(caseTypeGroupNames(displayName).listAccess)
  );
  const entries = held
    .flatMap(({ entries: becomes }) => becomes)
    .filter((entry) => !reviewsAType || entry !== roleFlagEntry('reviewer'));
  return {
    entries: [...new Set(entries)],
    accessGroups: [
      ...new Set(held.flatMap(({ accessGroups }) => accessGroups)),
    ],
  };
}
