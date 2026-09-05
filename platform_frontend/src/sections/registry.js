// src/sections/registry.js
// @ts-check

/**
 * @typedef {import('../services/section-access.js').Mode} Mode
 * @typedef {import('../services/section-access.js').Role} Role
 * @typedef {import('../sharepoint-client.js').CaseRow} CaseRow
 * @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig
 * @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition
 * @typedef {import('../services/permissions.js').Capabilities} Capabilities
 * @typedef {import('../pages/cora-case-review/section-panels.js').PanelContext} PanelContext
 */

/**
 * @typedef {Object} SectionPlugin
 * @property {string} id Unique section ID (e.g. 'details', 'questions')
 * @property {boolean} tab Whether it appears in the tab strip
 * @property {number} tabOrder Order in the tab strip
 * @property {boolean} [summaryBlock] Whether it can contribute to the Summary tab
 * @property {number} [summaryOrder] Order inside the Summary view
 * @property {boolean} [showInSummaryDefault] Default summary inclusion
 * @property {{ tab: string, heading: string }} defaultLabels Default tab & panel titles
 * @property {(ctx: {
 *   caseRow: CaseRow,
 *   roles: Role[],
 *   capabilities?: Capabilities,
 *   sectionConfig?: any,
 *   catalogue?: QuestionDefinition[],
 *   config?: CaseTypeConfig,
 * }) => Mode} evaluateAccess
 * @property {(panelContext: PanelContext) => Node | Node[] | null} view
 */

import { SECTION_REGISTRY } from '../lib/section-registry.js';
import { MATRIX } from '../services/section-access.js';
import { SECTION_PANELS } from '../pages/cora-case-review/section-panels.js';
import { DEFAULT_SECTION_LABELS } from '../lib/section-labels.js';

/** @type {Map<string, SectionPlugin>} */
const registry = new Map();

/** @type {Record<Mode, number>} */
const RANK = { edit: 3, 'read-only': 1, hidden: 0 };

export function resetSectionRegistry() {
  registry.clear();
  for (const entry of SECTION_REGISTRY) {
    registry.set(entry.id, {
      ...entry,
      defaultLabels: DEFAULT_SECTION_LABELS[entry.id],
      evaluateAccess: (ctx) => {
        const roles = ctx.roles?.length
          ? ctx.roles
          : [/** @type {Role} */ ('none')];
        /** @type {Mode} */
        let best = 'hidden';
        for (const role of roles) {
          const cell = MATRIX[entry.id]?.[role];
          /** @type {Mode} */
          const mode =
            typeof cell === 'function'
              ? cell(
                  ctx.caseRow,
                  /** @type {any} */ (ctx.config ?? null),
                  /** @type {any} */ (ctx.catalogue ?? [])
                )
              : (cell ?? 'hidden');
          if ((RANK[mode] ?? 0) > (RANK[best] ?? 0)) best = mode;
        }
        return best;
      },
      view: (pCtx) => SECTION_PANELS[entry.id]?.(pCtx) ?? null,
    });
  }
}

// Initialize with legacy adapter shims for unmigrated sections
resetSectionRegistry();

/**
 * Register a section plugin. Replaces any existing registration with the same id.
 * @param {SectionPlugin} plugin
 */
export function registerSectionPlugin(plugin) {
  registry.set(plugin.id, plugin);
}

/**
 * Get all registered section plugins.
 * @returns {SectionPlugin[]}
 */
export function getSectionPlugins() {
  return Array.from(registry.values());
}

/**
 * Get a single registered section plugin by id.
 * @param {string} id
 * @returns {SectionPlugin | undefined}
 */
export function getSectionPlugin(id) {
  return registry.get(id);
}
