// @ts-check
/**
 * @typedef {() => Promise<{ default: import('../src/sharepoint-client.js').CaseTypeConfig }>} CaseTypeImporter
 * @typedef {() => Promise<{ default: import('../src/pages/question-bank/question-bank-source.js').QuestionBank }>} QuestionBankImporter
 */

import { loadBank } from './load-bank.js';
import {
  OutcomeConfigurationError,
  validateConfiguredOutcomeConfig,
} from '../src/evaluators/configured-outcome.js';

/**
 * One Case Type's static identity plus the thunks that reach its lazily loaded
 * artifacts. `slug` and `displayName` are the only parts readable without
 * evaluating a Case Type module, which is what lets the boot-critical,
 * synchronous permissions config derive its per-Case-Type group names from this
 * one registry while keeping the lazy loading intact.
 *
 * `bank` is optional: a Case Type may be registered before its Question Bank
 * artifact exists (the scaffold path), in which case it simply does not appear
 * in the bank editor.
 *
 * @typedef {{
 * slug: string,
 * displayName: string,
 * importer: CaseTypeImporter,
 * bank?: QuestionBankImporter
 * }} CaseTypeEntry
 */

/** @type {CaseTypeEntry[]} */
const registry = [
  Object.freeze({
    slug: 'complaints',
    displayName: 'Complaints',
    importer: () => import('./complaints.js'),
    bank: () => loadQuestionBank('./banks/complaints.txt'),
  }),
];

/**
 * THE Case Type registry. Adding a Case Type is one entry here, plus its config
 * module under `case-types/` and (optionally) its bank artifact under
 * `case-types/banks/`. `displayName` is load-bearing and lives ONLY here:
 * it composes the three provisioned SharePoint group names — see
 * `caseTypeGroupNames()` in `src/services/permissions.js` — and both the
 * capability side (`permissions.caseTypes`) and the Case-source eligibility side
 * (`resolveCaseSources`, via `displayNameFor`) read this one copy. A Case Type
 * config module must not restate it.
 *
 * Entries are FROZEN, so "one copy" is structural rather than a convention: a
 * display name cannot be mutated in place behind either consumer's back. The
 * array itself stays appendable — that is `registerCaseType()`'s job — and both
 * consumers re-derive from it on every read, so an append is seen by both at
 * once.
 *
 * Note where "structural" stops: `readonly` is a `tsc` claim, not a runtime one.
 * This is the live registry array, so `CASE_TYPES.push({})` at runtime bypasses
 * the validation, the freeze and the duplicate check that `registerCaseType()`
 * applies. Compile-time-only enforcement is the repo's normal bargain — there is
 * no build step to enforce more — and the frozen *entries* are the half that
 * does hold at runtime, which is the half that protects the group names.
 *
 * @type {readonly CaseTypeEntry[]}
 */
export const CASE_TYPES = registry;

/**
 * Derived from `CASE_TYPES` — the shape existing consumers already depend on.
 * @type {Record<string, CaseTypeImporter>}
 */
export const CASE_TYPE_IMPORTERS = {};

/**
 * Derived from `CASE_TYPES` — only the Case Types that declare a bank artifact.
 * @type {Record<string, QuestionBankImporter>}
 */
export const QUESTION_BANK_IMPORTERS = {};

/**
 * The single derivation of the two importer maps from one registry entry.
 * @param {CaseTypeEntry} entry
 */
function deriveImporters(entry) {
  CASE_TYPE_IMPORTERS[entry.slug] = entry.importer;
  if (entry.bank) QUESTION_BANK_IMPORTERS[entry.slug] = entry.bank;
}

for (const entry of registry) deriveImporters(entry);

/**
 * Register a Case Type after module evaluation, through the registry, so the
 * derived importer maps cannot diverge from `CASE_TYPES`. Test fixtures
 * (`tests/_register-example-review.js`) use this; production Case Types belong
 * in the `registry` literal above.
 *
 * Validated, because an entry that reaches the registry is immediately
 * load-bearing for ACCESS. A missing display name composes the SharePoint group
 * name `Reviewers - undefined`; a duplicate slug splits the registry against
 * itself, since `displayNameFor()` reads the first matching row while
 * `deriveImporters()` overwrites with the last and `permissions.caseTypes`
 * carries both.
 *
 * @param {CaseTypeEntry} entry
 * @throws {TypeError} when the entry cannot compose its group names
 * @throws {DuplicateCaseTypeError} when the slug is already registered
 */
