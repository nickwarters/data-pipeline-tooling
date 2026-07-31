// @ts-check
/**
 * One panel renderer per tab Section, keyed by Section id.
 *
 * The Section registry makes Section *existence* and *order* data. What a Section's panel
 * renders stayed a `if (entry.id === …)` chain in `pages/cora-case-review.js`:
 * nine near-identical blocks, so the render loop iterated the registry and then
 * ignored it. This map is the missing half — the registry says which Sections
 * exist, this says how each one's panel is filled, and `renderRoute` does the
 * same three things for every entry.
 *
 * `tests/section-panels.test.js` asserts this map's key set equals
 * `tabEntries().map((e) => e.id)`, so adding a Section to the registry without a
 * panel fails a test instead of silently rendering an empty tab.
 *
 * The registry itself stays free of page imports (`lib/` is framework-level and
 * must not reach into `src/pages/**`), which is why the map lives here and is
 * keyed by id rather than hanging off the registry entry.
 *
 * Renderers are pure prop wiring: they read `ctx` and call a Section view. They
 * do no async work, own no state, and never decide whether their panel is
 * visible — `renderRoute` owns visibility and the `hidden` toggle.
 *
 * Four Sections wrap their view in a `div` carrying a `cora-…` *class*
 * (`cora-summary`, `cora-appeal`, `cora-appeal-review`, `cora-amend-outcome`).
 * Those wrappers exist only as CSS hooks for the Section's scoped styles. They
 * were once unregistered `cora-*` *elements* built with raw `createElement` —
 * the shape `h()`'s `warnIfUnregisteredCoraElement` guard exists to warn about,
 * sidestepped by not going through `h()`. Registering them as real custom
 * elements would be the wrong direction, away from store-driven views; they are
 * wrapper divs. The `cora-` prefix stays either way — it is the SharePoint
 * style-isolation boundary, and only the selector type changed.
 */

import { h } from '../../lib/html.js';
import { caseDetailsView } from './details-view.js';
import { withGeneralQuestions } from './general-questions-view.js';
import { notesView } from './notes-view.js';
import { summaryView } from './summary-view.js';
import { AppealSection } from './appeal-view.js';
import { AppealReviewSection } from './appeal-review-view.js';
import { AmendOutcomeSection } from './amend-outcome-view.js';
import { editRemediationDetail } from './remediation-actions.js';
import {
  issueCaptured,
  remediationActionToggled,
  remediationFreeFormEdited,
  remediationRequiredSet,
  remediationResolved,
} from './answer-actions.js';
import { RemediationSection } from './remediation-view.js';
import { RemediationTracking } from './remediation-tracking-view.js';
import { remediationAudience } from '../../services/section-access.js';
import { resolveGeneralQuestionsPlacement } from '../../evaluators/general-questions.js';

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
 * @property {(questionId: string, party: { loginName: string, displayName: string } | null) => void} selectAttribution
 * @property {(questionId: string, query: string) => void} requestAttributionSearch
 * @property {(party: { loginName: string, displayName: string }) => void} selectResponsibleParty
 * @property {(query: string) => void} requestResponsiblePartySearch
 * @property {{ fieldEdited: (field: import('./case-actions.js').PlainTextCaseField, value: string) => void }} save
 *   Narrowed on purpose, twice over: panels may report a field edit and nothing
 *   else on the SaveQueue bridge, and the field itself may only be one of the
 *   plain-text Case fields. Restating `field` as a bare `string` here would widen
 *   the effect's own union straight back open at the seam panels actually call.
 * @property {ReturnType<typeof import('./appeal-effects.js').createAppealEffects>} appeals
 *   The whole effect object, not a hand-written shape — these three are the
 *   persisted Appeal and Amended Outcome state transitions, so their argument
 *   shapes are worth keeping under `tsc`.
 */

/**
 * @typedef {(ctx: PanelContext) => Node | Node[] | null} PanelView
 */

/**
 * The Review tab's contents: the Applicable Questions, with the Case Type's
 * General Questions before or after them. General Questions travel the same
 * Answer path (namespaced keys, one SaveQueue write) but drive no Outcome —
 * see general-questions-view.js.
 *
 * @param {import('../cora-case-review.js').CaseReviewSnapshot} snapshot
 * @param {ReturnType<typeof import('./question-panel-view.js').createQuestionPanelView>} questionsView
 * @param {(questionId: string, value: string | string[]) => void} onAnswer
 * @returns {Node[]}
 */
