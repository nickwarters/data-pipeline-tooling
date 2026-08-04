// @ts-check
// Registers the `example-review` test fixture into the Case Type manifest for
// the importing test.
//
// `example-review` was retired from the production manifest, but
// it remains the canonical end-to-end fixture: its five-question catalogue,
// showWhen rule and Outcome vocabulary exercise the full case-review flow.
// Node's test runner isolates each test file in its own process, so mutating
// the manifest here is scoped to the importing test and never reaches the
// manifest-contract test that asserts production is complaints-only.
//
// Import this module for its side effect at the top of any test that needs
// `loadCaseTypeConfig('example-review')` / the question-bank importer to
// resolve.

// Registration goes through `CASE_TYPES`, never straight into the
// derived importer maps: the registry is where a Case Type's `displayName`
// lives, and eligibility composes `Reviewers - Example Review` and its two
// siblings from it. Writing only to the derived maps would leave the fixture
// nameless — the exact divergence this helper must not model.

import { registerCaseType } from '../case-types/manifest.js';
import { loadBank } from '../case-types/load-bank.js';

registerCaseType({
  slug: 'example-review',
  displayName: 'Example Review',
  importer: () => import('./_example-review-case-type.js'),
  bank: async () => ({
    default: await loadBank(
      new URL('./_example-review-bank.txt', import.meta.url)
    ),
  }),
});
