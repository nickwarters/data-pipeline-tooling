// @ts-check

/**
 * Owns the route header and status banner assignments.
 */
export class CaseReviewHeaderController {
  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  bind(context) {
    // TODO(issue-198): Add header-level event wiring here if any shell-owned
    // controls remain after conversation/completion are extracted.
    void context;
  }

  /**
   * @param {import('./types.js').CaseReviewShellContext} context
   */
  update(context) {
    // TODO(issue-198): Render title, reviewer, optional conversation toggle, and
    // status banner saveQueue assignment without changing visible markup.
    void context;
  }
}
