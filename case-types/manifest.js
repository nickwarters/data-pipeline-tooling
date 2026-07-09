// @ts-check
/**
 * @typedef {() => Promise<{ default: import('../src/sharepoint-client.js').CaseTypeConfig }>} CaseTypeImporter
 * @typedef {() => Promise<{ default: import('../src/question-bank/question-bank-source.js').QuestionBank }>} QuestionBankImporter
 */

/**
 * @type {Record<string, CaseTypeImporter>}
 */
export const CASE_TYPE_IMPORTERS = {
  'example-review': () => import('./example-review.js'),
  'product-sale-review': () => import('./product-sale-review.js'),
  'stress-review': () => import('./stress-review.js'),
  complaints: () => import('./complaints.js'),
};

/**
 * @type {Record<string, QuestionBankImporter>}
 */
export const QUESTION_BANK_IMPORTERS = {
  'example-review': () =>
    import('./banks/example-review.json', { with: { type: 'json' } }).then(
      (mod) =>
        /** @type {{ default: import('../src/question-bank/question-bank-source.js').QuestionBank }} */ (
          mod
        )
    ),
  'product-sale-review': () =>
    import('./banks/product-sale-review.json', { with: { type: 'json' } }).then(
      (mod) =>
        /** @type {{ default: import('../src/question-bank/question-bank-source.js').QuestionBank }} */ (
          mod
        )
    ),
  'stress-review': () =>
    import('./banks/stress-review.json', { with: { type: 'json' } }).then(
      (mod) =>
        /** @type {{ default: import('../src/question-bank/question-bank-source.js').QuestionBank }} */ (
          mod
        )
    ),
  complaints: () =>
    import('./banks/complaints.json', { with: { type: 'json' } }).then(
      (mod) =>
        /** @type {{ default: import('../src/question-bank/question-bank-source.js').QuestionBank }} */ (
          mod
        )
    ),
};

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
 * @param {string} slug
 * @returns {Promise<import('../src/sharepoint-client.js').CaseTypeConfig>}
 */
export async function loadCaseTypeConfig(slug) {
  const importer = CASE_TYPE_IMPORTERS[slug];
  if (!importer) {
    throw new UnknownCaseTypeError(
      slug,
      Object.keys(CASE_TYPE_IMPORTERS).sort()
    );
  }
  const mod = await importer();
  return mod.default;
}
