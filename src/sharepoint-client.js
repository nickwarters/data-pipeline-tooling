// @ts-check

/**
 * @typedef {{ value: string, justification?: string, remediationActions?: Array<{id: string, text: string, completed: boolean}> }} Answer
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
 *   etag: string
 * }} CaseRow
 */

/**
 * @typedef {{
 *   id: string,
 *   text: string,
 *   responseType: 'yes-no-na' | 'single-choice' | 'multi-choice',
 *   options?: string[],
 *   showWhen?: Record<string, unknown>,
 *   failureCriteria?: string,
 *   remediationActions?: string[],
 *   deprecated: boolean
 * }} QuestionDefinition
 */

/**
 * @typedef {{ status?: string, assignedReviewer?: string }} ListCasesFilter
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
 *   getCurrentUserGroups: () => Promise<string[]>
 * }} SharePointClient
 */

export {};
