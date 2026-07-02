// @ts-check
import { h } from '../../lib/html.js';

/** @typedef {import('./types.js').CaseReviewNodeRegistry} CaseReviewNodeRegistryShape */

/**
 * Owns long-lived nodes for the Case Review page shell.
 *
 * TODO(issue-198): Move the existing CRCaseReview node reuse here without
 * changing element identity expectations that current tests depend on.
 */
// TODO(simplify-ui): Collapse this controller class into plain action and
// binding functions as the Case Review page moves to function components plus
// reactive() for local-signal UI. Avoid preserving controller classes as a
// second DOM orchestration layer.
export class CaseReviewNodeRegistry {
  constructor() {
    /** @type {CaseReviewNodeRegistryShape['tabs']} */
    this.tabs = null;
    /** @type {CaseReviewNodeRegistryShape['details']} */
    this.details = null;
    /** @type {CaseReviewNodeRegistryShape['questionsPanel']} */
    this.questionsPanel = null;
    /** @type {CaseReviewNodeRegistryShape['questionList']} */
    this.questionList = null;
    /** @type {CaseReviewNodeRegistryShape['progress']} */
    this.progress = null;
    /** @type {CaseReviewNodeRegistryShape['issues']} */
    this.issues = null;
    /** @type {CaseReviewNodeRegistryShape['remediation']} */
    this.remediation = null;
    /** @type {CaseReviewNodeRegistryShape['summary']} */
    this.summary = null;
    /** @type {CaseReviewNodeRegistryShape['notes']} */
    this.notes = null;
    /** @type {CaseReviewNodeRegistryShape['appeal']} */
    this.appeal = null;
    /** @type {CaseReviewNodeRegistryShape['appealReview']} */
    this.appealReview = null;
    /** @type {CaseReviewNodeRegistryShape['amendOutcome']} */
    this.amendOutcome = null;
    /** @type {CaseReviewNodeRegistryShape['conversation']} */
    this.conversation = null;
    /** @type {CaseReviewNodeRegistryShape['banner']} */
    this.banner = null;
    /** @type {CaseReviewNodeRegistryShape['conversationToggle']} */
    this.conversationToggle = null;
    /** @type {CaseReviewNodeRegistryShape['header']} */
    this.header = null;
    /** @type {CaseReviewNodeRegistryShape['completeButton']} */
    this.completeButton = null;
  }

  /**
   * @returns {CaseReviewNodeRegistry}
   */
  ensure() {
    this.tabs ??= h('cr-tabs');
    this.details ??= h('cr-case-details');
    this.questionsPanel ??= h('section');
    this.questionList ??= h('cr-question-list');
    this.progress ??= h('cr-section-progress');
    this.issues ??= h('cr-remediation-section');
    this.remediation ??= h('cr-remediation-tracking');
    this.summary ??= h('cr-summary');
    this.notes ??= h('cr-notes');
    this.appeal ??= h('cr-appeal');
    this.appealReview ??= h('cr-appeal-review');
    this.amendOutcome ??= h('cr-amend-outcome');
    this.conversation ??= h('cr-conversation');
    this.banner ??= h('cr-status-banner');
    this.conversationToggle ??= /** @type {HTMLButtonElement} */ (
      h('button', { class: 'cr-conversation-toggle-btn' })
    );
    this.header ??= h('header');
    this.completeButton ??= /** @type {HTMLButtonElement} */ (
      h('button', { class: 'cr-complete-btn' })
    );
    return this;
  }
}

/**
 * @returns {CaseReviewNodeRegistry}
 */
export function createCaseReviewNodeRegistry() {
  return new CaseReviewNodeRegistry();
}
