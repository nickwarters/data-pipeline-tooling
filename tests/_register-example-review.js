// @ts-check
// Registers the `example-review` test fixture into the Case Type manifest for
// the importing test.
//
// `example-review` was retired from the production manifest in issue #383, but
// it remains the canonical end-to-end fixture: its five-question catalogue,
// showWhen rule and Outcome vocabulary exercise the full case-review flow.
// Node's test runner isolates each test file in its own process, so mutating
// the manifest here is scoped to the importing test and never reaches the
// manifest-contract test that asserts production is complaints-only.
//
// Import this module for its side effect at the top of any test that needs
// `loadCaseTypeConfig('example-review')` / the question-bank importer to
// resolve.

import {
  CASE_TYPE_IMPORTERS,
  QUESTION_BANK_IMPORTERS,
} from '../case-types/manifest.js';
import { loadBank } from '../case-types/load-bank.js';

CASE_TYPE_IMPORTERS['example-review'] = () =>
  import('../dev/fixtures/example-review-case-type.js');

QUESTION_BANK_IMPORTERS['example-review'] = async () => ({
  default: await loadBank(
    new URL('../dev/fixtures/example-review-bank.txt', import.meta.url)
  ),
});
