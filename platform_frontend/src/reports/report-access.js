// @ts-check
import { CASE_TYPES } from '../../case-types/manifest.js';
import {
  caseTypeGroupNames,
  isReportGroupName,
  permissions,
} from '../services/permissions.js';

/** @typedef {import('./contract.js').ReportPlugin} ReportPlugin */
/** @typedef {import('./contract.js').ReportScope} ReportScope */
/** @typedef {import('./contract.js').ReportAccessRule} ReportAccessRule */
/** @typedef {import('./contract.js').PlatformRole} PlatformRole */
/** @typedef {import('./contract.js').CaseTypeRole} CaseTypeRole */
/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../services/permissions.js').PermissionsConfig} PermissionsConfig */

// The browser's reading is UX only; the SharePoint folder permission is the real boundary.

/** @type {Readonly<Record<PlatformRole, { holds: (caps: Capabilities) => boolean, groups: (config: PermissionsConfig) => string[] }>>} */
const PLATFORM_ROLES = Object.freeze({
  maintainer: {
    holds: (caps) => caps.isMaintainer,
    groups: (config) => [config.maintainer],
  },
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
 * @param {string} group
 * @returns {{ holds: (caps: Capabilities) => boolean, groups: () => string[] }}
 */
function namedGroup(group) {
  return {
    holds: (caps) => caps.reportGroups.includes(group),
    groups: () => [group],
  };
}

const PLATFORM_SCOPE = Object.freeze({
  kind: /** @type {const} */ ('platform'),
  key: 'platform',
  label: 'All Case Types',
});

/** @param {ReportAccessRule} rule */
function resolveRule(rule) {
  if (rule !== null && typeof rule === 'object' && 'group' in rule) {
    const { group } = rule;
    if (typeof group !== 'string' || !isReportGroupName(group)) {
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
