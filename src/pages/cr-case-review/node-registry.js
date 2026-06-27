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
    // TODO(issue-198): Create the existing cr-tabs, cr-case-details,
    // cr-question-list, cr-section-progress, cr-override-editor,
    // cr-remediation-section, cr-summary, cr-notes, cr-appeal,
    // cr-conversation, cr-source-case, cr-status-banner, header, and button
    // nodes here.
    void h;
    return this;
  }
}

/**
 * @returns {CaseReviewNodeRegistry}
 */
export function createCaseReviewNodeRegistry() {
  // TODO(issue-198): Return the page-level registry used by CRCaseReview.
  return new CaseReviewNodeRegistry();
}
