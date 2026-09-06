// src/sections/registry.js
// @ts-check

/**
 * @typedef {import('./contract.js').SectionPlugin} SectionPlugin
 * @typedef {import('../services/section-access.js').Mode} Mode
 * @typedef {import('../services/section-access.js').Role} Role
 * @typedef {import('../sharepoint-client.js').CaseRow} CaseRow
 * @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig
 * @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition
 * @typedef {import('../services/permissions.js').Capabilities} Capabilities
 */

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

/**
 * The built-in Sections, in canonical order. This is the manifest: a Section
 * exists because its module is imported and listed here, and nothing else names
 * it. Declaration order is the canonical order; tab and Summary order are
 * carried by each plugin so they can differ from it.
 *
 * A function rather than a module-scope array, and that is load-bearing. A
 * plugin's `view` imports the page components it renders, and those reach back
 * to this module through the services they use — so an array evaluated while
 * this module is first being imported reads a plugin binding that is still in
 * its temporal dead zone. A function body is not evaluated until it is called.
 *
 * `const`-asserted so each plugin's literal `id` survives inference, which is
 * what lets `Section` below be projected from the plugins rather than restated
 * in a second table. Deliberately carries no `@returns` annotation: a widening
 * one erases those literals and `Section` silently becomes `string`. Each
 * plugin's conformance is checked by its own `@satisfies`, so the shape is not
 * unguarded.
 */
function builtInSectionPlugins() {
  return /** @type {const} */ ([
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
  ]);
}

/**
 * The Section id union, projected from the plugins themselves — the manifest is
 * the only place the set is stated, at the type level as well as the value one.
 *
 * @typedef {ReturnType<typeof builtInSectionPlugins>[number]['id']} Section
 */

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
  for (const plugin of builtInSectionPlugins()) {
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
    const sectionConfig = sectionConfigFor(config, plugin.id);
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

/**
 * The Section ids in canonical order, as currently registered.
 *
 * `string[]` rather than `Section[]` on purpose: a plugin registered at boot is
 * in this list and cannot be in a union projected from the built-in manifest.
 * `Section` stays the compile-time set that Case Type config and the access map
 * are keyed by.
 *
 * @returns {string[]}
 */
export function sectionIds() {
  return getSectionPlugins().map((plugin) => plugin.id);
}

/**
 * The Section ids that can contribute a block to the Summary Section, in render
 * order.
 *
 * @returns {string[]}
 */
export function summaryBlockIds() {
  return getSectionPlugins()
    .filter((plugin) => plugin.summaryBlock)
    .sort((a, b) => (a.summaryOrder ?? 0) - (b.summaryOrder ?? 0))
    .map((plugin) => plugin.id);
}

/**
 * Whether a Section appears in the Summary when its Case Type says nothing.
 *
 * @param {string} id
 * @returns {boolean}
 */
export function showInSummaryDefaultOf(id) {
  return getSectionPlugin(id)?.showInSummaryDefault ?? true;
}

/**
 * The default tab caption and panel heading for every Section, as each plugin
 * declares them. A Case Type's `sectionLabels` layer over this.
 *
 * @returns {Record<Section, { tab: string, heading: string }>}
 */
export function defaultSectionLabels() {
  return /** @type {Record<Section, { tab: string, heading: string }>} */ (
    Object.fromEntries(
      getSectionPlugins().map((plugin) => [
        plugin.id,
        { ...plugin.defaultLabels },
      ])
    )
  );
}

/**
 * A Case Type's configuration for one Section, if it declares one.
 *
 * The cast is the one place a plugin's `id` meets the `Section`-keyed config
 * map. `SectionPlugin.id` is `string` in the contract on purpose — typing it as
 * `Section` would make the contract reference the union that is projected from
 * the plugins that satisfy it.
 *
 * @param {CaseTypeConfig | undefined} config
 * @param {string} id
 * @returns {import('../sharepoint-client.js').SectionConfig | undefined}
 */
export function sectionConfigFor(config, id) {
  return config?.sections?.[/** @type {Section} */ (id)];
}