export function registerCaseType(entry) {
  const nonEmpty = (/** @type {unknown} */ value) =>
    typeof value === 'string' && value.trim().length > 0;

  if (!nonEmpty(entry?.slug))
    throw new TypeError(
      'registerCaseType: a Case Type must declare a non-empty `slug`.'
    );
  if (!nonEmpty(entry.displayName))
    throw new TypeError(
      `registerCaseType: Case Type "${entry.slug}" must declare a non-empty ` +
        "`displayName` — it composes this type's three SharePoint group names."
    );
  if (typeof entry.importer !== 'function')
    throw new TypeError(
      `registerCaseType: Case Type "${entry.slug}" must declare an importer thunk.`
    );
  if (registry.some((caseType) => caseType.slug === entry.slug))
    throw new DuplicateCaseTypeError(entry.slug);

  const frozen = Object.freeze({ ...entry });
  registry.push(frozen);
  deriveImporters(frozen);
}

/**
 * The registered display name for a slug — the ONE copy that composes a Case
 * Type's SharePoint group names. Synchronous and lazy: the registry holds
 * importer thunks only, so this evaluates no Case Type module.
 *
 * @param {string} slug
 * @returns {string}
 */
export function displayNameFor(slug) {
  const entry = registry.find((caseType) => caseType.slug === slug);
  if (!entry) {
    throw new UnknownCaseTypeError(
      slug,
      registry.map((caseType) => caseType.slug).sort()
    );
  }
  return entry.displayName;
}

/**
 * @param {string} path
 * @returns {Promise<{ default: import('../src/pages/question-bank/question-bank-source.js').QuestionBank }>}
 */
async function loadQuestionBank(path) {
  return { default: await loadBank(path) };
}

export class UnknownCaseTypeError extends Error {
  /**
   * @param {string} slug
   * @param {string[]} knownSlugs
   */
  constructor(slug, knownSlugs) {
    super(
      `Unsupported Case Type slug "${slug}". Known Case Type slugs: ${knownSlugs.join(', ')}.`
    );
    this.name = 'UnknownCaseTypeError';
    this.slug = slug;
    this.knownSlugs = knownSlugs;
  }
}

/**
 * A second registration for a slug that is already registered. Rejected rather
 * than deduped: the two entries would carry two different display names, and a
 * caller that registers twice has a bug worth seeing, not a preference to
 * silently honour.
 */
export class DuplicateCaseTypeError extends Error {
  /** @param {string} slug */
  constructor(slug) {
    super(
      `Case Type slug "${slug}" is already registered. A slug maps to exactly ` +
        'one display name and one importer: a second entry would split the ' +
        'registry, granting access under a group name derived from one entry ' +
        "while loading the other entry's module."
    );
    this.name = 'DuplicateCaseTypeError';
    this.slug = slug;
  }
}

export class InvalidCaseTypeConfigError extends Error {
  /**
   * @param {string} slug
   * @param {OutcomeConfigurationError} cause
   */
  constructor(slug, cause) {
    super(
      `Case Type "${slug}" has invalid outcome configuration: ${cause.message}`
    );
    this.name = 'InvalidCaseTypeConfigError';
    this.slug = slug;
  }
}

/**
 * @param {string} slug
 * @param {Record<string, CaseTypeImporter>} [importers]
 * @returns {Promise<import('../src/sharepoint-client.js').CaseTypeConfig>}
 */
export async function loadCaseTypeConfig(
  slug,
  importers = CASE_TYPE_IMPORTERS
) {
  const importer = importers[slug];
  if (!importer) {
    throw new UnknownCaseTypeError(
      slug,
      Object.keys(CASE_TYPE_IMPORTERS).sort()
    );
  }
  const mod = await importer();
  try {
    validateConfiguredOutcomeConfig(
      mod.default.questions,
      mod.default.outcomeOptions,
      mod.default.defaultOutcomeId
    );
  } catch (error) {
    if (error instanceof OutcomeConfigurationError) {
      throw new InvalidCaseTypeConfigError(slug, error);
    }
    throw error;
  }
  return mod.default;
}
