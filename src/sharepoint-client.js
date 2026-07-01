// @ts-check
// TODO(simplify-ui): Keep service access as explicit plain dependencies
// passed into route shells/function components. The simplified UI should not
// require component authors to understand service classes, global singletons,
// or lifecycle wiring to perform ordinary reads and writes.

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
 * The optional `capture` is the unified **Issue Capture** map (ADR-0020): every
 * value captured against a *failed* Answer, keyed by `CaptureField.key`. It
 * supersedes `attributedParty` + `remediationDetails`, widening the value type to
 * also carry a `person` `{loginName,displayName}` or an `actions` array. It
 * shares the same lifecycle — stripped when the Answer stops failing, frozen once
 * the Case is Completed.
 *
 * @typedef {{ outcome: string, wording: string, severity?: number }} OutcomeDescriptor
 */

/**
 * A case-type-level outcome option. Questions and actions select these by id so
 * wording is configured once per Case Type.
 *
 * @typedef {{ id: string, wording: string, severity?: number }} OutcomeOption
 */

/**
 * @typedef {{ id: string, text: string, outcomeId?: string, outcome?: OutcomeDescriptor }} RemediationActionDefinition
 */

/**
 * @typedef {{ value: string | string[], justification?: string, remediationActions?: Array<{id: string, text: string, completed: boolean}>, attributedParty?: { loginName: string, displayName: string }, remediationDetails?: Record<string, string>, capture?: Record<string, string | { loginName: string, displayName: string } | Array<{id: string, text: string, completed: boolean}>> }} Answer
 */

/**
 * A configurable per-failure capture field declared by a Case Type (ADR-0017).
 * One shared set applies to every failed Answer; `select` values are validated
 * against `options` at capture time.
 *
 * @typedef {{ key: string, label: string, type: 'text' | 'select', options?: string[], required?: boolean }} RemediationField
 */

/**
 * One **Issue Capture Field** declared by a Case Type (ADR-0020): a typed input
 * captured against a *failed* Answer. The closed type set is
 * `text | textarea | select | radio | person | actions`; this slice exercises
 * only the four string types. `options` lists the choices for `select`/`radio`
 * (validated at capture time). `required` participates in the completion gate
 * only while the field is visible. `role` is an optional cross-Case-Type
 * reporting tag (not yet built). `showWhen` conditions on a sibling field on the
 * same Answer (not yet built).
 *
 * @typedef {{ key: string, label: string, type: 'text' | 'textarea' | 'select' | 'radio' | 'person' | 'actions', options?: string[], required?: boolean, role?: string, showWhen?: Record<string, unknown> }} CaptureField
 */

/**
 * One **Issue Capture Group** declared by a Case Type (ADR-0020): an ordered,
 * collapsible presentation grouping of `CaptureField`s. Groups are presentation
 * only — they are not part of storage, so an Owner can move a field between
 * groups without migrating data. `collapsed` is the default collapse state.
 *
 * @typedef {{ key: string, label: string, collapsed?: boolean, fields: CaptureField[] }} CaptureGroup
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
 *   details?: Record<string, string>,
 *   notes: string,
 *   caseJustification?: string,
 *   completedAt: string | null,
 *   outcome?: string | null,
 *   outcomeAtCompletion?: string,
 *   questionBankVersion?: string,
 *   hadRemediation?: boolean,
 *   effectiveOutcome?: string,
 *   effectiveHadRemediation?: boolean,
 *   outcomeOverridden?: boolean,
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
 * One **Case Details** field declared by a Case Type (ADR-0014, issue #213): a
 * descriptive fact that frames the review — a customer identifier, account
 * number, product metadata, a relevant date. The set is declared per Case Type
 * so different types surface different details. `key` is the stable storage key
 * (matches a `CaseRow.details` entry); `label` is the display caption. Read-only
 * everywhere — Case Details is never editable (CONTEXT.md).
 *
 * @typedef {{ key: string, label: string }} CaseDetailField
 */

