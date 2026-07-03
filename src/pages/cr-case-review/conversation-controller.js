// @ts-check

/**
 * @typedef {{
 *   keydownHandler: ((event: KeyboardEvent) => void) | null,
 *   bind: (context: import('./types.js').CaseReviewShellContext) => void,
 *   update: (context: import('./types.js').CaseReviewShellContext) => void,
 *   disconnect: () => void,
 * }} ConversationPanelBinding
 */

/**
 * Owns conversation panel toggling, keyboard shortcuts, and element assignment.
 * @returns {ConversationPanelBinding}
 */
export function createConversationPanelBinding() {
  /** @type {((event: KeyboardEvent) => void) | null} */
  let keydownHandler = null;
  /** @type {(() => void) | null} */
  let togglePanel = null;
  /** @type {boolean} */
  let clickBound = false;

  const binding = {
    get keydownHandler() {
      return keydownHandler;
    },

    /** @param {import('./types.js').CaseReviewShellContext} context */
    bind(context) {
      const { viewModel: vm, nodes } = context;
      if (!vm.machine?.canToggleConversation) {
        binding.disconnect();
        return;
      }

      togglePanel = context.toggleConversationPanel;
      const toggle = nodes.conversationToggle;
      if (toggle && !clickBound) {
        toggle.addEventListener('click', () => togglePanel?.());
        clickBound = true;
      }

      if (!keydownHandler) {
        keydownHandler = (event) => {
          if (event.altKey && event.code === 'KeyC') {
            togglePanel?.();
          }
        };
        // TODO(simplify-ui): Replace this manual document listener lifecycle
        // with on(document, 'keydown', handler) from src/lib/view.js once
        // conversation event binding moves behind a route shell lifecycle.
        if (typeof document !== 'undefined' && document.addEventListener) {
          document.addEventListener('keydown', keydownHandler);
        }
      }
    },

    /** @param {import('./types.js').CaseReviewShellContext} context */
    update(context) {
      updateConversationPanel(context);
    },

    disconnect() {
      if (
        keydownHandler &&
        typeof document !== 'undefined' &&
        document.removeEventListener
      ) {
        document.removeEventListener('keydown', keydownHandler);
      }
      keydownHandler = null;
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
