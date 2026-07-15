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

/**
 * @typedef {Object} AppContext
 * @property {import('../sharepoint-client.js').SharePointClient} client
 * @property {import('../services/save-queue.js').SaveQueue} saveQueue
 * @property {import('../sharepoint-client.js').CurrentUser} currentUser
 * @property {import('../services/permissions.js').Capabilities} capabilities
 * @property {import('./resolve-eligible-case-types.js').CaseSource[]} caseSources
 * @property {import('./resolve-eligible-case-types.js').CaseSource[]} journeyCaseSources
 * @property {import('./resolve-eligible-case-types.js').AllocationSource[]} allocationSources
 * @property {Element} appEl
 * @property {() => Promise<unknown>} [loadQuestionBankEditor]
 * @property {() => Promise<unknown>} [loadQuestionBankSamples]
 */

/**
 * @param {import('../lib/router.js').Router} router
 * @param {AppContext} context
 */
export function registerRoutes(router, context) {
  registerRoot(router, context);
  registerDashboard(router, context);
  registerConversation(router, context);
  registerQuestionBank(router, context);
  registerCase(router, context);
  registerReports(router, context);
  registerTeamCases(router, context);
  registerMyCases(router, context);
  registerJourneyCases(router, context);
}
