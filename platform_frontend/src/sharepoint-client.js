// @ts-check

/** The persisted Case lifecycle vocabulary, defined on the retained contract. */
export const CASE_STATUS = Object.freeze(
  /** @type {const} */ ({
    IN_PROGRESS: 'In-progress',
    ACTIONS_IN_PROGRESS: 'Actions In Progress',
    COMPLETED: 'Completed',
    VOID: 'Void',
  })
);
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
 * A **Remediation Action** as it lives on a Case: `text` is the action wording,
 * `status` tracks its resolution, and `cancelReason` is required iff
 * `status === 'cancelled'`. Stored in the `actions`-typed Issue Capture Field
 * value (`Answer.capture[key]`), an array of these.
 *
 * A retired store, kept only as a shape: nothing writes or reads one, and
 * resolution is question-level in `remediationStatus`. The typedef
 * stays because a persisted Answers blob may still carry such an array under
 * `capture`.
 *
 * @typedef {{ id: string, text: string, status: 'pending' | 'complete' | 'cancelled', cancelReason?: string }} RemediationAction
 */

/**
 * The **question-level Remediation resolution**: how the whole of one
 * Answer's remediation ended up, recorded by the Assigned Reviewer on the
 * Remediation tab once the actions have been sent. `details` carries the free
 * text a non-`complete` resolution requires — *details* for `partial`, a
 * *justification* for `cancelled` — and is absent on `complete`. See
 * `evaluators/remediation-status.js`, its single reader/writer.
 *
 * @typedef {'complete' | 'partial' | 'cancelled'} RemediationStatusValue
 * @typedef {{ status: RemediationStatusValue, details?: string }} RemediationStatus
 */

/**
 * One Answer to an Applicable Question. Resolution is question-level, in
 * `remediationStatus`, not per selected Remediation Action. An
 * unknown key round-trips harmlessly through the JSON blob, so a blob written
 * under an older shape needs no migration.
 *
 * `remediationRequired` is the Reviewer's explicit decision on a *failed*
 * Answer. It is deliberately `'yes' | 'no'` rather than a boolean because
 * absence has to stay distinguishable from "no" once the Answers map is
 * serialised — undecided blocks completion, decided-no does not, and a `false`
 * written into the JSON blob reads the same as a field that was never there.
 *
 * @typedef {{ value: string | string[], justification?: string, remediationRequired?: 'yes' | 'no', remediationActions?: Array<{id: string, text: string}>, freeFormRemediation?: string, remediationStatus?: RemediationStatus, capture?: Record<string, string | { loginName: string, displayName: string } | Array<string | RemediationAction>> }} Answer
 */

