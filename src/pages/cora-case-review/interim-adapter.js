// @ts-check
import { createCaseReviewNodeRegistry } from './node-registry.js';
import { updateNotes } from './summary-notes-appeal-controller.js';

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

  /** @returns {CaseReviewShellContext} */
  function context() {
    const { ensure: _ensure, ...nodeFields } = registry.ensure();
    return {
      viewModel,
      nodes: /** @type {any} */ (nodeFields),
      displayMode: (mode) => mode,
      completeCase: async () => {},
      toggleConversationPanel() {
        viewModel.toggleConversationPanel();
        modelChanged();
      },
    };
  }

  function update() {
    const ctx = context();
    if (!viewModel.loaded.get() || !viewModel.caseRow) return;
    updateNotes(ctx);
  }

  return {
    update,
    get panels() {
      const nodes = registry.ensure();
      return /** @type {Record<string, Node>} */ ({
        notes: nodes.notes,
        appealRequest: nodes.appeal,
        appealReview: nodes.appealReview,
        amendOutcome: nodes.amendOutcome,
      });
    },
  };
}
