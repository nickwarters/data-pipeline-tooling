// @ts-check
// TODO(simplify-ui): Simplify this orchestration boundary into plain
// state transition and binding functions that can be called from function
// components. Avoid preserving controller/view-model objects as a second
// framework layer around reactive().

/**
 * @typedef {import('../../sharepoint-client.js').Answer} Answer
 * @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow
 * @typedef {import('../../sharepoint-client.js').CurrentUser} CurrentUser
 * @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition
 * @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient
 * @typedef {import('../../sharepoint-client.js').CaseListOptions} CaseListOptions
 * @typedef {import('../../services/save-queue.js').SaveQueue} SaveQueue
 * @typedef {import('../../services/section-access.js').Mode} SectionMode
 * @typedef {import('../../services/section-access.js').Section} Section
 * @typedef {import('../../lib/case-review-view-model.js').CaseReviewViewModel} CaseReviewViewModel
 */

/**
 * @typedef {object} CaseReviewTab
 * @property {'details'|'questions'|'issues'|'remediation'|'summary'|'notes'|'appealRequest'|'appealReview'|'amendOutcome'} id
 * @property {string} label
 * @property {boolean} hidden
 */

/**
 * @typedef {object} CaseReviewNodeRegistry
 * @property {HTMLElement | null} tabs
 * @property {HTMLElement | null} details
 * @property {HTMLElement | null} questionsPanel
 * @property {HTMLElement | null} questionList
 * @property {HTMLElement | null} progress
 * @property {HTMLElement | null} issues
 * @property {HTMLElement | null} remediation
 * @property {HTMLElement | null} summary
 * @property {HTMLElement | null} notes
 * @property {HTMLElement | null} appeal
 * @property {HTMLElement | null} appealReview
 * @property {HTMLElement | null} amendOutcome
 * @property {HTMLElement | null} conversation
 * @property {HTMLElement | null} banner
 * @property {HTMLButtonElement | null} conversationToggle
 * @property {HTMLElement | null} header
 * @property {HTMLButtonElement | null} completeButton
 */

/**
 * @typedef {object} CaseReviewShellContext
 * @property {CaseReviewViewModel} viewModel
 * @property {CaseReviewNodeRegistry} nodes
 * @property {(mode: SectionMode) => SectionMode} displayMode
 * @property {(caseId: string, client?: SharePointClient | null, saveQueue?: SaveQueue | null, patchFields?: Partial<CaseRow>) => Promise<void>} completeCase
 * @property {() => void} toggleConversationPanel
 */

/**
 * @typedef {object} CaseReviewController
 * @property {(context: CaseReviewShellContext) => void} bind
 * @property {(context: CaseReviewShellContext) => void} update
 * @property {() => void} [disconnect]
 */

/**
 * @typedef {object} QuestionPanelSnapshot
 * @property {QuestionDefinition[]} questions
 * @property {Record<string, Answer>} answers
 * @property {QuestionDefinition[]} catalogue
 */

/**
 * @typedef {object} CompletionRequest
 * @property {string} caseId
 * @property {SharePointClient | null} client
 * @property {SaveQueue | null} saveQueue
 * @property {Partial<CaseRow> | null} patchFields
 * @property {CaseListOptions} [opts]
 */

export {};
