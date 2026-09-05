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

import { SECTION_REGISTRY, tabEntries } from '../lib/section-registry.js';
import { MATRIX } from '../services/section-access.js';
import { SECTION_PANELS } from '../pages/cora-case-review/section-panels.js';
import { DEFAULT_SECTION_LABELS } from '../lib/section-labels.js';
import { DetailsPlugin } from './details/details-plugin.js';
import { NotesPlugin } from './notes/notes-plugin.js';
import { ConversationPlugin } from './conversation/conversation-plugin.js';
import { AmendOutcomePlugin } from './amend-outcome/amend-outcome-plugin.js';
import { AppealRequestPlugin } from './appeals/appeal-request-plugin.js';
import { AppealReviewPlugin } from './appeals/appeal-review-plugin.js';
import { QuestionsPlugin } from './questions/questions-plugin.js';
import { IssuesPlugin } from './issues/issues-plugin.js';
import { RemediationPlugin } from './remediation/remediation-plugin.js';
import { SummaryPlugin } from './summary/summary-plugin.js';

/** @type {Map<string, SectionPlugin>} */
const registry = new Map();

/** @type {Record<Mode, number>} */
const RANK = { edit: 3, 'read-only': 1, hidden: 0 };

export function resetSectionRegistry() {
  registry.clear();
  const defaultTabIds = new Set(tabEntries().map((entry) => entry.id));
  for (const entry of SECTION_REGISTRY) {
    if (entry.id === 'details') {
      registry.set(entry.id, DetailsPlugin);
      continue;
    }
    if (entry.id === 'questions') {
      registry.set(entry.id, QuestionsPlugin);
      continue;
    }
    if (entry.id === 'issues') {
      registry.set(entry.id, IssuesPlugin);
      continue;
    }
    if (entry.id === 'summary') {
      registry.set(entry.id, SummaryPlugin);
      continue;
    }
    if (entry.id === 'remediation') {
      registry.set(entry.id, RemediationPlugin);
      continue;
    }
    if (entry.id === 'notes') {
      registry.set(entry.id, NotesPlugin);
      continue;
    }
    if (entry.id === 'conversation') {
      registry.set(entry.id, ConversationPlugin);
      continue;
    }
    if (entry.id === 'amendOutcome') {
      registry.set(entry.id, AmendOutcomePlugin);
      continue;
    }
    if (entry.id === 'appealRequest') {
      registry.set(entry.id, AppealRequestPlugin);
      continue;
    }
    if (entry.id === 'appealReview') {
      registry.set(entry.id, AppealReviewPlugin);
      continue;
    }
    const fallbackEntry = /** @type {typeof SECTION_REGISTRY[number]} */ (
      entry
    );
    registry.set(fallbackEntry.id, {
      ...fallbackEntry,
      tab: defaultTabIds.has(fallbackEntry.id),
      defaultLabels: DEFAULT_SECTION_LABELS[fallbackEntry.id],
      evaluateAccess: (ctx) => {
        const roles = ctx.roles?.length
          ? ctx.roles
          : [/** @type {Role} */ ('none')];
        /** @type {Mode} */
        let best = 'hidden';
        for (const role of roles) {
          const cell = MATRIX[fallbackEntry.id]?.[role];
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
      view: (pCtx) => SECTION_PANELS[fallbackEntry.id]?.(pCtx) ?? null,
    });
  }
}

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
  if (registry.size === 0) {
    resetSectionRegistry();
  }
  return Array.from(registry.values());
}

/**
 * Get a single registered section plugin by id.
 * @param {string} id
 * @returns {SectionPlugin | undefined}
 */
export function getSectionPlugin(id) {
  if (registry.size === 0) {
    resetSectionRegistry();
  }
  return registry.get(id);
}