function questionsPanel(snapshot, questionsView, onAnswer) {
  return withGeneralQuestions(
    questionsView.view({
      catalogue: snapshot.catalogue,
      questions: snapshot.applicableQuestions,
      answers: snapshot.answers,
      access: snapshot.access.questions,
      heading: snapshot.sectionHeadings.questions,
      onAnswer,
    }),
    {
      fields: snapshot.config?.generalQuestions ?? [],
      answers: snapshot.answers,
      access: snapshot.access.questions,
      placement: resolveGeneralQuestionsPlacement(snapshot.config),
      onAnswer,
    }
  );
}

/**
 * One entry per tab Section.
 *
 * Keyed by `Section`, so a mistyped key is a `tsc` error rather than a test
 * failure. `Partial<…>` because `conversation` is a Section and not a tab —
 * which is also why `renderRoute` guards on the lookup being present, and why
 * `tests/section-panels.test.js` still has to assert the key set *equals*
 * `tabEntries()`' ids: the type stops wrong keys, the test stops missing ones.
 *
 * @type {Partial<Record<import('../../lib/section-registry.js').Section, PanelView>>}
 */
export const SECTION_PANELS = {
  details: ({ caseRow, config }) =>
    caseDetailsView(caseRow, config.detailFields ?? []),

  questions: ({ snapshot, actions }) =>
    questionsPanel(snapshot, actions.questionsView, actions.onAnswer),

  notes: ({ snapshot, caseRow, config, actions }) =>
    notesView({
      notes: caseRow.notes,
      caseJustification: caseRow.caseJustification ?? '',
      access: snapshot.access.notes,
      heading: snapshot.sectionHeadings.notes,
      placeholders: config.placeholders ?? {},
      onFieldInput: (field, value) => actions.save.fieldEdited(field, value),
    }),

  issues: ({ snapshot, caseRow, config, route, dispatch, actions }) =>
    RemediationSection({
      catalogue: snapshot.catalogue,
      answers: snapshot.answers,
      attributeFailures: config.attributeFailures === true,
      responsibleParty: caseRow.responsibleParty
        ? {
            loginName: caseRow.responsibleParty,
            // The name comes off the row, which carries it from the expanded
            // person column. The fallback covers a row whose person could not be
            // named: showing the account beats showing nobody.
            displayName:
              caseRow.responsiblePartyDisplayName || caseRow.responsibleParty,
          }
        : null,
      canAttribute: snapshot.machine?.canAttribute ?? false,
      remediationFields: config.remediationFields ?? [],
      canCaptureDetails: snapshot.machine?.canCapture ?? false,
      captureGroups: config.captureGroups ?? [],
      canCapture: snapshot.machine?.canCapture ?? false,
      captureCollapsed: route.captureCollapsed,
      attributionSearch: route.attributionSearch,
      responsiblePartySearch: route.responsiblePartySearch,
      canSelectRemediation: snapshot.machine?.canSelectRemediation ?? false,
      dispatchResponsibleParty: actions.selectResponsibleParty,
      dispatchResponsiblePartySearch: actions.requestResponsiblePartySearch,
      dispatchCapture: (questionId, fieldKey, value) =>
        actions.editAnswers(
          issueCaptured({
            answers: actions.currentAnswers(),
            captureGroups: config.captureGroups ?? [],
            questionId,
            fieldKey,
            value,
            canCapture: snapshot.machine?.canCapture ?? false,
          })
        ),
      dispatchCaptureToggle: (questionId, groupKey, collapsed) =>
        dispatch({
          type: 'case/capture-group-toggled',
          questionId,
          groupKey,
          collapsed,
        }),
      dispatchDetail: (questionId, key, value) =>
        actions.editAnswers(
          editRemediationDetail({
            answers: actions.currentAnswers(),
            questionId,
            key,
            value,
            canEdit: snapshot.machine?.canCapture ?? false,
            fields: config.remediationFields ?? [],
          })
        ),
      dispatchAttribute: actions.selectAttribution,
      dispatchAttributeSearch: actions.requestAttributionSearch,
      dispatchRemediationAction: (questionId, action, selected) =>
        actions.editAnswers(
          remediationActionToggled({
            answers: actions.currentAnswers(),
            questionId,
            action,
            selected,
            canSelectRemediation:
              snapshot.machine?.canSelectRemediation ?? false,
          })
        ),
      dispatchRemediationFreeForm: (questionId, value) =>
        actions.editAnswers(
          remediationFreeFormEdited({
            answers: actions.currentAnswers(),
            questionId,
            value,
            canSelectRemediation:
              snapshot.machine?.canSelectRemediation ?? false,
          })
        ),
      dispatchRemediationRequired: (questionId, required) =>
        actions.editAnswers(
          remediationRequiredSet({
            answers: actions.currentAnswers(),
            questionId,
            required,
            canSelectRemediation:
              snapshot.machine?.canSelectRemediation ?? false,
          })
        ),
    }),

  remediation: ({ snapshot, caseRow, config, route, dispatch, actions }) =>
    RemediationTracking({
      catalogue: snapshot.catalogue,
      answers: snapshot.answers,
      audience: remediationAudience(snapshot.machine?.roles ?? []),
      canResolve: snapshot.access.remediation === 'edit',
      conversationAvailable: snapshot.access.conversation !== 'hidden',
      caseRow,
      heading: snapshot.sectionHeadings.remediation,
      statuses: config.remediationStatuses,
      dispatchStatus: (questionId, status, details) =>
        actions.editAnswers(
          remediationResolved({
            answers: actions.currentAnswers(),
            questionId,
            status,
            details,
            canResolve: snapshot.access.remediation === 'edit',
          })
        ),
      dispatchOpenConversation: () => {
        if (route.conversationHidden) {
          dispatch({ type: 'case/conversation-toggled' });
        }
      },
    }),

  summary: ({ snapshot, caseRow, config }) =>
    h(
      'div',
      { className: 'cora-summary' },
      summaryView({
        computeOutcome: config.computeOutcome,
        answers: snapshot.answers,
        allAnswered: snapshot.allAnswered,
        caseRow,
        catalogue: snapshot.catalogue,
        summarySections: snapshot.summarySections,
        captureGroups: config.captureGroups ?? [],
        detailFields: config.detailFields ?? [],
        outcomeOptions: config.outcomeOptions ?? [],
        sectionHeadings: snapshot.sectionHeadings,
        generalQuestions: config.generalQuestions ?? [],
        generalQuestionsPlacement: resolveGeneralQuestionsPlacement(config),
        // The same audience the Remediation panel gets: it decides whether the
        // Summary's remediation roll-up carries each resolution's details.
        audience: remediationAudience(snapshot.machine?.roles ?? []),
      })
    ),

  appealRequest: ({ snapshot, caseRow, actions }) =>
    h(
      'div',
      { className: 'cora-appeal' },
      AppealSection({
        caseRow,
        access: snapshot.access.appealRequest,
        currentUser: snapshot.currentUser,
        catalogue: snapshot.catalogue,
        answers: snapshot.answers,
        onRaise: ({ rationale, citedAnswerKeys }) =>
          actions.appeals.raise({
            caseRow,
            snapshot,
            rationale,
            citedAnswerKeys,
          }),
        heading: snapshot.sectionHeadings.appealRequest,
      })
    ),

  appealReview: ({ snapshot, caseRow, config, actions }) =>
    h(
      'div',
      { className: 'cora-appeal-review' },
      AppealReviewSection({
        caseRow,
        access: snapshot.access.appealReview,
        currentUser: snapshot.currentUser,
        outcomeOptions: config.outcomeOptions ?? [],
        onResolve: (resolution) =>
          actions.appeals.resolve({ caseRow, snapshot, resolution }),
      })
    ),

  amendOutcome: ({ snapshot, caseRow, config, actions }) =>
    h(
      'div',
      { className: 'cora-amend-outcome' },
      AmendOutcomeSection({
        caseRow,
        access: snapshot.access.amendOutcome,
        currentUser: snapshot.currentUser,
        outcomeOptions: config.outcomeOptions ?? [],
        onAmend: ({ outcome, justification }) =>
          actions.appeals.amend({
            caseRow,
            snapshot,
            outcome,
            justification,
          }),
      })
    ),
};
