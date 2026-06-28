// @ts-check
import { h } from '../../lib/html.js';

/** @typedef {import('./types.js').CaseReviewNodeRegistry} CaseReviewNodeRegistryShape */

/**
 * Owns long-lived nodes for the Case Review page shell.
 *
 * TODO(issue-198): Move the existing CRCaseReview node reuse here without
 * changing element identity expectations that current tests depend on.
 */
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
    /** @type {CaseReviewNodeRegistryShape['overrideEditor']} */
    this.overrideEditor = null;
    /** @type {CaseReviewNodeRegistryShape['remediation']} */
    this.remediation = null;
    /** @type {CaseReviewNodeRegistryShape['summary']} */
    this.summary = null;
    /** @type {CaseReviewNodeRegistryShape['notes']} */
    this.notes = null;
    /** @type {CaseReviewNodeRegistryShape['appeal']} */
    this.appeal = null;
    /** @type {CaseReviewNodeRegistryShape['conversation']} */
    this.conversation = null;
    /** @type {CaseReviewNodeRegistryShape['sourceCase']} */
    this.sourceCase = null;
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
    this.overrideEditor ??= h('cr-override-editor');
    this.remediation ??= h('cr-remediation-section');
    this.summary ??= h('cr-summary');
    this.notes ??= h('cr-notes');
    this.appeal ??= h('cr-appeal');
    this.conversation ??= h('cr-conversation');
    this.sourceCase ??= h('cr-source-case');
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
