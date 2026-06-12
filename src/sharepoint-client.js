// @ts-check

/**
 * The `value` is a string for `yes-no-na` and `single-choice` questions, and a
 * string[] for `multi-choice` questions. Empty array == unanswered.
 *
 * The optional `attributedParty` records the single person responsible for a
 * *failed* Answer (see ADR-0013): a bare account `loginName` plus a cached
 * `displayName`. Only present when the Case Type enables `attributeFailures`.
 *
 * The optional `remediationDetails` holds the Case Type's configurable
 * per-failure capture fields (ADR-0017), keyed by `RemediationField.key`. Like
 * `attributedParty` it lives only while the Answer is a failure: stripped when
 * the Answer stops failing, and frozen once the Case is Completed.
 *
 * @typedef {{ value: string | string[], justification?: string, remediationActions?: Array<{id: string, text: string, completed: boolean}>, attributedParty?: { loginName: string, displayName: string }, remediationDetails?: Record<string, string> }} Answer
 */

/**
 * A configurable per-failure capture field declared by a Case Type (ADR-0017).
 * One shared set applies to every failed Answer; `select` values are validated
 * against `options` at capture time.
 *
 * @typedef {{ key: string, label: string, type: 'text' | 'select', options?: string[], required?: boolean }} RemediationField
 */

/**
 * @typedef {{ author: string, timestamp: string, body: string }} Message
 */

/**
 * A post-completion **Answer Override** (ADR-0018): an additive, per-Answer
 * correction that *displaces* the frozen original Answer without mutating it.
 *
 * `source` is `qa` (a QA Reviewer correction, with or without a QA Check) or
 * `appeal` (authored when an Appeal is agreed); `sourceCaseId` is stamped when
 * authored during a formal QA Check, `sourceAppealId` when it resolves an
 * Appeal. `value` plus the optional `remediationActions` / `attributedParty` /
 * `remediationDetails` form a *complete replacement set* for the Answer (replace,
 * never merge). `reasoning` is mandatory.
 *
 * @typedef {{
 *   source: 'qa' | 'appeal',
 *   sourceCaseId?: string,
 *   sourceAppealId?: string,
 *   author: string,
 *   at: string,
 *   answerKey: string,
 *   value: string | string[],
 *   remediationActions?: Array<{id: string, text: string, completed: boolean}>,
 *   attributedParty?: { loginName: string, displayName: string },
 *   remediationDetails?: Record<string, string>,
 *   reasoning: string
 * }} Override
 */

/**
 * A case-level **Appeal** (issue #132, CONTEXT.md): an objection to a Completed
 * Case's Current Outcome raised by the Responsible Party or their Manager.
 * Stored additively in a `CaseRow.appeals[]` JSON blob (ADR-0007); it never
 * mutates the frozen original Case.
 *
 * `appellant` is the bare account `loginName` of whoever raised it; `at` is the
 * ISO timestamp; `rationale` (required on raise) is the appellant's argument.
 * `citedAnswerKeys` optionally aims the reviewer at the disputed *failed*
 * Answers but does not itself set Answer values — an Appeal is case-level. The
 * lifecycle is `raised → underReview → resolved`; `resolution` (the QA
 * resolver's `agreed | rejected` verdict plus rationale) is stamped on resolve.
 *
 * @typedef {{
 *   id: string,
 *   appellant: string,
 *   at: string,
 *   rationale: string,
 *   citedAnswerKeys?: string[],
 *   state: 'raised' | 'underReview' | 'resolved',
 *   resolution?: { verdict: 'agreed' | 'rejected', rationale: string, resolver: string, at: string }
 * }} Appeal
 */

/**
 * A Case row. `sourceCaseId`, when present, links a **QA Check** Case
 * (`caseType: 'qa-{slug}'`, issue #47) to the original **Completed Case** it
 * meta-reviews; standard Cases leave it empty. The link only points *at* the
 * original — Answer Overrides authored from the QA Check are still written to the
 * original row's `overrides[]` (ADR-0018), not stored here.
 *
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
 *   overrides?: Override[],
 *   appeals?: Appeal[],
 *   sourceCaseId?: string,
 *   responsiblePartyManager?: string | null,
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
 * Per-Section configuration declared by a Case Type (ADR-0016). Membership in the
 * `sections` object is the allow-list; `showInSummary` controls whether the
 * Section contributes a block to the read-only Summary Section.
 *
 * @typedef {{ showInSummary?: boolean }} SectionConfig
 */

/**
 * Shape every Case Type module must satisfy.
 *
 * @typedef {{
 *   questions: QuestionDefinition[],
 *   computeOutcome: (answers: Record<string, Answer>) => OutcomeResult,
 *   eligibleGroups?: string[],
 *   sections?: Partial<Record<'details'|'questions'|'conversation'|'notes'|'remediation'|'summary'|'appeal', SectionConfig>>,
 *   slaHours?: number,
 *   attributeFailures?: boolean,
 *   remediationFields?: RemediationField[]
 * }} CaseTypeConfig
 */

export {};
