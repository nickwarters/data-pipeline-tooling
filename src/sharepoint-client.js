// @ts-check
/**
 * A case-type-level outcome option. Questions and actions select these by id so
 * wording is configured once per Case Type. `severity` is the sort key that
 * orders outcomes (higher = worse); it is required so ordering is driven wholly
 * by config rather than inferred from a built-in default.
 *
 * @typedef {{ id: string, wording: string, severity: number }} OutcomeOption
 */

/**
 * A configured **Remediation Action** attached to a question in the Question
 * Bank. Actions attach to questions and are captured against failed Answers, but
 * they do **not** drive the Outcome — the response does (question bank redesign).
 *
 * @typedef {{ id: string, text: string }} RemediationActionDefinition
 */

/**
 * A **Remediation Action** as it lives on a Case. Elevated from a plain
 * string to a stateful record: `text` is the action wording, `status` tracks its
 * resolution after the actions are sent to the Responsible Party, and
 * `cancelReason` is required iff `status === 'cancelled'`. Stored in the the architecture decision
 * `actions`-typed Issue Capture Field value (`Answer.capture[key]`), an array of
 * these. Legacy string data is coerced to `{ id, text, status: 'pending' }` on
 * read (see `evaluators/remediation-actions.js`).
 *
 * @typedef {{ id: string, text: string, status: 'pending' | 'complete' | 'cancelled', cancelReason?: string }} RemediationAction
 */

/**
 * @typedef {{ value: string | string[], justification?: string, remediationActions?: Array<{id: string, text: string, completed: boolean}>, freeFormRemediation?: string, attributedParty?: { loginName: string, displayName: string }, remediationDetails?: Record<string, string>, capture?: Record<string, string | { loginName: string, displayName: string } | Array<string | RemediationAction>> }} Answer
 */

/**
 * A configurable per-failure capture field declared by a Case Type.
 * One shared set applies to every failed Answer; `select` values are validated
 * against `options` at capture time.
 *
 * @typedef {{ key: string, label: string, type: 'text' | 'select', options?: string[], required?: boolean }} RemediationField
 */

/**
 * One **Issue Capture Field** declared by a Case Type: a typed input
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
 * One **Issue Capture Group** declared by a Case Type: an ordered,
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
 * A case-level **Appeal**: an objection to a Completed
 * Case's Current Outcome raised by the Responsible Party or their Manager.
 * Stored additively in a `CaseRow.appeals[]` JSON blob; it never
 * mutates the frozen original Case.
 *
 * `appellant` is the bare account `loginName` of whoever raised it; `at` is the
 * ISO timestamp; `rationale` (required on raise) is the appellant's argument.
 * `citedAnswerKeys` optionally aims the reviewer at the disputed *failed*
 * Answers but does not itself set Answer values — an Appeal is case-level. The
 * lifecycle is `raised → underReview → resolved`; `resolution` (the resolver's
 * `agreed | rejected` verdict plus rationale) is stamped on resolve.
 *
 * @typedef {{
 * id: string,
 * appellant: string,
 * at: string,
 * rationale: string,
 * citedAnswerKeys?: string[],
 * state: 'raised' | 'underReview' | 'resolved',
 * resolution?: { verdict: 'agreed' | 'rejected', rationale: string, resolver: string, at: string }
 * }} Appeal
 */

/**
 * A case-level **Amended Outcome**: Controls' explicit, hand-set
 * post-completion verdict on a Completed Case. Unlike the retired Answer Override
 * this is a single additive record on the Case row — it never mutates the frozen
 * `outcomeAtCompletion`. `outcome` is the new Outcome value chosen directly;
 * `justification` is the mandatory rationale; `amendedBy` (bare account login) and
 * `amendedAt` (ISO timestamp) are captured on the record for audit rather than
 * mined from SharePoint version history. The **Current Outcome** is
 * `amendedOutcome?.outcome ?? outcomeAtCompletion`.
 *
 * @typedef {{
 * outcome: string,
 * justification: string,
 * amendedBy: string,
 * amendedAt: string,
 * fromAppealId?: string
 * }} AmendedOutcome
 */

