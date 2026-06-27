// @ts-check
import { h } from '../../lib/html.js';

/**
 * Owns the route header and status banner assignments.
 */
export class CaseReviewHeaderController {
  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
    // Deviation from the scaffold TODO: there is no header-owned event wiring
    // yet. Conversation toggle clicks remain with the page until
    // ConversationPanelController is wired.
    void context;
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  update(context) {
    const { viewModel: vm, nodes } = context;
    const { caseRow, machine } = vm;
    if (!caseRow || !machine || !nodes.header || !nodes.banner) return;

    Object.assign(nodes.banner, { saveQueue: vm.saveQueue });

    const headerChildren = [
      h('h1', {}, caseRow.title),
      h('p', {}, `Reviewer: ${caseRow.assignedReviewer}`),
    ];
    if (machine.canToggleConversation && nodes.conversationToggle) {
      headerChildren.push(nodes.conversationToggle);
    }

    if (typeof nodes.header.replaceChildren === 'function') {
      nodes.header.replaceChildren(...headerChildren);
    } else {
      /** @type {any} */ (nodes.header)._children = headerChildren;
    }
  }
}
