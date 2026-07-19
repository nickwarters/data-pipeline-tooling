// @ts-check
import { createCaseReviewNodeRegistry } from './node-registry.js';
import {
  bindRemediationPanel,
  updateRemediationPanel,
} from './remediation-controller.js';
import {
  bindRemediationTracking,
  updateRemediationTracking,
} from './remediation-tracking-controller.js';
import { updateSummaryNotesAppeal } from './summary-notes-appeal-controller.js';
import { updateAmendOutcome } from './amend-outcome-controller.js';
import { updateAppealReview } from './appeal-review-controller.js';
import { createConversationPanelBinding } from './conversation-controller.js';
import {
  bindCompletion,
  completeCase,
  updateCompletion,
} from './completion-controller.js';

/** @typedef {import('../../lib/case-review-view-model.js').CaseReviewViewModel} CaseReviewViewModel */
/** @typedef {import('../../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('./types.js').CaseReviewShellContext} CaseReviewShellContext */

/**
 * Keeps the not-yet-converted Section components working behind the CASE-1
 * store-driven shell. The adapter owns their stable nodes and old event
 * bindings; it deliberately does not own tab selection or Case Details.
 *
 * @param {{
 *   viewModel: CaseReviewViewModel,
 *   client: SharePointClient,
 *   saveQueue: SaveQueue,
 *   modelChanged: () => void,
 * }} input
 */
export function createCaseReviewInterimAdapter({
  viewModel,
  client,
  saveQueue,
  modelChanged,
}) {
  const registry = createCaseReviewNodeRegistry();
  const conversation = createConversationPanelBinding();
  let bound = false;

  /** @returns {CaseReviewShellContext} */
  function context() {
    const { ensure: _ensure, ...nodeFields } = registry.ensure();
    return {
      viewModel,
      nodes: /** @type {any} */ (nodeFields),
      displayMode: (mode) => mode,
      completeCase: (caseId, nextClient, nextQueue, patchFields) =>
        completeCase({
          caseId,
          client: nextClient ?? client,
          saveQueue: nextQueue ?? saveQueue,
          patchFields: patchFields ?? null,
          opts: viewModel.caseListOptions,
        }),
      toggleConversationPanel() {
        viewModel.toggleConversationPanel();
        modelChanged();
      },
    };
  }

  function update() {
    const ctx = context();
    if (!bound && viewModel.loaded.get() && viewModel.caseRow) {
      bound = true;
      bindRemediationPanel(ctx);
      bindRemediationTracking(ctx);
      conversation.bind(ctx);
      bindCompletion(ctx);
    }
    if (!viewModel.loaded.get() || !viewModel.caseRow) return;
    updateRemediationPanel(ctx);
    updateRemediationTracking(ctx);
    updateSummaryNotesAppeal(ctx);
    updateAmendOutcome(ctx);
    updateAppealReview(ctx);
    conversation.update(ctx);
    updateCompletion(ctx);
  }

  return {
    update,
    handleKeydown: (/** @type {KeyboardEvent} */ event) =>
      conversation.handleKeydown(event),
    get panels() {
      const nodes = registry.ensure();
      return /** @type {Record<string, Node>} */ ({
        issues: nodes.issues,
        remediation: nodes.remediation,
        summary: nodes.summary,
        notes: nodes.notes,
        appealRequest: nodes.appeal,
        appealReview: nodes.appealReview,
        amendOutcome: nodes.amendOutcome,
      });
    },
    get conversation() {
      return registry.ensure().conversation;
    },
    get conversationToggle() {
      return viewModel.machine?.canToggleConversation
        ? registry.ensure().conversationToggle
        : null;
    },
    get completeButton() {
      return registry.ensure().completeButton;
    },
  };
}