/**
 * A Case row. The lifecycle is `In-progress → Actions In Progress → Completed`
 *; `reportableAt` is stamped at the **reportable** milestone (Send
 * Actions, or Complete Case on the no-actions path), where the Answers freeze and
 * the Outcome snapshot is taken. `completedAt` is stamped only at the final
 * `Completed` transition, so on the actions path `reportableAt` precedes it.
 *
 * `effectiveOutcome` / `effectiveHadRemediation` / `outcomeOverridden`
 * carry the corrected result for the responsible-party-team report; they
 * initialise equal to the frozen `outcomeAtCompletion` / `hadRemediation` (stamped
 * at reportable, despite the `Completion` name) and are re-fed from a case-level
 * **Amended Outcome**, not from per-Answer overrides.
 *
 * @typedef {{
 * id: string,
 * caseType: string,
 * title: string,
 * status: 'In-progress' | 'Actions In Progress' | 'Completed',
 * assignedReviewer: string,
 * responsibleParty: string,
 * answers: Record<string, Answer>,
 * conversation: Message[],
 * details?: Record<string, string>,
 * notes: string,
 * caseJustification?: string,
 * reportableAt?: string | null,
 * remediationDueDate?: string | null,
 * completedAt: string | null,
 * outcome?: string | null,
 * outcomeAtCompletion?: string,
 * questionBankVersion?: string,
 * hadRemediation?: boolean,
 * effectiveOutcome?: string,
 * effectiveHadRemediation?: boolean,
 * outcomeOverridden?: boolean,
 * amendedOutcome?: AmendedOutcome | null,
 * appeals?: Appeal[],
 * responsiblePartyManager?: string | null,
 * dueDate?: string | null,
 * relatedDate?: string | null,
 * created?: string,
 * overdue?: boolean,
 * awaitingResponsibleParty?: boolean,
 * awaitingSince?: string | null,
 * reviewRequired?: boolean,
 * hasOpenAppeal?: boolean,
 * appealRaisedAt?: string | null,
 * reopened?: boolean,
 * reopenedAt?: string | null,
 * assignedReviewerManager?: string | null,
 * etag: string
 * }} CaseRow
 */

/**
 * One **Case Details** field declared by a Case Type: a
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
 *. Bank-side only — never recorded against a Case. `color` drives the
 * editor's colour pill and is carried into the data-only reporting export.
 *
 * @typedef {{ id: string, name: string, color: string }} Label
 */

/**
 * `responseType` is one of `yes-no-na` | `single-choice` | `multi-choice` |
 * `outcome`. `yes-no-na` is single-choice with the fixed options `Yes`/`No`/`NA`;
 * `outcome` is single-choice whose options are the Case Type's configured
 * Outcomes (read-only). `optionOutcomes` maps each response option label to a
 * configured Outcome id (`OutcomeOption.id`); it is what drives the Outcome —
 * the highest-scoring applicable mapped Outcome wins. `failureCriteria` is
 * unrelated to the Outcome: it flags a failed Answer for the Issues/Remediation
 * flow.
 *
 * `labelIds` references the owning Case Type's `labels` by id. It is
 * reporting metadata only and does not affect how a question is presented.
 *
 * @typedef {{
 * id: string,
 * text: string,
 * category?: string,
 * labelIds?: string[],
 * responseType: 'yes-no-na' | 'single-choice' | 'multi-choice' | 'outcome',
 * options?: string[],
 * optionOutcomes?: Record<string, string>,
 * showWhen?: Record<string, unknown>,
 * failureCriteria?: string,
 * remediationActions?: Array<string | RemediationActionDefinition>,
 * allowFreeFormRemediation?: boolean,
 * deprecated: boolean
 * }} QuestionDefinition
 */

/**
 * A server-side Case query. Every scalar field is an ANDed
 * equality on an **indexed** Case column so a filtered `$count`/`$top` stays
 * cheap past the 5000-item threshold (ties to the architecture decision: reason-defining data is
 * hoisted onto queryable columns, never mined from the `Answers`/`appeals`
 * blobs). `awaitingResponsibleParty`, `hasOpenAppeal` and `reopened` are the
 * Action Centre reason flags. `anyOf` is an OR-of-filters (each sub-filter is
 * itself ANDed, then the sub-filters are ORed) used for the server-deduped
 * "N cases need you" headline, whose count is deliberately *not* the sum of the
 * per-reason group counts.
 *
 * `completedAfter` (inclusive) and `completedBefore` (exclusive) bound a read to a
 * `CompletedAt` window on the indexed date column. They exist so a
 * windowed completion metric leads with the selective date column and — for a
 * window that could itself exceed the List View Threshold (e.g. "completed in the
 * last 7 days" on the busy Case Type) — is summed from sub-threshold per-day
 * `$count` slices rather than one large fetch.
 *
 * @typedef {{ status?: string, assignedReviewer?: string, caseType?: string, responsibleParty?: string, overdue?: boolean, awaitingResponsibleParty?: boolean, reviewRequired?: boolean, hasOpenAppeal?: boolean, reopened?: boolean, assignedReviewerManager?: string, effectiveOutcome?: string, outcomeOverridden?: boolean, completedAfter?: string, completedBefore?: string, anyOf?: ListCasesFilter[] }} ListCasesFilter
 * @typedef {{ listName?: string, top?: number, skip?: number, orderBy?: string, orderDir?: 'asc' | 'desc' }} CaseListOptions
 */

