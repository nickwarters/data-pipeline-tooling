// @ts-check
// Barrel of the Case Review panel bindings: each panel is a pair of plain
// `bind*`/`update*` functions (no per-panel controller objects layered over
// reactive()).

export {
  CaseReviewHeaderController,
  updateCaseReviewHeader,
} from './header-controller.js';
export { createCaseReviewNodeRegistry } from './node-registry.js';
export {
  CaseReviewTabController,
  bindCaseReviewTabs,
  buildCaseReviewTabs,
  updateCaseReviewTabs,
} from './tab-controller.js';
export {
  QuestionPanelController,
  bindQuestionPanel,
  collectUnansweredQuestions,
  updateQuestionPanel,
} from './question-panel-controller.js';
export { updateNotes } from './summary-notes-appeal-controller.js';
export {
  createConversationPanelBinding,
  updateConversationPanel,
} from './conversation-controller.js';
export {
  bindCompletion,
  completeCase,
  completionControl,
  completionPatch,
  hasRemediationActions,
  updateCompletion,
} from './completion-actions.js';
