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
 * @property {PanelActions & Record<string, any>} actions
 *   The page's own callbacks, plus each Section's own namespace under its id —
 *   `actions[sectionId].whatever(...)`. Intersected rather than widened so the
 *   page's members keep their types while a Section's stay its own business.
 *   The page's members go in last when this is built, so a Section cannot
 *   shadow one by choosing its id.
 * @property {import('../../sharepoint-client.js').SectionConfig} [sectionConfig]
 * @property {any} [sectionState]
 *   This Section's own slice of `route.sections`, and only this Section's. The
 *   whole map is deliberately not passed: a Section reading another's state
 *   would be a coupling nothing declares and nothing could see. `undefined`
 *   until this Section has written anything.
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