/**
 * One **Issue Capture Field** declared by a Case Type: a typed input captured
 * against a *failed* Answer. `options` lists the choices for `select`/`radio`
 * (validated at capture time); a `person` is chosen from the directory and
 * stored as `{ loginName, displayName }`. `showWhen` conditions the field on a
 * sibling field of the same group, in the same operator vocabulary a Question
 * Definition uses, and a field it hides loses its stored value on the next
 * write. `required` holds the Case out of completion while the field is
 * *visible* and empty on a failed Answer. `role` is an optional cross-Case-Type
 * reporting tag (not yet built). `placeholder` is hint text for `text`/`textarea`,
 * ignored for choice types.
 *
 * `'actions'` is **not** declarable: per-action Remediation tracking moved to
 * `answer.remediationStatus`, and nothing renders or validates such a field.
 *
 * @typedef {{ key: string, label: string, type: 'text' | 'textarea' | 'select' | 'radio' | 'person', options?: string[], required?: boolean, role?: string, showWhen?: Record<string, unknown>, placeholder?: string }} CaptureField
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
 * One **General Question** declared by a Case Type: a `CaptureField` restricted
 * to the types the General Questions section actually renders. `person` and
 * `actions` are excluded — a General Question answer is a plain string, and the
 * Review tab holds no people-search state to feed a picker — and
 * `validateGeneralQuestions` rejects them at load time rather than shipping a
 * field that cannot work.
 *
 * @typedef {{ key: string, label: string, type: 'text' | 'textarea' | 'select' | 'radio', options?: string[], placeholder?: string }} GeneralQuestionField
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
 * post-completion verdict on a Completed Case. A single additive record on the
 * Case row — it never mutates the frozen `outcomeAtCompletion`. `amendedBy`
 * (bare account login) and `amendedAt` (ISO timestamp) are captured for audit
 * rather than mined from SharePoint version history. The **Current Outcome** is
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
 * A Case row. The lifecycle is `In-progress → Actions In Progress → Completed`;
 * `reportableAt` is stamped at the **reportable** milestone (Send Actions, or
 * Complete Case on the no-actions path), where the Answers freeze and the
 * Outcome snapshot is taken. `completedAt` is stamped only at the final
 * `Completed` transition, so on the actions path `reportableAt` precedes it.
 * A Case abandoned before either close leaves that path for the terminal
 * `Void`, stamping `voidReason` (a key from the framework's Void Reason
 * vocabulary), `voidedAt` and `voidedBy` (a bare account login). Voiding takes
 * no Outcome snapshot, so a Case voided before the reportable milestone carries
 * none at all.
 *
 * `effectiveOutcome` / `effectiveHadRemediation` / `outcomeOverridden`
 * carry the corrected result for the responsible-party-team report; they
 * initialise equal to the frozen `outcomeAtCompletion` / `hadRemediation` (stamped
 * at reportable, despite the `Completion` name) and are re-fed from a case-level
 * **Amended Outcome**, not from per-Answer overrides.
 *
 * The four people on a row — `assignedReviewer`, `responsibleParty` and the
 * two manager fields below — are all **bare account login names**, the same
 * identity key `CurrentUser.id` carries, because Section access resolves every
 * person-derived Role by matching them against the signed-in user. All four
 * are stored in SharePoint as Person columns, so the numeric id such a column
 * really holds is the client's business and never reaches a row: whichever way
 * a row is read, these fields speak accounts. `responsiblePartyDisplayName` is
 * the directory name that goes with the Responsible Party, carried on the row
 * so a view can name a person without a second round trip; there is
 * deliberately no counterpart for the other three, which nothing displays off
 * the row. Read-side only: nothing writes it, and it is absent on a Case with
 * no Responsible Party.
 *
 * `assignedAt` is the clock paired with the Assigned Reviewer: the moment the
 * Case was last handed to whoever holds it. The client stamps it on every write
 * that sets `assignedReviewer`, and clears it to `null` when the Reviewer is
 * cleared — so no caller can forget it, and an unassigned Case never carries a
 * stale assignment time. Deliberately not a filter field: nothing queries on it,
 * it is displayed and sorted client-side.
 *
 * `assignedReviewerManager` and `responsiblePartyManager` denormalise two
 * org-chart edges onto the row and are **not** equivalent:
 * `assignedReviewerManager` is a reporting snapshot — the query key behind
 * `#/team-cases` and `#/my-team`, frozen at Reportable — while
 * `responsiblePartyManager` is a written record whose Section access Role is to
 * be resolved live from the directory, since that Role carries `edit` on the
 * Conversation.
 *
 * @typedef {{
 * id: string,
 * caseType: string,
 * title: string,
 * status: import('./lib/case-statuses.js').CaseStatus,
 * assignedReviewer: string,
 * assignedAt?: string | null,
 * responsibleParty: string,
 * responsiblePartyDisplayName?: string,
 * answers: Record<string, Answer>,
 * conversation: Message[],
 * details?: Record<string, string>,
 * notes: string,
 * caseJustification?: string,
 * reportableAt?: string | null,
 * remediationDueDate?: string | null,
 * completedAt: string | null,
 * voidReason?: string | null,
 * voidedAt?: string | null,
 * voidedBy?: string | null,
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
 * onHold?: boolean,
 * placedOnHoldAt?: string | null,
 * hasOpenAppeal?: boolean,
 * appealRaisedAt?: string | null,
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
 * A reporting **Label** assigned to Question Definitions from the question
 * bank. Bank-side only — never recorded against a Case. `color` drives the
 * editor's colour pill and is carried into the data-only reporting export.
 *
 * @typedef {{ id: string, name: string, color: string }} Label
 */

/**
 * Optional display-copy overrides for Case Review tab captions and section
 * headings, keyed by Section id. A bare string renames both the tab and the
 * heading; an object patches only the axis it names. Any key absent here falls
 * back to `DEFAULT_SECTION_LABELS` (src/lib/section-labels.js). Distinct from
 * `CaseTypeConfig.labels` above — that is the reporting Label catalogue
 * assigned to Question Definitions, unrelated to this presentation copy.
 *
 * @typedef {Partial<Record<import('./lib/section-registry.js').Section, string | { heading?: string, tab?: string }>>} SectionLabels
 */

