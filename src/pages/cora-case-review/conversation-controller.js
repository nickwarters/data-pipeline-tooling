// @ts-check

/**
 * @typedef {{
 * bind: (context: import('./types.js').CaseReviewShellContext) => void,
 * handleKeydown: (event: KeyboardEvent) => void,
 * update: (context: import('./types.js').CaseReviewShellContext) => void,
 * }} ConversationPanelBinding
 */

/**
 * Owns conversation panel toggling, its Alt+C keyboard shortcut, and element
 * assignment. The document-level keydown listener is not managed here: the
 * Case Review route shell registers `handleKeydown` through `on(document,
 * 'keydown', …)` from src/lib/view.js, so teardown rides the shell's reactive
 * lifecycle instead of a hand-rolled add/removeEventListener pair.
 *
 * @returns {ConversationPanelBinding}
 */
export function createConversationPanelBinding() {
  /** @type {(() => void) | null} */
  let togglePanel = null;
  /** @type {boolean} */
  let clickBound = false;

  const binding = {
    /** @param {import('./types.js').CaseReviewShellContext} context */
    bind(context) {
      const { viewModel: vm, nodes } = context;
      if (!vm.machine?.canToggleConversation) return;

      togglePanel = context.toggleConversationPanel;
      const toggle = nodes.conversationToggle;
      if (toggle && !clickBound) {
        toggle.addEventListener('click', () => togglePanel?.());
        clickBound = true;
      }
    },

    /**
     * Alt+C toggles the conversation panel. Inert until `bind` has captured the
     * toggle callback (i.e. when the Case allows toggling).
     * @param {KeyboardEvent} event
     */
    handleKeydown(event) {
      if (event.altKey && event.code === 'KeyC') togglePanel?.();
    },

    /** @param {import('./types.js').CaseReviewShellContext} context */
    update(context) {
      updateConversationPanel(context);
    },
  };

  return binding;
}

/**
 * @param {import('./types.js').CaseReviewShellContext} context
 */
export function updateConversationPanel(context) {
  const { viewModel: vm, nodes } = context;
  const conversation = nodes.conversation;
  const { caseRow, currentUser, access } = vm;
  if (!conversation || !caseRow || !currentUser) return;

  Object.assign(conversation, {
    client: vm.client,
    saveQueue: vm.saveQueue,
    caseId: caseRow.id,
    currentUser,
    access: context.displayMode(access.conversation),
    hidden: vm.conversationHidden.get(),
    _messages: caseRow.conversation.slice(),
  });

  if (vm.machine?.canToggleConversation && nodes.conversationToggle) {
    nodes.conversationToggle.setAttribute(
      'aria-expanded',
      String(!vm.conversationHidden.get())
    );
    nodes.conversationToggle.setAttribute(
      'aria-label',
      'Toggle conversation panel (⌥C / Alt+C)'
    );
    nodes.conversationToggle.textContent = 'Conversation';
  }
}
