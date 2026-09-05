// @ts-check
/**
 * Shared typedefs for section panel rendering contexts and actions.
 */

/**
 * Everything a panel renderer is allowed to read. Assembled once per render by
 * `renderRoute`, which is also the only place the narrowing of `caseRow` and
 * `config` to non-null happens.
 *
 * @typedef {Object} PanelContext
 * @property {import('../cora-case-review.js').CaseReviewSnapshot} snapshot
 *   The rendered snapshot.
 * @property {import('../../sharepoint-client.js').CaseRow} caseRow
 *   `snapshot.caseRow`, narrowed.
 * @property {import('../../sharepoint-client.js').CaseTypeConfig} config
 *   `snapshot.config`, narrowed.
 * @property {import('../cora-case-review.js').CaseReviewRouteState} route
 *   The route slice's view state, as the page holds it. Referenced rather than
 *   restated so a field added there cannot drift from what panels read.
 * @property {(action: any) => unknown} dispatch
 * @property {PanelActions} actions
 * @property {import('../../sharepoint-client.js').SectionConfig} [sectionConfig]
 */

/**
 * The callbacks a panel wires into its Section view. These close over the route
 * slice's mutable locals — notably the live Answers, which `currentAnswers()`
 * reads at call time rather than at render time.
 *
 * @typedef {Object} PanelActions
 * @property {ReturnType<typeof import('./question-panel-view.js').createQuestionPanelView>} questionsView
 * @property {() => Record<string, import('../../sharepoint-client.js').Answer>} currentAnswers
 * @property {(next: Record<string, import('../../sharepoint-client.js').Answer> | null) => void} editAnswers
 * @property {(questionId: string, value: string | string[]) => void} onAnswer
 * @property {(questionId: string, fieldKey: string, value: import('../../evaluators/issue-capture.js').CaptureValue | null) => void} captureEdited
 * @property {(questionId: string, fieldKey: string, query: string) => void} requestCaptureSearch
 * @property {(party: { loginName: string, displayName: string }) => void} selectResponsibleParty
 * @property {(query: string) => void} requestResponsiblePartySearch
 * @property {{ fieldEdited: (field: import('./case-actions.js').PlainTextCaseField, value: string) => void }} save
 *   Narrowed on purpose, twice over: panels may report a field edit and nothing
 *   else on the SaveQueue bridge, and the field itself may only be one of the
 *   plain-text Case fields. Restating `field` as a bare `string` here would widen
 *   the effect's own union straight back open at the seam panels actually call.
 * @property {(field: string, value: string) => void} editDetailField
 *   Merge one Case Type detail field into the `details` blob and persist the
 *   whole blob. The merge is the route slice's, not the caller's.
 * @property {(field: string, value: string) => void} editCaseField
 *   A top-level Case column, for the Admin Details override only. The reducer
 *   holds it to `ALLOWED_ADMIN_CORE_FIELDS`.
 * @property {ReturnType<typeof import('./appeal-effects.js').createAppealEffects>} appeals
 *   The whole effect object, not a hand-written shape — these three are the
 *   persisted Appeal and Amended Outcome state transitions, so their argument
 *   shapes are worth keeping under `tsc`.
 * @property {() => void | Promise<unknown>} onComplete
 *   The page-owned completion effect, including persistence and navigation.
 * @property {() => void | Promise<unknown>} onVoid
 *   The page-owned Void effect, including persistence and navigation.
 * @property {any} [saveQueue]
 * @property {any} [client]
 * @property {any} [currentUser]
 * @property {() => void} [onClose]
 * @property {(body: string) => Promise<unknown>} [onSend]
 * @property {(body: string) => Promise<unknown>} [postConversationMessage]
 */

/**
 * @typedef {(ctx: PanelContext) => Node | Node[] | null} PanelView
 */

export {};
