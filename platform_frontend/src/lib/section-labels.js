// @ts-check
import { defaultSectionLabels as pluginDefaultLabels } from '../sections/registry.js';
// Single source of truth for Case Review tab labels and section headings.
// A Case Type may override any entry via `CaseTypeConfig.sectionLabels`
// (src/sharepoint-client.js); DEFAULT_SECTION_LABELS supplies the rest.

/** @typedef {import('../sharepoint-client.js').SectionLabels} SectionLabels */
/** @typedef {import('../sharepoint-client.js').ResolvedSectionLabels} ResolvedSectionLabels */

/**
 * The default display copy for every Section, as each plugin declares it.
 * Derived rather than restated: a Section's tab caption and panel heading are
 * part of what the Section is, so they live with its code.
 *
 * @returns {Readonly<ResolvedSectionLabels>}
 */
export function defaultSectionLabels() {
  return /** @type {Readonly<ResolvedSectionLabels>} */ (pluginDefaultLabels());
}

/**
 * Resolve a Case Type's effective section display copy: `DEFAULT_SECTION_LABELS`
 * with any `config.sectionLabels` entries the Case Type declares applied over
 * the top. Absence of `sectionLabels` (or of `config` itself) is a no-op.
 *
 * An override entry may be a bare string — which renames both the tab and the
 * heading, the common case where a Case Type simply calls the Section something
 * else — or an object naming either axis, which patches only what it names and
 * leaves the other at its default.
 *
 * Every returned entry is a complete `{ tab, heading }` pair, so a caller never
 * has to normalise on the read path.
 *
 * @param {{ sectionLabels?: SectionLabels } | null | undefined} config
 * @returns {ResolvedSectionLabels}
 */
export function resolveSectionLabels(config) {
  const overrides = config?.sectionLabels ?? {};
  const resolved = /** @type {ResolvedSectionLabels} */ ({});
  for (const [id, fallback] of Object.entries(defaultSectionLabels())) {
    const override = overrides[/** @type {keyof SectionLabels} */ (id)];
    resolved[/** @type {keyof ResolvedSectionLabels} */ (id)] =
      typeof override === 'string'
        ? { tab: override, heading: override }
        : { ...fallback, ...(override ?? {}) };
  }
  return resolved;
}
