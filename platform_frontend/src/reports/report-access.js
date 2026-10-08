// @ts-check
import { CASE_TYPES } from '../../case-types/manifest.js';
import { caseTypeGroupNames, permissions } from '../services/permissions.js';

/** @typedef {import('./contract.js').ReportPlugin} ReportPlugin */
/** @typedef {import('./contract.js').ReportScope} ReportScope */
/** @typedef {import('./contract.js').ReportAccessRule} ReportAccessRule */
/** @typedef {import('./contract.js').PlatformRole} PlatformRole */
/** @typedef {import('./contract.js').CaseTypeRole} CaseTypeRole */
/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../services/permissions.js').PermissionsConfig} PermissionsConfig */

/**
 * A report's audience is declared once, as data, and read twice.
 *
 * The browser reads it to decide what to offer: whether the Reports link
 * shows, which reports the index lists, which scopes a switcher holds. That is
 * presentation, and nothing more — a report feed is a file in a document
 * library, and whoever can read the folder can read the file.
 *
 * Provisioning reads it to decide who can read each folder, which is the real
 * boundary. Both readings come from the same rules below, so the page and the
 * folder cannot disagree about who a report is for unless someone edits a
 * folder by hand.
 *
 * Each role resolves two ways for the same reason: to a capability the browser
 * already holds, and to the SharePoint groups that grant it. A named group is
 * the degenerate case of both: the browser asks whether the viewer is in it,
 * and the folder needs it.
 */

/** @type {Readonly<Record<PlatformRole, { holds: (caps: Capabilities) => boolean, groups: (config: PermissionsConfig) => string[] }>>} */
const PLATFORM_ROLES = Object.freeze({
  maintainer: {
    holds: (caps) => caps.isMaintainer,
    groups: (config) => [config.maintainer],
  },
  // Reviewing is implied by any per-Case-Type reviewer group as well as the
  // functional one, so the folder needs all of them to match the capability.
  reviewer: {
    holds: (caps) => caps.isReviewer,
    groups: (config) => [
      config.reviewer,
      ...config.caseTypes.map(
        ({ displayName }) => caseTypeGroupNames(displayName).listAccess
      ),
    ],
  },
  adviser: {
    holds: (caps) => caps.isAdviser,
    groups: (config) => [config.adviser],
  },
  controls: {
    holds: (caps) => caps.isControls,
    groups: (config) => [config.controls],
  },
  reviewerManager: {
    holds: (caps) => caps.isReviewerManager,
    groups: (config) => [config.reviewerManager],
  },
  responsiblePartyManager: {
    holds: (caps) => caps.isResponsiblePartyManager,
    groups: (config) => [config.responsiblePartyManager],
  },
});

/** @type {Readonly<Record<CaseTypeRole, { holds: (caps: Capabilities, slug: string) => boolean, group: (displayName: string) => string }>>} */
const CASE_TYPE_ROLES = Object.freeze({
  caseTypeOwner: {
    holds: (caps, slug) => caps.ownedCaseTypes.includes(slug),
    group: (displayName) => caseTypeGroupNames(displayName).caseTypeOwner,
  },
  journeyOwner: {
    holds: (caps, slug) => caps.ownedJourneyCaseTypes.includes(slug),
    group: (displayName) => caseTypeGroupNames(displayName).journeyOwner,
  },
  caseTypeReviewer: {
    holds: (caps, slug) => caps.listAccessCaseTypes.includes(slug),
    group: (displayName) => caseTypeGroupNames(displayName).listAccess,
  },
});

/**
 * A named group read the way a platform role is: it holds everywhere, for its
 * members. Matched exactly, as every other group name is.
 *
 * @param {string} group
 * @returns {{ holds: (caps: Capabilities) => boolean, groups: () => string[] }}
 */
function namedGroup(group) {
  return {
    holds: (caps) => caps.groups.includes(group),
    groups: () => [group],
  };
}

/** The one scope a platform-wide report has. */
const PLATFORM_SCOPE = Object.freeze({
  kind: /** @type {const} */ ('platform'),
  key: 'platform',
  label: 'All Case Types',
});

/**
 * The definition of one rule, or a throw. An unknown role is a mistake in a
 * report's configuration, and failing loudly beats quietly admitting nobody —
 * which looks exactly like "you do not have access" from the outside.
 *
 * @param {ReportAccessRule} rule
 */
function resolveRule(rule) {
  if (rule !== null && typeof rule === 'object' && 'group' in rule) {
    const { group } = rule;
    if (typeof group !== 'string' || group.trim() === '') {
      throw new TypeError(`unknown report role: ${JSON.stringify(rule)}`);
    }
    return { scoped: /** @type {const} */ (false), role: namedGroup(group) };
  }
  if (typeof rule === 'string') {
    const role = PLATFORM_ROLES[rule];
    if (!role) throw new TypeError(`unknown report role: ${rule}`);
    return { scoped: /** @type {const} */ (false), role };
  }
  const role = CASE_TYPE_ROLES[rule?.role];
  if (!role || rule.of !== 'scope') {
    throw new TypeError(`unknown report role: ${JSON.stringify(rule)}`);
  }
  return { scoped: /** @type {const} */ (true), role };
}

/**
 * Every scope a report has, whoever is asking.
 *
 * @param {ReportPlugin} plugin
 * @returns {ReportScope[]}
 */
export function allScopes(plugin) {
  if (plugin.scope.kind === 'platform') return [{ ...PLATFORM_SCOPE }];
  return CASE_TYPES.map(({ slug, displayName }) => ({
    kind: /** @type {const} */ ('case-type'),
    key: slug,
    label: displayName,
  }));
}

/**
 * Whether these capabilities admit a viewer to one scope of a report.
 *
 * @param {ReportPlugin} plugin
 * @param {Capabilities} capabilities
 * @param {ReportScope} scope
 * @returns {boolean}
 */
function canViewScope(plugin, capabilities, scope) {
  return plugin.access.some((rule) => {
    const resolved = resolveRule(rule);
    if (!resolved.scoped) return resolved.role.holds(capabilities);
    return (
      scope.kind === 'case-type' && resolved.role.holds(capabilities, scope.key)
    );
  });
}

/**
 * The scopes of a report this viewer may open, in the order the Case Type
 * registry lists them. Empty means the report is not for them at all.
 *
 * @param {ReportPlugin} plugin
 * @param {Capabilities} capabilities
 * @returns {ReportScope[]}
 */
export function scopesFor(plugin, capabilities) {
  return allScopes(plugin).filter((scope) =>
    canViewScope(plugin, capabilities, scope)
  );
}

/**
 * The SharePoint groups that must be able to read one scope's folder, sorted
 * and without repeats.
 *
 * @param {ReportPlugin} plugin
 * @param {ReportScope} scope
 * @param {PermissionsConfig} [config]
 * @returns {string[]}
 */
export function groupsForScope(plugin, scope, config = permissions) {
  /** @type {Set<string>} */
  const groups = new Set();
  for (const rule of plugin.access) {
    const resolved = resolveRule(rule);
    if (!resolved.scoped) {
      for (const group of resolved.role.groups(config)) groups.add(group);
    } else if (scope.kind === 'case-type') {
      groups.add(resolved.role.group(scope.label));
    }
  }
  return [...groups].sort();
}
