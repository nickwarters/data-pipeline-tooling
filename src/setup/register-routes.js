// @ts-check
// TODO(simplify-ui): Rework routing around route functions that compose
// plain function components returning h() nodes. Keep custom elements only for
// route/browser-integration shells, not as the unit every route has to create.

import { register as registerRoot } from '../routes/root.js';
import { register as registerDashboard } from '../routes/dashboard.js';
import { register as registerConversation } from '../routes/conversation.js';
import { register as registerQuestionBank } from '../routes/question-bank.js';
import { register as registerCase } from '../routes/case.js';
import { register as registerReports } from '../routes/reports.js';
import { register as registerTeamCases } from '../routes/team-cases.js';
import { register as registerMyCases } from '../routes/my-cases.js';

/**
 * @typedef {Object} AppContext
 * @property {import('../sharepoint-client.js').SharePointClient} client
 * @property {import('../services/save-queue.js').SaveQueue} saveQueue
 * @property {import('../sharepoint-client.js').CurrentUser} currentUser
 * @property {import('../services/permissions.js').Capabilities} capabilities
 * @property {string[]} eligibleCaseTypes
 * @property {Element} appEl
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
}