/**
 * A directory person returned by `searchPeople`, already reduced to a bare
 * account `loginName` (claims prefix + domain stripped, see the architecture decision).
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
 * slug: string,
 * label: string,
 * generatedAt: string,
 * hash: string,
 * questions: Array<{
 * id: string,
 * text: string,
 * category: string | null,
 * responseType: string,
 * options: string[] | null,
 * optionOutcomes?: Record<string, string> | null,
 * showWhen: Record<string, unknown> | null,
 * failureCriteria: string | null,
 * remediationActions?: Array<RemediationActionDefinition> | null,
 * deprecated: boolean,
 * labelIds?: string[],
 * }>,
 * outcomeOptions?: OutcomeOption[],
 * defaultOutcomeId?: string | null,
 * }} VersionedExport
 */

/**
 * Every REST consumer codes against this interface. Both MockSharePointClient
 * and HttpSharePointClient satisfy it identically.
 *
 * @typedef {{
 * getCase: (id: string, opts?: CaseListOptions) => Promise<CaseRow|null>,
 * patchCase: (id: string, fields: Partial<CaseRow>, etag: string, opts?: CaseListOptions) => Promise<PatchResult>,
 * getQuestionDefinitions: (ids: string[]) => Promise<QuestionDefinition[]>,
 * listCases: (filter: ListCasesFilter, opts?: CaseListOptions) => Promise<CaseRow[]>,
 * countCases: (filter: ListCasesFilter, opts?: CaseListOptions) => Promise<number>,
 * getCurrentUserGroups: () => Promise<string[]>,
 * getCurrentUser: () => Promise<CurrentUser>,
 * searchPeople: (query: string) => Promise<PersonResult[]>,
 * resolveUsers: (accountNames: string[]) => Promise<Record<string, string | null>>,
 * getExportHash: (slug: string) => Promise<string | null>,
 * getVersionedExport: (slug: string, hash: string) => Promise<VersionedExport | null>
 * }} SharePointClient
 */

/**
 * @typedef {{ id: string, displayName: string }} CurrentUser
 */

/**
 * @typedef {{ outcome: string }} OutcomeResult
 */

/**
 * Per-Section configuration declared by a Case Type. Membership in the
 * `sections` object is the allow-list; `showInSummary` controls whether the
 * Section contributes a block to the read-only Summary Section.
 *
 * @typedef {{ showInSummary?: boolean, allowMessagesWhen?: ('In-progress' | 'Actions In Progress' | 'Completed')[] }} SectionConfig
 */

/**
 * Per-Case-Type appeal flow configuration. `raisedBy` names
 * the role that may raise an Appeal — the **Journey Owner** for Complaints-style
 * journeys, otherwise the **Responsible Party Manager**. `resolvedBy` is always
 * `controls` today, kept explicit so the Appeal Review gating stays data-driven.
 *
 * @typedef {{ raisedBy: 'journeyOwner' | 'responsiblePartyManager', resolvedBy: 'controls' }} AppealConfig
 */

/**
 * Shape every Case Type module must satisfy.
 *
 * @typedef {{
 * questions: QuestionDefinition[],
 * computeOutcome: (answers: Record<string, Answer>) => OutcomeResult,
 * outcomeOptions: OutcomeOption[],
 * defaultOutcomeId: string,
 * labels?: Label[],
 * eligibleGroups?: string[],
 * listName?: string,
 * reviewerGroup?: string,
 * sections?: Partial<Record<'details'|'questions'|'issues'|'summary'|'remediation'|'notes'|'conversation'|'appealRequest'|'appealReview'|'amendOutcome', SectionConfig>>,
 * appeal?: AppealConfig,
 * slaHours?: number,
 * attributeFailures?: boolean,
 * remediationFields?: RemediationField[],
 * captureGroups?: CaptureGroup[],
 * detailFields?: CaseDetailField[]
 * }} CaseTypeConfig
 */

export {};
