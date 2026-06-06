// @ts-check

/**
 * The `value` is a string for `yes-no-na` and `single-choice` questions, and a
 * string[] for `multi-choice` questions. Empty array == unanswered.
 *
 * The optional `attributedParty` records the single person responsible for a
 * *failed* Answer (see ADR-0013): a bare account `loginName` plus a cached
 * `displayName`. Only present when the Case Type enables `attributeFailures`.
 *
 * @typedef {{ value: string | string[], justification?: string, remediationActions?: Array<{id: string, text: string, completed: boolean}>, attributedParty?: { loginName: string, displayName: string } }} Answer
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
 *   caseJustification?: string,
 *   completedAt: string | null,
 *   outcome?: string | null,
 *   outcomeAtCompletion?: string,
 *   hadRemediation?: boolean,
 *   dueDate?: string | null,
 *   relatedDate?: string | null,
 *   created?: string,
 *   overdue?: boolean,
 *   assignedReviewerManager?: string | null,
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
 * @typedef {{ status?: string, assignedReviewer?: string, caseType?: string, responsibleParty?: string, overdue?: boolean, assignedReviewerManager?: string }} ListCasesFilter
 */

/**
 * A directory person returned by `searchPeople`, already reduced to a bare
 * account `loginName` (claims prefix + domain stripped, see ADR-0013).
 *
 * @typedef {{ loginName: string, displayName: string, email?: string }} PersonResult
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
 *   getCurrentUser: () => Promise<CurrentUser>,
 *   searchPeople: (query: string) => Promise<PersonResult[]>,
 *   resolveUsers: (accountNames: string[]) => Promise<Record<string, string | null>>
 * }} SharePointClient
 */

/**
 * @typedef {{ id: string, displayName: string }} CurrentUser
 */

/**
 * @typedef {{ verdict: 'pass' | 'refer' | 'fail' }} OutcomeResult
 */

/**
 * Shape every Case Type module must satisfy.
 *
 * @typedef {{
 *   questions: QuestionDefinition[],
 *   computeOutcome: (answers: Record<string, Answer>) => OutcomeResult,
 *   eligibleGroups?: string[],
 *   sections?: Array<'details'|'questions'|'conversation'|'notes'|'remediation'|'summary'>,
 *   slaHours?: number,
 *   attributeFailures?: boolean
 * }} CaseTypeConfig
 */

export {};
