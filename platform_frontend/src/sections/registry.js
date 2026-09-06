// src/sections/registry.js
// @ts-check

/**
 * The Section engine. It knows how to hold Sections and how to derive things
 * from them; it does not know which Sections exist. That list is pushed in by
 * `configureSections` from the composition root at boot, so an application
 * Section and a built-in one are the same kind of thing — there is no
 * framework list for one of them to be missing from.
 *
 * Nothing is imported here at runtime, deliberately.
 */

/**
 * @typedef {import('./contract.js').SectionPlugin} SectionPlugin
 * @typedef {import('../services/section-access.js').Mode} Mode
 * @typedef {import('../services/section-access.js').Role} Role
 * @typedef {import('../sharepoint-client.js').CaseRow} CaseRow
 * @typedef {import('../sharepoint-client.js').CaseTypeConfig} CaseTypeConfig
 * @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition
 * @typedef {import('../services/permissions.js').Capabilities} Capabilities
 */

/**
 * The Section id union, taken from the composition root — the one place that
 * says what this application is made of, at the type level as well as the value
 * one. A type-only edge: this module imports nothing at runtime, which is what
 * unknots the cycle that used to run from the services through here into the
 * plugins and back out through their views.
 *
 * @typedef {import('../app-config.js').Section} Section
 */

/** @type {Map<string, SectionPlugin>} */
const registry = new Map();

/**
 * Whether the composition root has told this engine what the application is
 * made of. Starts false, and `configureSections` is the only thing that sets
 * it.
 */
let configured = false;

/**
 * Refuse to answer before the composition root has said what this application
 * is made of.
 *
 * Throwing is the whole point. There is no list to fall back to, and an empty
 * registry does not read as an empty registry anywhere downstream: the Case
 * loader asks whether every Section is hidden, which is vacuously true over no
 * Sections, so it denies access to every Case and renders a blank application
 * with nothing in the console. A missing configuration must look like a
 * missing configuration.
 */
function assertConfigured() {
  if (!configured) {
    throw new Error(
      'Sections read before configureSections() — boot must configure the ' +
        'engine before any route mounts.'
    );
  }
}

/**
 * Configure the engine with the Sections this application is composed of.
 * Called once during boot, before any route mounts.
 *
 * Replaces wholesale, so calling it again is also how a caller puts back what
 * it composed: there is no separate reset, because a list that says what the
 * application is made of already says what it is not made of.
 *
 * A duplicate id throws rather than replacing the earlier entry.
 * `registerSectionPlugin` replaces on purpose — a test standing one Section in
 * for another — but a Section listed twice in the composition root is a mistake
 * in the list, and the two cases deserve different answers.
 *
 * @param {readonly SectionPlugin[]} plugins
 */
export function configureSections(plugins) {
  registry.clear();
  for (const plugin of plugins) {
    if (!plugin?.id) {
      throw new Error('configureSections: every Section needs an id');
    }
    if (registry.has(plugin.id)) {
      throw new Error(`configureSections: duplicate Section id "${plugin.id}"`);
    }
    registry.set(plugin.id, plugin);
  }
  configured = true;
}

/**
 * Register a SectionPlugin into the registry.
 *
 * @param {SectionPlugin} plugin
 */
export function registerSectionPlugin(plugin) {
  assertConfigured();
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
  assertConfigured();
  return registry.get(id);
}

/**
 * Return all registered plugins in an array.
 *
 * @returns {SectionPlugin[]}
 */
export function getSectionPlugins() {
  assertConfigured();
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
 * The Section ids as currently registered, in manifest-then-registration
 * order — which is not a meaningful order; see the manifest above.
 *
 * `string[]` rather than `Section[]` on purpose: a plugin registered after boot
 * is in this list and cannot be in a union projected from the composition root.
 * `Section` stays the compile-time set that Case Type config and the access map
 * are keyed by.
 *
 * @returns {string[]}
 */
export function sectionIds() {
  return getSectionPlugins().map((plugin) => plugin.id);
}

/**
 * The Section ids that can contribute a block to the Summary Section, in the
 * render order their own `summaryOrder` gives.
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