/**
 * A reporting **Label** assigned to Question Definitions from the question bank
 * (ADR-0015). Bank-side only — never recorded against a Case. `color` drives the
 * editor's colour pill and is carried into the data-only reporting export.
 *
 * @typedef {{ id: string, name: string, color: string }} Label
 */

/**
 * `labelIds` references the owning Case Type's `labels` by id (ADR-0015). It is
 * reporting metadata only and does not affect how a question is presented.
 *
 * @typedef {{
 *   id: string,
 *   text: string,
 *   category?: string,
 *   labelIds?: string[],
 *   responseType: 'yes-no-na' | 'single-choice' | 'multi-choice',
 *   options?: string[],
 *   showWhen?: Record<string, unknown>,
 *   failureCriteria?: string,
 *   outcome?: { noActionOutcomeId?: string, noAction?: OutcomeDescriptor },
 *   remediationActions?: Array<string | RemediationActionDefinition>,
 *   deprecated: boolean
 * }} QuestionDefinition
 */

/**
 * @typedef {{ status?: string, assignedReviewer?: string, caseType?: string, responsibleParty?: string, overdue?: boolean, assignedReviewerManager?: string, effectiveOutcome?: string, outcomeOverridden?: boolean }} ListCasesFilter
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
 * Data-only snapshot of a versioned Question Bank export (`{slug}.{hash}.json`).
 * Contains everything from the compile-time bank except the labels presentation
 * table (label name/color is resolved from the current `{slug}.json` instead).
 *
 * @typedef {{
 *   slug: string,
 *   label: string,
 *   generatedAt: string,
 *   hash: string,
 *   questions: Array<{
 *     id: string,
 *     text: string,
 *     category: string | null,
 *     responseType: string,
 *     options: string[] | null,
 *     showWhen: Record<string, unknown> | null,
 *     failureCriteria: string | null,
 *     outcome?: { noActionOutcomeId?: string, noAction?: OutcomeDescriptor } | null,
 *     remediationActions?: Array<RemediationActionDefinition> | null,
 *     deprecated: boolean,
 *     labelIds?: string[],
 *   }>,
 *   outcomeOptions?: OutcomeOption[],
 *   defaultOutcomeId?: string | null,
 * }} VersionedExport
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
 *   resolveUsers: (accountNames: string[]) => Promise<Record<string, string | null>>,
 *   getExportHash: (slug: string) => Promise<string | null>,
 *   getVersionedExport: (slug: string, hash: string) => Promise<VersionedExport | null>
 * }} SharePointClient
 */

/**
 * @typedef {{ id: string, displayName: string }} CurrentUser
 */

/**
 * @typedef {{ outcome: string, wording?: string }} OutcomeResult
 */

/**
 * Per-Section configuration declared by a Case Type (ADR-0016). Membership in the
 * `sections` object is the allow-list; `showInSummary` controls whether the
 * Section contributes a block to the read-only Summary Section.
 *
 * @typedef {{ showInSummary?: boolean, allowMessagesWhen?: ('In-progress' | 'Actions In Progress' | 'Completed')[] }} SectionConfig
 */

/**
 * Shape every Case Type module must satisfy.
 *
 * @typedef {{
 *   questions: QuestionDefinition[],
 *   computeOutcome: (answers: Record<string, Answer>) => OutcomeResult,
 *   outcomeOptions?: OutcomeOption[],
 *   defaultOutcomeId?: string,
 *   labels?: Label[],
 *   eligibleGroups?: string[],
 *   sections?: Partial<Record<'details'|'questions'|'conversation'|'notes'|'remediation'|'summary'|'appeal', SectionConfig>>,
 *   slaHours?: number,
 *   attributeFailures?: boolean,
 *   remediationFields?: RemediationField[],
 *   captureGroups?: CaptureGroup[],
 *   detailFields?: CaseDetailField[]
 * }} CaseTypeConfig
 */

export {};
