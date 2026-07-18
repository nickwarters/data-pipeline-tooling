// @ts-check
import { register as registerRoot } from '../routes/root.js';
import { register as registerDashboard } from '../routes/dashboard.js';
import { register as registerConversation } from '../routes/conversation.js';
import { register as registerQuestionBank } from '../routes/question-bank.js';
import { register as registerCase } from '../routes/case.js';
import { register as registerReports } from '../routes/reports.js';
import { register as registerTeamCases } from '../routes/team-cases.js';
import { register as registerMyCases } from '../routes/my-cases.js';
import { register as registerJourneyCases } from '../routes/journey-cases.js';
import { register as registerDevMorph } from '../routes/dev-morph.js';
import { register as registerDevPerformance } from '../routes/dev-performance.js';

/**
 * @typedef {Object} AppContext
 * @property {import('../sharepoint-client.js').SharePointClient} client
 * @property {import('../services/save-queue.js').SaveQueue} saveQueue
 * @property {import('../sharepoint-client.js').CurrentUser} currentUser
 * @property {import('../services/permissions.js').Capabilities} capabilities
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {import('./resolve-eligible-case-types.js').CaseSource[]} caseSources
 * @property {import('./resolve-eligible-case-types.js').CaseSource[]} journeyCaseSources
 * @property {import('./resolve-eligible-case-types.js').AllocationSource[]} allocationSources
 * @property {Element} appEl
 * @property {() => Promise<unknown>} [loadQuestionBankEditor]
 * @property {() => Promise<unknown>} [loadQuestionBankSamples]
 */

/**
 * Register one route in isolation: a route module that throws during
 * registration costs only its own route, not the whole app. The try/catch is
 * exposed as a named helper (rather than inlined) so it is directly testable —
 * the `registerX` functions are static imports that cannot be made to throw
 * from a test.
 *
 * @param {string} name - route identifier, for the log message
 * @param {(router: import('../lib/router.js').Router, context: AppContext) => void} fn
 * @param {import('../lib/router.js').Router} router
 * @param {AppContext} context
 */
export function safeRegister(name, fn, router, context) {
  try {
    fn(router, context);
  } catch (err) {
    console.error(`[CORA] route registration failed: ${name}`, err);
  }
}

/**
 * @param {import('../lib/router.js').Router} router
 * @param {AppContext} context
 */
export function registerRoutes(router, context) {
  safeRegister('root', registerRoot, router, context);
  safeRegister('dashboard', registerDashboard, router, context);
  safeRegister('conversation', registerConversation, router, context);
  safeRegister('question-bank', registerQuestionBank, router, context);
  safeRegister('case', registerCase, router, context);
  safeRegister('reports', registerReports, router, context);
  safeRegister('team-cases', registerTeamCases, router, context);
  safeRegister('my-cases', registerMyCases, router, context);
  safeRegister('journey-cases', registerJourneyCases, router, context);
  // Dev-only: self-gates on ?mock=1, so it registers nothing in production.
  safeRegister('dev-morph', registerDevMorph, router, context);
  safeRegister('dev-performance', registerDevPerformance, router, context);
}