/**
 * The resolved shape `resolveSectionLabels` returns: every Section present,
 * every entry a complete pair, so no consumer normalises on the read path.
 *
 * @typedef {Record<import('./lib/section-registry.js').Section, { tab: string, heading: string }>} ResolvedSectionLabels
 */

/**
 * `responseType` is one of `yes-no-na` | `single-choice` | `multi-choice` |
 * `outcome`. `yes-no-na` is single-choice with the fixed options `Yes`/`No`;
 * `outcome` is single-choice whose options are the Case Type's configured
 * Outcomes (read-only). Every response type additionally offers the universal
 * `NA` option to the Reviewer (`src/lib/response-options.js`); it is never
 * authorable and never maps to an Outcome. `optionOutcomes` maps each response option label to a
 * configured Outcome id (`OutcomeOption.id`); it is what drives the Outcome —
 * the highest-scoring applicable mapped Outcome wins. The same mapping drives
 * the Issues/Remediation flow: every option mapped to a non-default Outcome is
 * a failure. `failureValues` is that derived list — stamped at load by
 * `withDerivedFailureValues` (evaluators/failure-evaluator.js), never authored
 * or stored. The universal N/A never fails.
 *
 * `labelIds` references the owning Case Type's `labels` by id. It is
 * reporting metadata only and does not affect how a question is presented.
 *
 * Free-form remediation is offered on every failed Answer unless the Question
 * Definition sets `disallowFreeFormRemediation`.
 *
 * Grouping is two-level, both optional: `category` is the top,
 * presentation-only level and never touches applicability or Outcome;
 * `questionGroup` is the inner level — progress, Summary counts and
 * bulk-marking operate per Question Group.
 *
 * @typedef {{
 * id: string,
 * text: string,
 * category?: string,
 * questionGroup?: string,
 * labelIds?: string[],
 * responseType: 'yes-no-na' | 'single-choice' | 'multi-choice' | 'outcome',
 * options?: string[],
 * optionOutcomes?: Record<string, string>,
 * showWhen?: Record<string, unknown>,
 * failureValues?: string[],
 * remediationActions?: Array<string | RemediationActionDefinition>,
 * disallowFreeFormRemediation?: boolean,
 * deprecated: boolean
 * }} QuestionDefinition
 */

/**
 * A server-side Case query. Every scalar field is an ANDed
 * equality on an **indexed** Case column so a filtered count/`$top` stays
 * cheap past the 5000-item threshold: reason-defining data is hoisted onto
 * queryable columns, never mined from the `Answers`/`appeals` blobs.
 * `awaitingResponsibleParty` and `hasOpenAppeal` are the
 * Action Centre reason flags. `anyOf` is an OR-of-filters (each sub-filter is
 * itself ANDed, then the sub-filters are ORed) used for the server-deduped
 * "N cases need you" headline, whose count is deliberately *not* the sum of the
 * per-reason group counts.
 *
 * `completedAfter` (inclusive) and `completedBefore` (exclusive) bound a read
 * to a `CompletedAt` window on the indexed date column, so a windowed
 * completion metric leads with the selective column and can be summed from
 * sub-threshold per-day `countCases` slices.
 *
 * `reportableAfter` (inclusive) and `reportableBefore` (exclusive) bound a read
 * to a `ReportableAt` window the same way, on the same kind of indexed date
 * column. It leads the expression for the same reason the completion window
 * does: a date range is the most selective thing a lookup usually carries.
 *
 * `voidedAfter` (inclusive) and `voidedBefore` (exclusive) bound a read to a
 * `VoidedAt` window, again on an indexed date column and again leading the
 * expression: `Status eq 'Void'` alone matches every Case ever voided, which
 * only grows.
 *
 * `titlePrefix` matches the start of the Case Reference held in `Title`, and is
 * a **prefix** match on purpose — not a contains. `substringof` cannot use a
 * column index, so past the List View Threshold SharePoint refuses or throttles
 * it; an anchored `startswith` stays index-served. Matching is case-insensitive,
 * because that is what the server does.
 *
 * `orderBy` names a **`CaseRow` key**, never a SharePoint internal column name:
 * both clients speak the row vocabulary, and `HttpSharePointClient` maps the key
 * to its internal column before emitting `$orderby`. Only a key that client maps
 * is sortable — an unmapped one throws there rather than reaching SharePoint.
 *
 * @typedef {{ status?: string, assignedReviewer?: string, caseType?: string, responsibleParty?: string, overdue?: boolean, awaitingResponsibleParty?: boolean, reviewRequired?: boolean, onHold?: boolean, hasOpenAppeal?: boolean, assignedReviewerManager?: string, effectiveOutcome?: string, outcomeOverridden?: boolean, completedAfter?: string, completedBefore?: string, reportableAfter?: string, reportableBefore?: string, voidedAfter?: string, voidedBefore?: string, titlePrefix?: string, anyOf?: ListCasesFilter[] }} ListCasesFilter
 * @typedef {{ listName?: string, top?: number, skip?: number, orderBy?: string, orderDir?: 'asc' | 'desc' }} CaseListOptions
 */

