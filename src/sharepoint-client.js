// @ts-check

/**
 * The `value` is a string for `yes-no-na` and `single-choice` questions, and a
 * string[] for `multi-choice` questions. Empty array == unanswered.
 *
 * @typedef {{ value: string | string[], justification?: string, remediationActions?: Array<{id: string, text: string, completed: boolean}> }} Answer
 */

/**
 * @typedef {{ author: string, timestamp: string, body: string }} Message
 */

/**
 * @typedef {{
 *   id: string,
 *   caseType: string,
 *   title: string,
 *   status: 'In-progress' | 'Completed',
 *   assignedReviewer: string,
 *   responsibleParty: string,
 *   answers: Record<string, Answer>,
 *   conversation: Message[],
 *   notes: string,
 *   completedAt: string | null,
 *   outcome?: string | null,
 *   dueDate?: string | null,
 *   relatedDate?: string | null,
 *   created?: string,
 *   etag: string
 * }} CaseRow
 */

/**
 * @typedef {{
 *   id: string,
 *   text: string,
 *   category?: string,
 *   responseType: 'yes-no-na' | 'single-choice' | 'multi-choice',
 *   options?: string[],
 *   showWhen?: Record<string, unknown>,
 *   failureCriteria?: string,
 *   remediationActions?: string[],
 *   deprecated: boolean
 * }} QuestionDefinition
 */

/**
 * @typedef {{ status?: string, assignedReviewer?: string, caseType?: string, responsibleParty?: string }} ListCasesFilter
 */

/**
 * @typedef {{ ok: boolean, status: number, data?: CaseRow }} PatchResult
 */

/**
 * Every REST consumer codes against this interface. Both MockSharePointClient
 * and HttpSharePointClient satisfy it identically.
 *
 * @typedef {{
 *   getCase: (id: string) => Promise<CaseRow|null>,
 *   patchCase: (id: string, fields: Partial<CaseRow>, etag: string) => Promise<PatchResult>,
 *   getQuestionDefinitions: (ids: string[]) => Promise<QuestionDefinition[]>,
 *   listCases: (filter: ListCasesFilter) => Promise<CaseRow[]>,
 *   getCurrentUserGroups: () => Promise<string[]>,
 *   getCurrentUser: () => Promise<CurrentUser>
 * }} SharePointClient
 */

/**
 * @typedef {{ id: string, displayName: string }} CurrentUser
 */

/**
 * @typedef {{ verdict: 'pass' | 'fail' }} OutcomeResult
 */

/**
 * Shape every Case Type module must satisfy.
 *
 * @typedef {{
 *   questions: QuestionDefinition[],
 *   computeOutcome: (answers: Record<string, Answer>) => OutcomeResult,
 *   eligibleGroups?: string[],
 *   sections?: Array<'questions'|'conversation'|'notes'|'remediation'|'outcome'>
 * }} CaseTypeConfig
 */

export {};
