// @ts-check

/**
 * Owns conversation panel toggling, keyboard shortcuts, and element assignment.
 */
// TODO(simplify-ui): Collapse this controller class into plain action and
// binding functions as the Case Review page moves to function components plus
// reactive() for local-signal UI. Avoid preserving controller classes as a
// second DOM orchestration layer.
export class ConversationPanelController {
  constructor() {
    /** @type {((event: KeyboardEvent) => void) | null} */
    this.keydownHandler = null;
    /** @type {HTMLElement | null} */
    this.toggleButton = null;
    /** @type {(() => void) | null} */
    this.togglePanel = null;
    /** @type {boolean} */
    this.clickBound = false;
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
    const { viewModel: vm, nodes } = context;
    if (!vm.machine?.canToggleConversation) {
      this.disconnect();
      return;
    }

    this.togglePanel = context.toggleConversationPanel;
    const toggle = nodes.conversationToggle;
    if (toggle && !this.clickBound) {
      toggle.addEventListener('click', () => this.togglePanel?.());
      this.toggleButton = toggle;
      this.clickBound = true;
    }

    if (!this.keydownHandler) {
      this.keydownHandler = (event) => {
        if (event.altKey && event.code === 'KeyC') {
          this.togglePanel?.();
        }
      };
      // TODO(simplify-ui): Replace this manual document listener lifecycle with
      // on(document, 'keydown', handler) from src/lib/view.js once conversation
      // event binding moves behind a route shell lifecycle.
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('keydown', this.keydownHandler);
      }
    }
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  update(context) {
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

  disconnect() {
    if (
      this.keydownHandler &&
      typeof document !== 'undefined' &&
      document.removeEventListener
    ) {
      document.removeEventListener('keydown', this.keydownHandler);
    }
    this.keydownHandler = null;
  }
}
