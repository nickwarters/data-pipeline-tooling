// @ts-check
// TODO(simplify-ui): Simplify this orchestration boundary into plain
// state transition and binding functions that can be called from function
// components. Avoid preserving controller/view-model objects as a second
// framework layer around reactive().

export {
  CaseReviewHeaderController,
  updateCaseReviewHeader,
} from './header-controller.js';
export {
  CaseReviewNodeRegistry,
  createCaseReviewNodeRegistry,
} from './node-registry.js';
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
export {
  RemediationPanelController,
  bindRemediationPanel,
  updateRemediationPanel,
} from './remediation-controller.js';
export {
  SummaryNotesAppealController,
  updateSummaryNotesAppeal,
} from './summary-notes-appeal-controller.js';
export {
  ConversationPanelController,
  createConversationPanelBinding,
  updateConversationPanel,
} from './conversation-controller.js';
export {
  CompletionController,
  bindCompletion,
  completeCase,
  updateCompletion,
} from './completion-controller.js';
export {
  SourceCaseController,
  updateSourceCase,
} from './source-case-controller.js';