/**
 * A Case **read**'s options: the list options plus the caller's mount-lifetime
 * `AbortSignal`. A route effect binds it once via
 * `services/abortable-client.js`, so navigating away cancels the reads the
 * abandoned page had in flight — which for a page that fans out across Case
 * sources is one request per Case Type list.
 *
 * Reads only. A queued write must survive navigation (the debounce + ETag
 * concurrency); cancelling one would silently drop a Reviewer's edit.
 * `patchCase` is typed with plain `CaseListOptions` to say so, but the type is
 * not the guarantee — structural typing lets a `CaseReadOptions` value through.
 * The real protections are runtime: `withAbortSignal` wraps reads only,
 * `SaveQueue.loadCase` strips any `signal`, and `HttpSharePointClient` never
 * reads `opts.signal` on a write path.
 *
 * @typedef {CaseListOptions & { signal?: AbortSignal }} CaseReadOptions
 */

/**
 * A directory person returned by `searchPeople`, already reduced to a bare
 * account `loginName` (claims prefix + domain stripped).
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
 * questionGroup?: string | null,
 * responseType: string,
 * options: string[] | null,
 * optionOutcomes?: Record<string, string> | null,
 * showWhen: Record<string, unknown> | null,
 * remediationActions?: Array<RemediationActionDefinition> | null,
 * deprecated: boolean,
 * labelIds?: string[],
 * }>,
 * outcomeOptions?: OutcomeOption[],
 * defaultOutcomeId?: string | null,
 * }} VersionedExport
 */

/** @typedef {'LIVE' | 'IN PROGRESS' | 'UPCOMING'} RoadmapStatus */

/**
 * A read-only row from the shared Roadmap list.
 *
 * @typedef {{
 * id: string,
 * title: string,
 * description: string,
 * theme: string,
 * labels: string[],
 * status: RoadmapStatus
 * }} RoadmapItem
 */

/**
 * Every REST consumer codes against this interface. Both MockSharePointClient
 * and HttpSharePointClient satisfy it identically.
 *
 * @typedef {{
 * getCase: (id: string, opts?: CaseReadOptions) => Promise<CaseRow|null>,
 * patchCase: (id: string, fields: Partial<CaseRow>, etag: string, opts?: CaseListOptions) => Promise<PatchResult>,
 * listCases: (filter: ListCasesFilter, opts?: CaseReadOptions) => Promise<CaseRow[]>,
 * countCases: (filter: ListCasesFilter, opts?: CaseReadOptions) => Promise<number>,
 * getCurrentUserGroups: () => Promise<string[]>,
 * getCurrentUser: () => Promise<CurrentUser>,
 * listRoadmapItems: () => Promise<RoadmapItem[]>,
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
 * Section contributes a block to the read-only Summary Section — `true`/`false`
 * for every viewer, or a list of the roles the block is composed for. The list
 * can only narrow: the Section's access mode is checked first, so naming a role
 * never shows it a Section it is otherwise denied.
 *
 * `allowMessagesWhen` gates when Conversation messages may be posted during a
 * live review. It also only narrows: a terminal Case closes the thread for
 * everyone, and listing a terminal status here does not reopen it.
 *
 * @typedef {{ showInSummary?: boolean | import('./services/section-access.js').Role[], allowMessagesWhen?: import('./lib/case-statuses.js').CaseStatus[] }} SectionConfig
 */

/**
 * Per-Case-Type appeal flow configuration. `raisedBy` names the role that may
 * raise an Appeal — the **Journey Owner** for Complaints-style journeys,
 * otherwise the **Responsible Party Manager**. Resolution is always Controls,
 * owned in code by the `appealReview` row in `services/section-access.js`.
 *
 * @typedef {{ raisedBy: 'journeyOwner' | 'responsiblePartyManager' }} AppealConfig
 */

