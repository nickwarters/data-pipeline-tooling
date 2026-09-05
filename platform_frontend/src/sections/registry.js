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

import { DetailsPlugin } from './details/details-plugin.js';
import { AdminDetailsPlugin } from './admin-details/admin-details-plugin.js';
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

let initialized = false;

function ensureInitialized() {
  if (!initialized) {
    resetSectionRegistry();
  }
}

export function resetSectionRegistry() {
  registry.clear();
  initialized = true;
  const builtIns = [
    DetailsPlugin,
    QuestionsPlugin,
    IssuesPlugin,
    SummaryPlugin,
    RemediationPlugin,
    NotesPlugin,
    ConversationPlugin,
    AppealRequestPlugin,
    AppealReviewPlugin,
    AmendOutcomePlugin,
    AdminDetailsPlugin,
  ];
  for (const plugin of builtIns) {
    registry.set(plugin.id, plugin);
  }
}

/**
 * Register a SectionPlugin into the registry.
 *
 * @param {SectionPlugin} plugin
 */
export function registerSectionPlugin(plugin) {
  ensureInitialized();
  if (!plugin || !plugin.id) {
    throw new Error('registerSectionPlugin requires a plugin with an id');
  }
  registry.set(plugin.id, plugin);
}

/**
 * Retrieve a plugin by section id.
 *
 * @param {string} id
 * @returns {SectionPlugin | undefined}
 */
export function getSectionPlugin(id) {
  ensureInitialized();
  return registry.get(id);
}

/**
 * Return all registered plugins in an array.
 *
 * @returns {SectionPlugin[]}
 */
export function getSectionPlugins() {
  ensureInitialized();
  return Array.from(registry.values());
}

/**
 * Evaluate access for all registered section plugins.
 *
 * @param {object} params
 * @param {CaseRow} params.caseRow
 * @param {Role[]} params.roles
 * @param {Capabilities} [params.capabilities]
 * @param {CaseTypeConfig} [params.config]
 * @param {QuestionDefinition[]} [params.catalogue]
 * @returns {Record<string, Mode>}
 */
export function evaluateSectionsAccess({
  caseRow,
  roles,
  capabilities = /** @type {Capabilities} */ ({}),
  config = /** @type {any} */ ({}),
  catalogue = [],
}) {
  /** @type {Record<string, Mode>} */
  const access = {};
  for (const plugin of getSectionPlugins()) {
    const sectionConfig = config?.sections?.[plugin.id];
    access[plugin.id] = plugin.evaluateAccess({
      caseRow,
      roles,
      capabilities,
      sectionConfig,
      catalogue,
      config,
    });
  }
  return access;
}
