// @ts-check

/**
 * Owns conversation panel toggling, keyboard shortcuts, and element assignment.
 */
export class ConversationPanelController {
  constructor() {
    /** @type {((event: KeyboardEvent) => void) | null} */
    this.keydownHandler = null;
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
    // TODO(issue-198): Attach the click handler for the conversation toggle and
    // the Alt+C keyboard shortcut only when the machine permits conversation
    // toggling.
    void context;
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  update(context) {
    // TODO(issue-198): Assign client, saveQueue, caseId, currentUser, access,
    // hidden, and messages to cr-conversation; update toggle aria attributes.
    void context;
  }

  disconnect() {
    // TODO(issue-198): Remove any document-level keydown listener installed by
    // bind/update.
  }
}