/**
 * Per-Case-Type placeholder text for the framework's fixed free-text fields,
 * mirroring the `sectionLabels` override pattern: absent keys keep the
 * framework default; an explicit `''` blanks the hint. (Config-declared Issue
 * Capture Fields carry their own `placeholder` inline on the field definition
 * instead.)
 *
 * @typedef {{ notes?: string, caseJustification?: string }} Placeholders
 */

/**
 * Per-Question-Group configuration declared by a Case Type, keyed by the
 * `questionGroup` name. `allowBulkOutcome` opts the group into
 * the Reviewer-facing bulk-outcome control: one selection writes the chosen
 * Outcome wording (or the universal N/A) to every applicable, non-deprecated
 * `outcome`-type question in the group, through the normal answer path.
 *
 * It overrides the Case Type-wide `allowBulkOutcome` in both directions, so a
 * Case Type whose groups are mostly uniform states the rule once and names only
 * the exceptions.
 *
 * @typedef {{ allowBulkOutcome?: boolean }} QuestionGroupConfig
 */

/**
 * How long a Case may sit in each Action Centre reason group before its
 * "waiting" chip reads as breached, in whole days, keyed by reason id
 * (`overdue`, `awaitingFrontline`, `reviewRequired`, `appeals`).
 *
 * Deliberately **partial**: a Case Type names only the reasons whose cadence
 * differs from the framework's, and every other reason keeps the default that
 * lives on the reason itself. The reason vocabulary is closed and code-owned —
 * configuration selects a number against an existing reason and can neither add
 * nor rename one — so an unrecognised key is a typo, and the verify gate says so
 * rather than letting it fall back silently.
 *
 * @typedef {Record<string, number>} ActionCentreSlaDays
 */

/**
 * Shape every Case Type module must satisfy.
 *
 * `sections` remains the Section layout descriptor. Case tables are owned by
 * framework code and are not Case Type configuration: every Case Type is listed
 * under the same columns, so a table stays readable whether it is scoped to one
 * Case Type or spans them all.
 *
 * `generalQuestions` declares the **General Questions** rendered above or beneath the
 * Question Groups on the Review tab — `generalQuestionsPlacement` selects which
 * ('after' when absent). They reuse the `CaptureField` vocabulary but are never
 * outcome-driving: their answers are namespaced in the Answers blob and no
 * evaluator reads them. A Case Type builds the list with
 * `resolveGeneralQuestions()` (`case-types/general-questions.js`): shared
 * questions are included by key so their answer keys stay stable across Case
 * Types, and Case Type-specific ones are declared inline beside them.
 *
 * `actionCentreSlaDays`, `breachWindowHours` and `remediationSlaWorkingDays`
 * are the review-cadence thresholds. Each is optional and each has a framework
 * default that lives next to the code reading it, so a Case Type declaring none
 * of them behaves exactly as it did before the keys existed — an absent key is
 * "use the default", never "no threshold".
 *
 * `voidReasons` narrows the Void Reasons the Case Type offers a Reviewer, from
 * the framework vocabulary in `lib/void-reasons.js`. Display-only: an absent key
 * offers all of them, and storage validates against the whole vocabulary either
 * way, because the manager report groups reasons across Case Types.
 *
 * @typedef {{
 * questions: QuestionDefinition[],
 * computeOutcome: (answers: Record<string, Answer>) => OutcomeResult,
 * outcomeOptions: OutcomeOption[],
 * defaultOutcomeId: string,
 * labels?: Label[],
 * sectionLabels?: SectionLabels,
 * placeholders?: Placeholders,
 * eligibleGroups?: string[],
 * listName?: string,
 * reviewerGroup?: string,
 * sections?: Partial<Record<import('./lib/section-registry.js').Section, SectionConfig>>,
 * allowBulkOutcome?: boolean,
 * questionGroups?: Record<string, QuestionGroupConfig>,
 * appeal?: AppealConfig,
 * actionCentreSlaDays?: ActionCentreSlaDays,
 * breachWindowHours?: number,
 * remediationSlaWorkingDays?: number,
 * maxInProgressCases?: number,
 * remediationStatuses?: RemediationStatusValue[],
 * voidReasons?: string[],
 * captureGroups?: CaptureGroup[],
 * generalQuestions?: GeneralQuestionField[],
 * generalQuestionsPlacement?: 'before' | 'after',
 * detailFields?: CaseDetailField[]
 * }} CaseTypeConfig
 */

export {};
