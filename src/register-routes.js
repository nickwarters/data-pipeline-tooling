// @ts-check

import { register as registerRoot } from './routes/root.js';
import { register as registerDashboard } from './routes/dashboard.js';
import { register as registerConversation } from './routes/conversation.js';
import { register as registerQuestionBank } from './routes/question-bank.js';
import { register as registerCase } from './routes/case.js';

/**
 * @typedef {Object} AppContext
 * @property {import('./sharepoint-client.js').SharePointClient} client
 * @property {import('./save-queue.js').SaveQueue} saveQueue
 * @property {import('./sharepoint-client.js').CurrentUser} currentUser
 * @property {import('./permissions.js').Capabilities} capabilities
 * @property {string[]} eligibleCaseTypes
 * @property {Element} appEl
 */

/**
 * @param {import('./router.js').Router} router
 * @param {AppContext} context
 */
export function registerRoutes(router, context) {
  registerRoot(router, context);
  registerDashboard(router, context);
  registerConversation(router, context);
  registerQuestionBank(router, context);
  registerCase(router, context);
}
