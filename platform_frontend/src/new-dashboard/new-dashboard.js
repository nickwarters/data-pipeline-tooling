// @ts-check
import { h } from '../lib/html.js';
import { CASE_STATUS } from '../sharepoint-client.js';
import { addWorkingDays } from './working-days.js';
import {
  applicableQuestions,
  configuredOutcome,
  failedQuestions,
  hasAnswer,
  matchesShowWhen,
  resolveRoles,
  visibleTabs,
} from './case-model.js';
import { voidReasonsFor } from './void-reasons.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/**
 * @typedef {{
 * listName:string, displayName?:string, version?:string,
 * detailFields?:any[], questions?:any[], outcomeOptions?:any[],
 * defaultOutcomeId:string, generalQuestions?:any[], captureGroups?:any[],
 * remediationStatuses?:string[], remediationSlaWorkingDays?:number,
 * voidReasons?:string[],
 * sectionLabels?:Record<string,string|{tab?:string,heading?:string}>,
 * generalQuestionsPlacement?:'before'|'after', questionGroups?:Record<string,{allowBulkOutcome?:boolean}>,
 * allowBulkOutcome?:boolean, appeal?:{raisedBy:string}, sections?:Record<string,any>
 * }} NewDashboardConfig
 */

/**
 * @typedef {{
 *   root: HTMLElement,
 *   hash: string,
 *   client: any,
 *   loadConfig: (slug: string) => Promise<NewDashboardConfig>,
 *   schedule?: (task: () => void | Promise<void>, delay: number) => any,
 *   cancelSchedule?: (handle: any) => void,
 *   now?: () => Date
 * }} NewDashboardOptions
 */

/** @param {string} hash */
export function parseNewDashboardRoute(hash) {
  const match = /^#\/new_dashboard\/([^/]+)\/([^/]+)$/.exec(hash);
  if (!match) return null;
  return {
    caseType: decodeURIComponent(match[1]),
    id: decodeURIComponent(match[2]),
  };
}

/**
 * Mount the clean-room Case Review route. External reads are injected at this
 * public seam; the browser bootstrap supplies HttpSharePointClient.
 *
 * @param {NewDashboardOptions} options
 */
export function mountNewDashboard(options) {
  const route = parseNewDashboardRoute(options.hash);
  let activeTab = 'details';
  let saveStatus = '';
  let conversationOpen = false;
  let conversationDraft = '';
  let appealDraft = '';
  let amendedOutcomeDraft = '';
  let amendmentJustificationDraft = '';
  let appealVerdict = '';
  let appealResolutionDraft = '';
  let appealOutcomeDraft = '';
  let responsiblePartyQuery = '';
  let responsiblePartyName = '';
  let voidReasonDraft = '';
  /** @type {Record<string, Array<{loginName:string,displayName:string}>>} */
  let capturePeople = {};
  /** @type {Array<{loginName:string,displayName:string}>} */
  let responsiblePartyPeople = [];
  let versionWarning = '';
  let viewerName = '';
  let viewerId = '';
  /** @type {any} */
  let saveHandle;
  /** @type {Partial<CaseRow>} */
  let pendingFields = {};
  /** @type {Promise<void> | null} */
  let writeInFlight = null;
  let disposed = false;
  /** @type {CaseRow | null} */
  let caseRow = null;
  /** @type {NewDashboardConfig | null} */
  let config = null;
  /** @type {string[]} */
  let roles = [];
  options.root.replaceChildren(
    h('p', { className: 'cora-loading', role: 'status' }, 'Loading Case…')
  );

  const ready = (async () => {
    if (!route) throw new Error('Invalid new_dashboard route.');
    config = await options.loadConfig(route.caseType);
    caseRow = await options.client.getCase(route.id, {
      listName: config.listName,
    });
    if (!caseRow) throw new Error(`Case ${route.id} was not found.`);
    const exportHash = await options.client.getExportHash?.(route.caseType);
    if (exportHash) config = { ...config, version: exportHash };
    if (caseRow.reportableAt && caseRow.questionBankVersion) {
      const snapshot = await options.client.getVersionedExport?.(
        route.caseType,
        caseRow.questionBankVersion
      );
      if (snapshot) {
        config = {
          ...config,
          questions: snapshot.questions,
          outcomeOptions: snapshot.outcomeOptions ?? config.outcomeOptions,
          defaultOutcomeId:
            snapshot.defaultOutcomeId ?? config.defaultOutcomeId,
        };
      } else {
        versionWarning = 'As-reviewed Question Bank version unavailable.';
      }
    }
    const [user, groups] = await Promise.all([
      options.client.getCurrentUser?.() ??
        Promise.resolve({
          id: caseRow.assignedReviewer,
          displayName: caseRow.assignedReviewer,
        }),
      options.client.getCurrentUserGroups?.() ?? Promise.resolve([]),
    ]);
    roles = resolveRoles(caseRow, user.id, groups, config);
    viewerName = user.displayName;
    viewerId = user.id;
    const visible = visibleTabs(caseRow, roles, config);
    if (!visible.some(([id]) => id === activeTab)) {
      activeTab = visible[0]?.[0] ?? '';
    }
    render();
  })().catch((error) => {
    options.root.replaceChildren(
      h(
        'section',
        { className: 'cora-error-panel', role: 'alert' },
        h('h1', {}, 'Unable to open Case'),
        h('p', {}, error instanceof Error ? error.message : String(error))
      )
    );
  });

  return { ready, flush: flushPending, dispose };

  function dispose() {
    disposed = true;
    if (saveHandle !== undefined) {
      (options.cancelSchedule ?? clearTimeout)(saveHandle);
      saveHandle = undefined;
    }
    // A write which has reached the transport is deliberately not cancelled.
    // Fire the latest local state before releasing the route as well.
    void flushPending();
  }

  /** @param {Partial<CaseRow>} fields */
  function queueSave(fields) {
    pendingFields = { ...pendingFields, ...fields };
    if (saveHandle !== undefined) {
      (options.cancelSchedule ?? clearTimeout)(saveHandle);
    }
    saveHandle = (options.schedule ?? setTimeout)(flushPending, 1500);
  }

  async function flushPending() {
    if (saveHandle !== undefined) {
      (options.cancelSchedule ?? clearTimeout)(saveHandle);
      saveHandle = undefined;
    }
    if (writeInFlight) await writeInFlight;
    if (!caseRow || !config || !options.client.patchCase) return;
    const fields = pendingFields;
    pendingFields = {};
    if (!Object.keys(fields).length) return;
    const row = caseRow;
    saveStatus = 'Saving…';
    if (!disposed) render();
    writeInFlight = (async () => {
      const result = await options.client.patchCase(row.id, fields, row.etag, {
        listName: config?.listName,
      });
      if (result.ok) {
        caseRow = {
          ...caseRow,
          ...fields,
          etag: result.data?.etag ?? result.etag ?? caseRow.etag,
        };
        saveStatus = 'Saved';
      } else {
        saveStatus =
          result.status === 412 || result.conflict
            ? 'Save conflict — reload the Case'
            : 'Save failed';
      }
    })();
    try {
      await writeInFlight;
    } finally {
      writeInFlight = null;
    }
    if (!disposed) render();
    if (Object.keys(pendingFields).length) await flushPending();
  }

  /** @param {string} questionId @param {Record<string, any>} patch */
  function editAnswer(questionId, patch, renderNow = true) {
    if (!caseRow) return;
    const nextAnswer = /** @type {any} */ ({
      ...caseRow.answers[questionId],
      ...patch,
    });
    for (const [key, value] of Object.entries(nextAnswer)) {
      if (value === undefined) delete nextAnswer[key];
    }
    caseRow = {
      ...caseRow,
      answers: {
        ...caseRow.answers,
        [questionId]: nextAnswer,
      },
    };
    saveStatus = 'Unsaved changes';
    if (options.client.patchCase) {
      queueSave({ answers: caseRow.answers });
    }
    if (renderNow) render();
  }

  /** @param {Partial<CaseRow>} fields */
  async function transition(fields) {
    if (!caseRow || !config || !options.client.patchCase) return;
    await flushPending();
    saveStatus = 'Saving…';
    render();
    const result = await options.client.patchCase(
      caseRow.id,
      fields,
      caseRow.etag,
      { listName: config.listName }
    );
    if (result.ok) {
      caseRow = {
        ...caseRow,
        ...fields,
        etag: result.data?.etag ?? result.etag ?? caseRow.etag,
      };
      saveStatus = 'Saved';
    } else {
      saveStatus =
        result.status === 412 || result.conflict
          ? 'Save conflict — reload the Case'
          : 'Save failed';
    }
    render();
  }

  function render() {
    if (!caseRow || !config) return;
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    if (isLiveTextControl(options.root, active)) {
      const status = options.root.querySelector(
        '.cora-case-review__save-status'
      );
      if (status) status.textContent = saveStatus;
      return;
    }
    options.root.replaceChildren(
      caseView(caseRow, config, roles, activeTab, saveStatus, {
        selectTab(/** @type {string} */ id, focus = false) {
          activeTab = id;
          render();
          if (focus) {
            queueMicrotask(() =>
              /** @type {HTMLElement | null} */ (
                options.root.querySelector(`#new-case-tab-${id}`)
              )?.focus()
            );
          }
        },
        answer(
          /** @type {string} */ questionId,
          /** @type {any} */ value,
          renderNow = true
        ) {
          editAnswer(questionId, { value }, renderNow);
        },
        editAnswer,
        transition,
        now: options.now ?? (() => new Date()),
        editFields(/** @type {Partial<CaseRow>} */ fields, renderNow = true) {
          if (!caseRow || !config || !options.client.patchCase) return;
          caseRow = { ...caseRow, ...fields };
          saveStatus = 'Unsaved changes';
          queueSave(fields);
          if (renderNow) render();
        },
        conversationOpen,
        conversationDraft,
        viewerId,
        versionWarning,
        toggleConversation() {
          conversationOpen = !conversationOpen;
          render();
        },
        setConversationDraft(/** @type {string} */ value) {
          conversationDraft = value;
        },
        jumpToUnanswered() {
          const cards = options.root.querySelectorAll('.cora-question-card');
          const card = [...cards].find(
            (candidate) => candidate.getAttribute('data-unanswered') === 'true'
          );
          /** @type {HTMLElement | null} */ (
            card?.querySelector('fieldset')
          )?.focus();
        },
        async postConversation() {
          const body = conversationDraft.trim();
          if (!body || !caseRow) return;
          conversationDraft = '';
          await transition({
            conversation: [
              ...caseRow.conversation,
              {
                author: viewerName,
                timestamp: (options.now ?? (() => new Date()))().toISOString(),
                body,
              },
            ],
          });
        },
        setAppealDraft(/** @type {string} */ value) {
          appealDraft = value;
        },
        async raiseAppeal() {
          const rationale = appealDraft.trim();
          if (!rationale || !caseRow) return;
          const at = (options.now ?? (() => new Date()))().toISOString();
          const appeal =
            /** @type {import('../sharepoint-client.js').Appeal} */ ({
              id: `${viewerId}-${at}`,
              appellant: viewerId,
              at,
              rationale,
              state: 'raised',
            });
          await transition({
            appeals: [...(caseRow.appeals ?? []), appeal],
            hasOpenAppeal: true,
            appealRaisedAt: at,
          });
        },
        setAmendedOutcome(/** @type {string} */ value) {
          amendedOutcomeDraft = value;
        },
        setAmendmentJustification(/** @type {string} */ value) {
          amendmentJustificationDraft = value;
        },
        async amendOutcome() {
          const outcome = amendedOutcomeDraft;
          const justification = amendmentJustificationDraft.trim();
          if (!outcome || !justification || !caseRow) return;
          await transition({
            amendedOutcome: {
              outcome,
              justification,
              amendedBy: viewerId,
              amendedAt: (options.now ?? (() => new Date()))().toISOString(),
            },
            effectiveOutcome: outcome,
            effectiveHadRemediation: caseRow.hadRemediation === true,
            outcomeOverridden: true,
          });
        },
        setAppealVerdict(/** @type {string} */ value) {
          appealVerdict = value;
          render();
        },
        setAppealResolution(/** @type {string} */ value) {
          appealResolutionDraft = value;
        },
        setAppealOutcome(/** @type {string} */ value) {
          appealOutcomeDraft = value;
        },
        async resolveAppeal() {
          const open = (caseRow?.appeals ?? []).find(
            (appeal) => appeal.state !== 'resolved'
          );
          const rationale = appealResolutionDraft.trim();
          if (
            !open ||
            !rationale ||
            !['agreed', 'rejected'].includes(appealVerdict) ||
            (appealVerdict === 'agreed' && !appealOutcomeDraft)
          ) {
            return;
          }
          const at = (options.now ?? (() => new Date()))().toISOString();
          const appeals = (caseRow?.appeals ?? []).map((appeal) =>
            appeal.id === open.id
              ? /** @type {import('../sharepoint-client.js').Appeal} */ ({
                  ...appeal,
                  state: 'resolved',
                  resolution: {
                    verdict: appealVerdict,
                    rationale,
                    resolver: viewerId,
                    at,
                  },
                })
              : appeal
          );
          const amendment =
            appealVerdict === 'agreed' && appealOutcomeDraft
              ? {
                  amendedOutcome: {
                    outcome: appealOutcomeDraft,
                    justification: rationale,
                    amendedBy: viewerId,
                    amendedAt: at,
                    fromAppealId: open.id,
                  },
                  effectiveOutcome: appealOutcomeDraft,
                  effectiveHadRemediation: caseRow?.hadRemediation === true,
                  outcomeOverridden: true,
                }
              : {};
          await transition({
            appeals,
            hasOpenAppeal: false,
            appealRaisedAt: null,
            ...amendment,
          });
        },
        appealVerdict,
        responsiblePartyQuery,
        responsiblePartyName,
        responsiblePartyPeople,
        capturePeople,
        sectionHeading(
          /** @type {string} */ id,
          /** @type {string} */ fallback
        ) {
          return sectionCopy(
            /** @type {NewDashboardConfig} */ (config),
            id,
            'heading',
            fallback
          );
        },
        voidReasonDraft,
        setVoidReason(/** @type {string} */ value) {
          voidReasonDraft = value;
          render();
        },
        async searchResponsibleParty(/** @type {string} */ value) {
          responsiblePartyQuery = value;
          responsiblePartyPeople = value.trim()
            ? ((await options.client.searchPeople?.(value.trim())) ?? [])
            : [];
          render();
        },
        async selectResponsibleParty(
          /** @type {{loginName:string,displayName:string}} */ person
        ) {
          responsiblePartyName = person.displayName;
          responsiblePartyQuery = '';
          responsiblePartyPeople = [];
          await transition({ responsibleParty: person.loginName });
        },
        async searchCapturePerson(
          /** @type {string} */ key,
          /** @type {string} */ query
        ) {
          capturePeople = {
            ...capturePeople,
            [key]: query.trim()
              ? ((await options.client.searchPeople?.(query.trim())) ?? [])
              : [],
          };
          render();
        },
      })
    );
  }
}

/** @param {HTMLElement} root @param {HTMLElement | null} active */
function isLiveTextControl(root, active) {
  if (!active) return false;
  let node = /** @type {HTMLElement | null} */ (active);
  let inside = false;
  while (node) {
    if (node === root) {
      inside = true;
      break;
    }
    node = /** @type {HTMLElement | null} */ (node.parentNode);
  }
  if (!inside) return false;
  if (active.tagName === 'TEXTAREA') return true;
  if (active.tagName !== 'INPUT') return false;
  return ['text', 'search', 'email', 'url', 'tel', 'password'].includes(
    String(
      /** @type {HTMLInputElement} */ (active).type || 'text'
    ).toLowerCase()
  );
}

/** @param {NewDashboardConfig} config @param {string} id @param {'tab'|'heading'} axis @param {string} fallback */
function sectionCopy(config, id, axis, fallback) {
  const override = config.sectionLabels?.[id];
  if (typeof override === 'string') return override;
  return override?.[axis] ?? fallback;
}

/**
 * @param {CaseRow} caseRow
 * @param {NewDashboardConfig} config
 * @param {string[]} roles
 * @param {string} activeTab
 * @param {string} saveStatus
 * @param {any} actions
 */
function caseView(caseRow, config, roles, activeTab, saveStatus, actions) {
  if (roles.includes('none')) {
    return h(
      'section',
      { className: 'cora-error-panel', role: 'alert' },
      h('h1', {}, 'Access denied'),
      h('p', {}, 'You do not have access to this Case.')
    );
  }
  const tabs = visibleTabs(caseRow, roles, config).map(
    ([id, label]) =>
      /** @type {[string,string]} */ ([
        id,
        sectionCopy(config, id, 'tab', label),
      ])
  );
  const canEditReview =
    roles.includes('assignedReviewer') &&
    caseRow.status === CASE_STATUS.IN_PROGRESS;
  const canEditNotes =
    roles.includes('assignedReviewer') &&
    caseRow.status !== CASE_STATUS.COMPLETED &&
    caseRow.status !== CASE_STATUS.VOID;
  const conversationStatuses = config.sections?.conversation
    ?.allowMessagesWhen ?? [CASE_STATUS.ACTIONS_IN_PROGRESS];
  actions.canPostConversation =
    roles.some((role) =>
      [
        'assignedReviewer',
        'responsibleParty',
        'responsiblePartyManager',
      ].includes(role)
    ) && conversationStatuses.includes(caseRow.status);
  const review = h(
    'article',
    {
      className: 'cora-case-review cora-new-dashboard',
      'data-conversation-mode': 'popover',
      onkeydown: (/** @type {KeyboardEvent} */ event) => {
        if (event.altKey && event.key.toLowerCase() === 'c') {
          event.preventDefault();
          actions.toggleConversation();
        }
      },
    },
    h(
      'header',
      { className: 'cora-case-review__header' },
      h('h1', {}, caseRow.title),
      h('p', {}, `Reviewer: ${caseRow.assignedReviewer || '—'}`),
      actions.versionWarning
        ? h(
            'p',
            { className: 'cora-alert', role: 'alert' },
            actions.versionWarning
          )
        : null,
      caseRow.status === CASE_STATUS.COMPLETED ||
        caseRow.status === CASE_STATUS.VOID
        ? h(
            'p',
            { className: 'cora-case-review__terminal-banner' },
            `${caseRow.status} — this Case is read-only`
          )
        : null,
      h(
        'button',
        {
          className: 'cora-conversation-toggle-btn',
          'aria-expanded': String(actions.conversationOpen),
          'aria-label': 'Toggle conversation panel (⌥C / Alt+C)',
          onclick: actions.toggleConversation,
        },
        'Conversation'
      ),
      h(
        'span',
        { className: 'cora-case-review__save-status', role: 'status' },
        saveStatus
      )
    ),
    h(
      'div',
      {
        className: 'cora-case-review__tab-strip',
      },
      h(
        'div',
        {
          className: 'cora-tabs-list',
          role: 'tablist',
          'aria-label': 'Case sections',
        },
        ...tabs.map(([id, label], index) =>
          h(
            'button',
            {
              id: `new-case-tab-${id}`,
              className: 'cora-tabs-tab',
              role: 'tab',
              'aria-selected': String(activeTab === id),
              tabindex: activeTab === id ? 0 : -1,
              'aria-controls': `new-case-panel-${id}`,
              onclick: () => actions.selectTab(id),
              onkeydown: (/** @type {KeyboardEvent} */ event) => {
                if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                event.preventDefault();
                const offset = event.key === 'ArrowRight' ? 1 : -1;
                const next = (index + offset + tabs.length) % tabs.length;
                actions.selectTab(tabs[next][0], true);
              },
            },
            label
          )
        )
      ),
      canEditReview
        ? h(
            'div',
            { className: 'cora-case-review__hold-control' },
            h(
              'button',
              {
                className: 'cora-case-review__hold-toggle',
                'aria-pressed': String(caseRow.onHold === true),
                onclick: () => {
                  const onHold = caseRow.onHold !== true;
                  actions.transition({
                    onHold,
                    placedOnHoldAt: onHold ? actions.now().toISOString() : null,
                  });
                },
              },
              'On hold'
            )
          )
        : null
    ),
    activeTab === 'details'
      ? detailsView(caseRow, config, config.detailFields ?? [])
      : activeTab === 'questions'
        ? questionsView(
            caseRow,
            config,
            actions.answer,
            canEditReview,
            actions.jumpToUnanswered
          )
        : activeTab === 'issues'
          ? issuesView(caseRow, config, actions, canEditReview)
          : activeTab === 'summary'
            ? summaryView(caseRow, config, roles)
            : activeTab === 'remediation'
              ? remediationView(
                  caseRow,
                  config,
                  actions.editAnswer,
                  roles.includes('assignedReviewer') &&
                    caseRow.status === CASE_STATUS.ACTIONS_IN_PROGRESS
                )
              : activeTab === 'notes'
                ? notesView(caseRow, actions, canEditNotes)
                : activeTab === 'appealRequest'
                  ? appealRequestView(caseRow, actions)
                  : activeTab === 'amendOutcome'
                    ? amendOutcomeView(caseRow, config, actions)
                    : activeTab === 'appealReview'
                      ? appealReviewView(caseRow, config, actions)
                      : activeTab
                        ? placeholderPanel(activeTab)
                        : null,
    conversationView(caseRow, actions),
    completionControl(caseRow, config, roles, actions),
    voidControl(caseRow, config, roles, actions)
  );
  return h(
    'div',
    { className: 'cora-new-dashboard-shell' },
    appNav(),
    h('main', { className: 'cora-page-content' }, review)
  );
}

/** @param {CaseRow} caseRow @param {NewDashboardConfig} config @param {any} actions */
function appealReviewView(caseRow, config, actions) {
  const open = (caseRow.appeals ?? []).find(
    (appeal) => appeal.state !== 'resolved'
  );
  return h(
    'section',
    {
      id: 'new-case-panel-appealReview',
      className: 'cora-tabs-panel cora-appeal-review',
      role: 'tabpanel',
      'aria-labelledby': 'new-case-tab-appealReview',
    },
    h('h2', {}, actions.sectionHeading('appealReview', 'Appeal Review')),
    open ? h('p', {}, open.rationale) : h('p', {}, 'No open Appeal.'),
    open
      ? h(
          'div',
          {},
          h(
            'fieldset',
            { role: 'radiogroup' },
            h('legend', {}, 'Verdict'),
            ...[
              ['agreed', 'Agree'],
              ['rejected', 'Reject'],
            ].map(([value, label]) =>
              h(
                'label',
                {},
                h('input', {
                  type: 'radio',
                  name: 'appeal-verdict',
                  value,
                  checked: actions.appealVerdict === value,
                  onchange: (/** @type {any} */ event) =>
                    actions.setAppealVerdict(event.target.value),
                }),
                label
              )
            )
          ),
          actions.appealVerdict === 'agreed'
            ? h(
                'label',
                {},
                'Corrected outcome',
                h(
                  'select',
                  {
                    onchange: (/** @type {any} */ event) =>
                      actions.setAppealOutcome(event.target.value),
                  },
                  h('option', { value: '' }, 'Select…'),
                  ...(config.outcomeOptions ?? []).map((option) =>
                    h('option', { value: option.id }, option.wording)
                  )
                )
              )
            : null,
          h(
            'label',
            {},
            'Resolution rationale',
            h('textarea', {
              oninput: (/** @type {any} */ event) =>
                actions.setAppealResolution(event.target.value),
            })
          ),
          h('button', { onclick: actions.resolveAppeal }, 'Resolve Appeal')
        )
      : null
  );
}

/** @param {CaseRow} caseRow @param {NewDashboardConfig} config @param {any} actions */
function amendOutcomeView(caseRow, config, actions) {
  const current =
    caseRow.amendedOutcome?.outcome ?? caseRow.outcomeAtCompletion ?? '—';
  return h(
    'section',
    {
      id: 'new-case-panel-amendOutcome',
      className: 'cora-tabs-panel cora-amend-outcome',
      role: 'tabpanel',
      'aria-labelledby': 'new-case-tab-amendOutcome',
    },
    h('h2', {}, actions.sectionHeading('amendOutcome', 'Amend Outcome')),
    h(
      'p',
      { className: 'cora-amend-outcome-current' },
      `Current Outcome: ${current}`
    ),
    h(
      'label',
      {},
      'New outcome',
      h(
        'select',
        {
          onchange: (/** @type {any} */ event) =>
            actions.setAmendedOutcome(event.target.value),
        },
        h('option', { value: '' }, 'Select…'),
        ...(config.outcomeOptions ?? []).map((option) =>
          h('option', { value: option.id }, option.wording)
        )
      )
    ),
    h(
      'label',
      {},
      'Justification',
      h('textarea', {
        oninput: (/** @type {any} */ event) =>
          actions.setAmendmentJustification(event.target.value),
      })
    ),
    h('button', { onclick: actions.amendOutcome }, 'Amend Outcome')
  );
}

/** @param {CaseRow} caseRow @param {any} actions */
function appealRequestView(caseRow, actions) {
  const open = (caseRow.appeals ?? []).find(
    (appeal) => appeal.state !== 'resolved'
  );
  return h(
    'section',
    {
      id: 'new-case-panel-appealRequest',
      className: 'cora-tabs-panel cora-appeal',
      role: 'tabpanel',
      'aria-labelledby': 'new-case-tab-appealRequest',
    },
    h('h2', {}, actions.sectionHeading('appealRequest', 'Appeal')),
    open
      ? h(
          'p',
          { className: 'cora-appeal-open-note' },
          'An Appeal is awaiting review.'
        )
      : h(
          'div',
          { className: 'cora-appeal-form' },
          h(
            'label',
            {},
            'Rationale',
            h('textarea', {
              oninput: (/** @type {any} */ event) =>
                actions.setAppealDraft(event.target.value),
            })
          ),
          h(
            'button',
            { type: 'button', onclick: actions.raiseAppeal },
            'Raise Appeal'
          )
        ),
    ...(caseRow.appeals ?? []).map((appeal) =>
      h(
        'article',
        { className: 'cora-appeal-item' },
        h('p', {}, appeal.rationale)
      )
    )
  );
}

/** @param {CaseRow} caseRow @param {any} actions @param {boolean} editable */
function notesView(caseRow, actions, editable) {
  return h(
    'section',
    {
      id: 'new-case-panel-notes',
      className: 'cora-tabs-panel',
      role: 'tabpanel',
      'aria-labelledby': 'new-case-tab-notes',
    },
    h('h2', {}, actions.sectionHeading('notes', 'Notes')),
    h(
      'label',
      {},
      'Notes',
      h('textarea', {
        value: caseRow.notes,
        disabled: !editable,
        oninput: (/** @type {any} */ event) =>
          actions.editFields({ notes: event.target.value }, false),
      })
    )
  );
}

/** @param {CaseRow} caseRow @param {NewDashboardConfig} config @param {string[]} roles @param {any} actions */
function voidControl(caseRow, config, roles, actions) {
  if (
    !roles.includes('assignedReviewer') ||
    (caseRow.status !== CASE_STATUS.IN_PROGRESS &&
      caseRow.status !== CASE_STATUS.ACTIONS_IN_PROGRESS)
  ) {
    return null;
  }
  const reasons = voidReasonsFor(config);
  return h(
    'div',
    { className: 'cora-void-control' },
    h(
      'label',
      {},
      'Void reason',
      h(
        'select',
        {
          value: actions.voidReasonDraft,
          onchange: (/** @type {any} */ event) =>
            actions.setVoidReason(event.target.value),
        },
        h('option', { value: '' }, 'Select…'),
        ...reasons.map((reason) =>
          h('option', { value: reason.key }, reason.label)
        )
      )
    ),
    h(
      'button',
      {
        className: 'cora-btn-danger',
        disabled: !reasons.some(
          (reason) => reason.key === actions.voidReasonDraft
        ),
        onclick: () => {
          const reason = actions.voidReasonDraft;
          if (!reasons.some((entry) => entry.key === reason)) return;
          actions.transition({
            status: CASE_STATUS.VOID,
            voidReason: reason,
            voidedAt: actions.now().toISOString(),
            voidedBy: actions.viewerId,
            onHold: false,
            placedOnHoldAt: null,
          });
        },
      },
      'Void Case…'
    )
  );
}

/** @param {CaseRow} caseRow @param {any} actions */
function conversationView(caseRow, actions) {
  if (!actions.conversationOpen) return null;
  return h(
    'aside',
    {
      className: 'cora-case-review__conversation',
      'aria-label': 'Conversation',
    },
    h('h2', {}, actions.sectionHeading('conversation', 'Conversation')),
    ...caseRow.conversation.map((message) =>
      h(
        'article',
        {},
        h('strong', {}, message.author),
        h('p', {}, message.body)
      )
    ),
    h(
      'label',
      {},
      'Message',
      h('textarea', {
        value: actions.conversationDraft,
        disabled: !actions.canPostConversation,
        oninput: (/** @type {any} */ event) =>
          actions.setConversationDraft(event.target.value),
      })
    ),
    actions.canPostConversation
      ? h('button', { onclick: actions.postConversation }, 'Send message')
      : null
  );
}

/**
 * @param {CaseRow} caseRow
 * @param {NewDashboardConfig} config
 * @param {string[]} roles
 * @param {{transition:(fields:Partial<CaseRow>)=>Promise<void>, now:()=>Date}} actions
 */
function completionControl(caseRow, config, roles, actions) {
  if (!roles.includes('assignedReviewer')) {
    return null;
  }
  if (caseRow.status === CASE_STATUS.ACTIONS_IN_PROGRESS) {
    const remediations = failedQuestions(caseRow, config).filter(
      (question) => caseRow.answers[question.id]?.remediationRequired === 'yes'
    );
    const resolved = remediations.every((question) => {
      const resolution = caseRow.answers[question.id]?.remediationStatus;
      return (
        resolution?.status === 'complete' ||
        ((resolution?.status === 'partial' ||
          resolution?.status === 'cancelled') &&
          Boolean(resolution?.details?.trim()))
      );
    });
    return h(
      'div',
      { className: 'cora-case-review__completion' },
      h(
        'button',
        {
          className: 'cora-complete-btn',
          disabled: !resolved,
          onclick: () =>
            actions.transition({
              status: CASE_STATUS.COMPLETED,
              completedAt: actions.now().toISOString(),
            }),
        },
        'Complete Case'
      )
    );
  }
  if (caseRow.status !== CASE_STATUS.IN_PROGRESS) return null;
  const questions = applicableQuestions(
    config.questions ?? [],
    caseRow.answers
  );
  const allAnswered = questions.every((question) =>
    hasAnswer(caseRow.answers[question.id])
  );
  const requiredGeneralAnswered = (config.generalQuestions ?? [])
    .filter((field) => field.required)
    .every((field) => hasAnswer(caseRow.answers[`general:${field.key}`]));
  if (!allAnswered || !requiredGeneralAnswered) return null;
  const failures = failedQuestions(caseRow, config);
  const requiredCaptureAnswered = failures.every((question) => {
    const answer = caseRow.answers[question.id];
    const values = Object.fromEntries(
      Object.entries(answer?.capture ?? {}).map(([key, value]) => [
        key,
        { value },
      ])
    );
    return (config.captureGroups ?? []).every((group) =>
      group.fields
        .filter(
          (/** @type {any} */ field) =>
            field.required && matchesShowWhen(field.showWhen, values)
        )
        .every((/** @type {any} */ field) =>
          hasCaptureValue(answer?.capture?.[field.key])
        )
    );
  });
  const carriesRemediation = (/** @type {any} */ question) => {
    const answer = caseRow.answers[question.id];
    return (
      (answer?.remediationActions?.length ?? 0) > 0 ||
      Boolean(answer?.freeFormRemediation?.trim())
    );
  };
  const allDecided = failures.every((question) => {
    const answer = caseRow.answers[question.id];
    return (
      answer?.remediationRequired === 'no' ||
      (answer?.remediationRequired === 'yes' && carriesRemediation(question))
    );
  });
  const hadRemediation = failures.some(
    (question) =>
      caseRow.answers[question.id]?.remediationRequired === 'yes' &&
      carriesRemediation(question)
  );
  const hasResponsibleParty =
    !hadRemediation || Boolean(caseRow.responsibleParty);
  const label = hadRemediation ? 'Send Actions' : 'Complete Case';
  return h(
    'div',
    { className: 'cora-case-review__completion' },
    h(
      'button',
      {
        className: 'cora-complete-btn',
        disabled:
          !allAnswered ||
          !requiredGeneralAnswered ||
          !requiredCaptureAnswered ||
          !allDecided ||
          !hasResponsibleParty,
        onclick: async () => {
          const at = actions.now().toISOString();
          const outcome = configuredOutcome(caseRow, config);
          await actions.transition({
            status: hadRemediation
              ? CASE_STATUS.ACTIONS_IN_PROGRESS
              : CASE_STATUS.COMPLETED,
            reportableAt: at,
            ...(hadRemediation
              ? {
                  remediationDueDate: addWorkingDays(
                    at,
                    config.remediationSlaWorkingDays ?? 10
                  ),
                }
              : {}),
            ...(hadRemediation ? {} : { completedAt: at }),
            outcomeAtCompletion: outcome,
            hadRemediation,
            effectiveOutcome: outcome,
            effectiveHadRemediation: hadRemediation,
            outcomeOverridden: false,
            questionBankVersion: String(config.version ?? ''),
          });
        },
      },
      label
    )
  );
}

/**
 * @param {CaseRow} caseRow
 * @param {NewDashboardConfig} config
 * @param {(id:string,patch:Record<string,any>,renderNow?:boolean)=>void} editAnswer
 * @param {boolean} editable
 */
function remediationView(caseRow, config, editAnswer, editable) {
  const rows = failedQuestions(caseRow, config).filter(
    (question) => caseRow.answers[question.id]?.remediationRequired === 'yes'
  );
  /** @type {Record<string, string>} */
  const labels = {
    complete: 'Complete',
    partial: 'Partially complete',
    cancelled: 'Cancelled',
  };
  return h(
    'section',
    {
      id: 'new-case-panel-remediation',
      className: 'cora-tabs-panel cora-remediation-tracking',
      role: 'tabpanel',
      'aria-labelledby': 'new-case-tab-remediation',
    },
    h('h2', {}, sectionCopy(config, 'remediation', 'heading', 'Remediation')),
    h('p', {}, `Remediation due: ${caseRow.remediationDueDate ?? '—'}`),
    caseRow.responsibleParty
      ? h('p', {}, `Responsible Party: ${caseRow.responsibleParty}`)
      : null,
    ...rows.map((question) => {
      const answer = caseRow.answers[question.id];
      return h(
        'article',
        { className: 'cora-remediation-row' },
        h('h3', {}, question.text),
        ...(answer.remediationActions ?? []).map((action) =>
          h('p', { className: 'cora-remediation-action' }, action.text)
        ),
        answer.freeFormRemediation
          ? h('p', {}, answer.freeFormRemediation)
          : null,
        h(
          'fieldset',
          { role: 'radiogroup' },
          h('legend', {}, 'Resolution'),
          ...(
            config.remediationStatuses ?? ['complete', 'partial', 'cancelled']
          ).map((status) =>
            h(
              'label',
              {},
              h('input', {
                type: 'radio',
                name: `resolution-${question.id}`,
                value: status,
                checked: answer.remediationStatus?.status === status,
                disabled: !editable,
                onchange: (/** @type {any} */ event) =>
                  editAnswer(question.id, {
                    remediationStatus: { status: event.target.value },
                  }),
              }),
              labels[status] ?? status
            )
          )
        ),
        answer.remediationStatus?.status === 'partial' ||
          answer.remediationStatus?.status === 'cancelled'
          ? h(
              'label',
              {},
              answer.remediationStatus?.status === 'cancelled'
                ? 'Cancellation justification'
                : 'Partial completion details',
              h('textarea', {
                value: answer.remediationStatus?.details ?? '',
                disabled: !editable,
                oninput: (/** @type {any} */ event) =>
                  editAnswer(
                    question.id,
                    {
                      remediationStatus: {
                        ...answer.remediationStatus,
                        details: event.target.value,
                      },
                    },
                    false
                  ),
              })
            )
          : null
      );
    })
  );
}

function appNav() {
  return h(
    'nav',
    { className: 'cora-app-nav-bar', 'aria-label': 'Primary' },
    h(
      'a',
      {
        href: '#/',
        role: 'link',
        className: 'cora-app-nav-brand',
        'aria-label': 'CORA — home',
      },
      h('span', { className: 'cora-app-nav-mark', 'aria-hidden': 'true' }, 'C'),
      h('span', { className: 'cora-app-nav-name' }, 'CORA')
    ),
    h(
      'div',
      { className: 'cora-app-nav-items', role: 'list' },
      ...[
        ['Dashboard', '#/dashboard'],
        ['Roadmap', '#/roadmap'],
      ].map(([label, href]) =>
        h(
          'a',
          {
            href,
            role: 'link',
            className: 'cora-app-nav-item',
          },
          label
        )
      )
    )
  );
}

/** @param {CaseRow} caseRow @param {NewDashboardConfig} config @param {string[]} roles */
function summaryView(caseRow, config, roles) {
  const questions = applicableQuestions(
    config.questions ?? [],
    caseRow.answers
  );
  const answered = questions.filter((question) =>
    hasAnswer(caseRow.answers[question.id])
  ).length;
  const optionById = new Map(
    (config.outcomeOptions ?? []).map((option) => [option.id, option])
  );
  let outcome = optionById.get(config.defaultOutcomeId);
  for (const question of questions) {
    const value = caseRow.answers[question.id]?.value;
    for (const entry of Array.isArray(value) ? value : [value]) {
      const outcomeId = question.optionOutcomes?.[entry];
      const candidate = outcomeId ? optionById.get(outcomeId) : undefined;
      if (candidate && (!outcome || candidate.severity > outcome.severity)) {
        outcome = candidate;
      }
    }
  }
  const remediationActionCount = Object.values(caseRow.answers).reduce(
    (count, answer) =>
      count +
      (answer.remediationActions?.length ?? 0) +
      (answer.freeFormRemediation?.trim() ? 1 : 0),
    0
  );
  return h(
    'section',
    {
      id: 'new-case-panel-summary',
      className: 'cora-tabs-panel cora-summary',
      role: 'tabpanel',
      'aria-labelledby': 'new-case-tab-summary',
      'data-access': 'read-only',
    },
    h('h2', {}, sectionCopy(config, 'summary', 'heading', 'Summary')),
    h(
      'section',
      { className: 'cora-outcome cora-summary-outcome' },
      h('h2', {}, 'Outcome'),
      h('p', {}, outcome?.wording ?? '—')
    ),
    summaryIncludes(caseRow, config, 'questions', roles)
      ? h(
          'article',
          { className: 'cora-summary-block' },
          h('h3', {}, 'Questions'),
          h('p', {}, `${answered}/${questions.length} answered`)
        )
      : null,
    summaryIncludes(caseRow, config, 'details', roles)
      ? h(
          'article',
          { className: 'cora-summary-block' },
          h('h3', {}, 'Case Details'),
          h(
            'dl',
            {},
            ...(config.detailFields ?? []).flatMap(({ key, label }) => [
              h('dt', {}, label),
              h('dd', {}, caseRow.details?.[key] || '—'),
            ])
          )
        )
      : null,
    summaryIncludes(caseRow, config, 'questions', roles) &&
      (config.generalQuestions ?? []).some((field) =>
        hasAnswer(caseRow.answers[`general:${field.key}`])
      )
      ? h(
          'article',
          { className: 'cora-summary-general-questions' },
          h('h3', {}, 'General Questions'),
          h(
            'dl',
            {},
            ...(config.generalQuestions ?? []).flatMap((field) => {
              const answer = caseRow.answers[`general:${field.key}`];
              if (!hasAnswer(answer)) return [];
              return [
                h('dt', {}, field.label),
                h(
                  'dd',
                  {},
                  Array.isArray(answer.value)
                    ? answer.value.join(', ')
                    : String(answer.value)
                ),
              ];
            })
          )
        )
      : null,
    summaryIncludes(caseRow, config, 'issues', roles) &&
      failedQuestions(caseRow, config).length
      ? h(
          'article',
          { className: 'cora-summary-issues' },
          h('h3', {}, 'Issues'),
          ...failedQuestions(caseRow, config).map((question) =>
            h(
              'section',
              {},
              h('h4', {}, question.text),
              h(
                'p',
                {},
                `Response: ${displayAnswerValue(caseRow.answers[question.id]?.value)}`
              ),
              caseRow.answers[question.id]?.justification
                ? h('p', {}, String(caseRow.answers[question.id].justification))
                : null
            )
          )
        )
      : null,
    summaryIncludes(caseRow, config, 'notes', roles) && caseRow.notes
      ? h(
          'article',
          { className: 'cora-summary-notes' },
          h('h3', {}, 'Notes'),
          h('p', {}, caseRow.notes)
        )
      : null,
    summaryIncludes(caseRow, config, 'remediation', roles) &&
      (remediationActionCount ||
        caseRow.remediationDueDate ||
        caseRow.responsibleParty)
      ? h(
          'article',
          { className: 'cora-summary-block' },
          h('h3', {}, 'Remediation'),
          h('p', {}, `Remediation Actions: ${remediationActionCount}`),
          h('p', {}, `Remediation due: ${caseRow.remediationDueDate ?? '—'}`),
          h('p', {}, `Responsible Party: ${caseRow.responsibleParty ?? '—'}`)
        )
      : null
  );
}

/** @param {CaseRow} caseRow @param {NewDashboardConfig} config @param {string} section @param {string[]} roles */
function summaryIncludes(caseRow, config, section, roles) {
  if (!visibleTabs(caseRow, roles, config).some(([id]) => id === section)) {
    return false;
  }
  const configured = config.sections?.[section]?.showInSummary;
  if (Array.isArray(configured)) {
    return configured.some((role) => roles.includes(role));
  }
  if (typeof configured === 'boolean') return configured;
  return section !== 'notes';
}

/** @param {unknown} value */
function displayAnswerValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  return value === undefined || value === null || value === ''
    ? '—'
    : String(value);
}

/** @param {CaseRow} caseRow @param {NewDashboardConfig} config @param {any} actions @param {boolean} editable */
function issuesView(caseRow, config, actions, editable) {
  const editAnswer = actions.editAnswer;
  const failures = failedQuestions(caseRow, config);
  return h(
    'section',
    {
      id: 'new-case-panel-issues',
      className: 'cora-tabs-panel cora-issues',
      role: 'tabpanel',
      'aria-labelledby': 'new-case-tab-issues',
    },
    h('h2', {}, sectionCopy(config, 'issues', 'heading', 'Issues')),
    failures.length === 0
      ? h('p', { className: 'cora-empty-state' }, 'No issues identified.')
      : failures.map((question) => {
          const answer = caseRow.answers[question.id];
          return h(
            'article',
            { className: 'cora-issue-card' },
            h('h3', {}, question.text),
            h('p', {}, h('strong', {}, 'Response'), ` ${answer.value}`),
            h(
              'fieldset',
              { className: 'cora-issue-remediation' },
              h('legend', {}, 'Remediation required?'),
              ...['yes', 'no'].map((value) =>
                h(
                  'label',
                  {},
                  h('input', {
                    type: 'radio',
                    name: `remediation-${question.id}`,
                    value,
                    checked: answer.remediationRequired === value,
                    disabled: !editable,
                    onchange: (/** @type {any} */ event) =>
                      editAnswer(question.id, {
                        remediationRequired: event.target.value,
                        ...(event.target.value === 'no'
                          ? {
                              remediationActions: undefined,
                              freeFormRemediation: undefined,
                              remediationStatus: undefined,
                            }
                          : {}),
                      }),
                  }),
                  value === 'yes' ? 'Yes' : 'No'
                )
              )
            ),
            h(
              'label',
              {},
              'Justification',
              h('textarea', {
                value: answer.justification ?? '',
                disabled: !editable,
                oninput: (/** @type {any} */ event) =>
                  editAnswer(
                    question.id,
                    {
                      justification: event.target.value,
                    },
                    false
                  ),
              })
            ),
            ...remediationAuthoring(question, answer, editAnswer, editable),
            ...(config.captureGroups ?? []).map((group) => {
              const captureValues = Object.fromEntries(
                Object.entries(answer.capture ?? {}).map(([key, value]) => [
                  key,
                  { value },
                ])
              );
              const fields = group.fields.filter((/** @type {any} */ field) =>
                matchesShowWhen(field.showWhen, captureValues)
              );
              return h(
                'details',
                {
                  className: 'cora-capture-group',
                  open: group.collapsed !== true,
                },
                h('summary', {}, group.label),
                ...fields.map((/** @type {any} */ field) =>
                  captureField(
                    field,
                    answer,
                    (value, renderNow) =>
                      editAnswer(
                        question.id,
                        {
                          capture: { ...answer.capture, [field.key]: value },
                        },
                        renderNow
                      ),
                    editable,
                    actions,
                    `${question.id}:${field.key}`
                  )
                )
              );
            })
          );
        }),
    failures.some(
      (question) => caseRow.answers[question.id]?.remediationRequired === 'yes'
    ) || caseRow.responsibleParty
      ? responsiblePartyField(caseRow, actions, editable)
      : null
  );
}

/** @param {CaseRow} caseRow @param {any} actions @param {boolean} editable */
function responsiblePartyField(caseRow, actions, editable) {
  const name = actions.responsiblePartyName || caseRow.responsibleParty;
  return h(
    'section',
    { className: 'cora-responsible-party-field' },
    name ? h('p', {}, `Responsible Party: ${name}`) : null,
    editable
      ? h(
          'label',
          {},
          'Search people for Responsible Party',
          h('input', {
            type: 'search',
            value: actions.responsiblePartyQuery,
            oninput: (/** @type {any} */ event) =>
              actions.searchResponsibleParty(event.target.value),
          })
        )
      : null,
    ...actions.responsiblePartyPeople.map(
      (/** @type {{loginName:string,displayName:string}} */ person) =>
        h(
          'button',
          { onclick: () => actions.selectResponsibleParty(person) },
          person.displayName
        )
    )
  );
}

/**
 * @param {any} question
 * @param {any} answer
 * @param {(id:string,patch:Record<string,any>,renderNow?:boolean)=>void} editAnswer
 * @param {boolean} editable
 */
function remediationAuthoring(question, answer, editAnswer, editable) {
  /** @type {Array<{id:string,text:string}>} */
  const configured = (question.remediationActions ?? []).map(
    (
      /** @type {string|{id:string,text:string}} */ action,
      /** @type {number} */ index
    ) =>
      typeof action === 'string'
        ? { id: `${question.id}-ra-${index}`, text: action }
        : action
  );
  const selected = new Set(
    (answer.remediationActions ?? []).map(
      (/** @type {{id:string}} */ action) => action.id
    )
  );
  const visible = editable
    ? configured
    : configured.filter((action) => selected.has(action.id));
  const nodes = visible.map((action) =>
    h(
      'label',
      { className: 'cora-remediation-action' },
      h('input', {
        type: 'checkbox',
        checked: selected.has(action.id),
        disabled: !editable,
        onchange: (/** @type {any} */ event) => {
          const next = event.target.checked
            ? [...(answer.remediationActions ?? []), action]
            : (answer.remediationActions ?? []).filter(
                (/** @type {{id:string}} */ selectedAction) =>
                  selectedAction.id !== action.id
              );
          editAnswer(question.id, {
            remediationActions: next.length ? next : undefined,
          });
        },
      }),
      action.text
    )
  );
  if (!question.disallowFreeFormRemediation) {
    nodes.push(
      h(
        'label',
        {},
        'Free-form action',
        h('textarea', {
          value: answer.freeFormRemediation ?? '',
          disabled: !editable,
          oninput: (/** @type {any} */ event) =>
            editAnswer(
              question.id,
              {
                freeFormRemediation: event.target.value,
              },
              false
            ),
        })
      )
    );
  }
  return nodes;
}

/** @param {any} value */
function hasCaptureValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Boolean(value.loginName);
  return Boolean(String(value ?? '').trim());
}

/**
 * @param {any} field
 * @param {any} answer
 * @param {(value:any,renderNow?:boolean)=>void} onChange
 * @param {boolean} editable
 * @param {any} actions
 * @param {string} personKey
 */
function captureField(
  field,
  answer,
  onChange,
  editable = true,
  actions = {},
  personKey = ''
) {
  const value = answer.capture?.[field.key] ?? '';
  if (field.type === 'person') {
    const selected = value?.displayName ?? value?.loginName ?? '';
    return h(
      'div',
      { className: 'cora-capture-person' },
      selected ? h('p', {}, `${field.label}: ${selected}`) : null,
      h(
        'label',
        {},
        field.label,
        h('input', {
          type: 'search',
          disabled: !editable,
          placeholder: field.placeholder ?? 'Search people…',
          oninput: (/** @type {any} */ event) =>
            actions.searchCapturePerson(personKey, event.target.value),
        })
      ),
      ...(actions.capturePeople?.[personKey] ?? []).map(
        (/** @type {{loginName:string,displayName:string}} */ person) =>
          h(
            'button',
            {
              disabled: !editable,
              onclick: () => onChange(person),
            },
            person.displayName
          )
      )
    );
  }
  if (field.type === 'textarea') {
    return h(
      'label',
      {},
      field.label,
      h('textarea', {
        value,
        disabled: !editable,
        placeholder: field.placeholder,
        oninput: (/** @type {any} */ event) =>
          onChange(event.target.value, false),
      })
    );
  }
  if (field.type === 'select') {
    return h(
      'label',
      {},
      field.label,
      h(
        'select',
        {
          value,
          disabled: !editable,
          onchange: (/** @type {any} */ event) => onChange(event.target.value),
        },
        h('option', { value: '' }, '—'),
        ...(field.options ?? []).map((/** @type {any} */ option) =>
          h('option', { value: option }, option)
        )
      )
    );
  }
  if (field.type === 'radio') {
    return h(
      'fieldset',
      {},
      h('legend', {}, field.label),
      ...(field.options ?? []).map((/** @type {any} */ option) =>
        h(
          'label',
          {},
          h('input', {
            type: 'radio',
            value: option,
            checked: value === option,
            disabled: !editable,
            onchange: (/** @type {any} */ event) =>
              onChange(event.target.value),
          }),
          option
        )
      )
    );
  }
  return h(
    'label',
    {},
    field.label,
    h('input', {
      type: 'text',
      value,
      disabled: !editable,
      placeholder: field.placeholder,
      oninput: (/** @type {any} */ event) =>
        onChange(event.target.value, false),
    })
  );
}

/** @param {string} id */
function placeholderPanel(id) {
  /** @type {Record<string, string>} */
  const headings = { issues: 'Issues', summary: 'Summary', notes: 'Notes' };
  return h(
    'section',
    {
      id: `new-case-panel-${id}`,
      className: 'cora-tabs-panel',
      role: 'tabpanel',
      'aria-labelledby': `new-case-tab-${id}`,
    },
    h('h2', {}, headings[id] ?? id)
  );
}

/** @param {CaseRow} caseRow @param {NewDashboardConfig} config @param {Array<{key:string,label:string}>} detailFields */
function detailsView(caseRow, config, detailFields) {
  /** @type {Array<[string, unknown]>} */
  const fields = [
    ['Title', caseRow.title],
    ['Assigned Reviewer', caseRow.assignedReviewer],
    ['Status', caseRow.status],
    ['Due date', caseRow.dueDate],
    ['Related date', caseRow.relatedDate],
    ['Created', caseRow.created],
    ['Completed on', caseRow.completedAt],
    ...detailFields.map(
      ({ key, label }) =>
        /** @type {[string, unknown]} */ ([label, caseRow.details?.[key]])
    ),
  ];
  return h(
    'section',
    {
      id: 'new-case-panel-details',
      className: 'cora-tabs-panel cora-case-details',
      role: 'tabpanel',
      'aria-labelledby': 'new-case-tab-details',
      'data-access': 'read-only',
    },
    h('h2', {}, sectionCopy(config, 'details', 'heading', 'Case Details')),
    h(
      'dl',
      { className: 'cora-case-details-list' },
      ...fields.flatMap(([label, value]) => [
        h('dt', { className: 'cora-case-details-label' }, label),
        h(
          'dd',
          { className: 'cora-case-details-value' },
          value ? String(value) : '—'
        ),
      ])
    )
  );
}

/**
 * @param {CaseRow} caseRow
 * @param {NewDashboardConfig} config
 * @param {(id:string,value:any,renderNow?:boolean)=>void} onAnswer
 * @param {boolean} editable
 * @param {()=>void} jumpToUnanswered
 */
function questionsView(caseRow, config, onAnswer, editable, jumpToUnanswered) {
  const questions = applicableQuestions(
    config.questions ?? [],
    caseRow.answers
  );
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const question of questions) {
    const name = question.questionGroup ?? 'Questions';
    const entries = groups.get(name) ?? [];
    entries.push(question);
    groups.set(name, entries);
  }
  return h(
    'section',
    {
      id: 'new-case-panel-questions',
      className: 'cora-tabs-panel cora-question-panel',
      role: 'tabpanel',
      'data-access': editable ? 'edit' : 'read-only',
      'aria-labelledby': 'new-case-tab-questions',
    },
    h('h2', {}, sectionCopy(config, 'questions', 'heading', 'Questions')),
    config.generalQuestionsPlacement === 'before'
      ? generalQuestionsView(config, caseRow, onAnswer, editable)
      : null,
    h(
      'div',
      { className: 'cora-question-list' },
      ...[...groups].flatMap(([name, entries]) =>
        questionGroup(
          name,
          entries,
          caseRow.answers,
          onAnswer,
          (config.questionGroups?.[name]?.allowBulkOutcome ??
            config.allowBulkOutcome) === true,
          editable
        )
      )
    ),
    h(
      'aside',
      { className: 'cora-group-progress', 'aria-label': 'Question Groups' },
      h(
        'button',
        {
          className: 'cora-jump-unanswered-btn',
          onclick: jumpToUnanswered,
        },
        'Jump to next unanswered'
      ),
      ...[...groups].map(([name, entries]) => {
        const answered = entries.filter((question) =>
          hasAnswer(caseRow.answers[question.id])
        ).length;
        return h(
          'div',
          {
            className:
              answered === entries.length
                ? 'cora-group-progress-row complete'
                : 'cora-group-progress-row',
          },
          h('span', { className: 'cora-group-progress-label' }, name),
          h(
            'span',
            { className: 'cora-group-progress-count' },
            `${answered}/${entries.length}`
          )
        );
      })
    ),
    config.generalQuestionsPlacement !== 'before'
      ? generalQuestionsView(config, caseRow, onAnswer, editable)
      : null
  );
}

/** @param {NewDashboardConfig} config @param {CaseRow} caseRow @param {(id:string,value:any,renderNow?:boolean)=>void} onAnswer @param {boolean} editable */
function generalQuestionsView(config, caseRow, onAnswer, editable) {
  if (!(config.generalQuestions ?? []).length) return null;
  return [
    h('hr', { className: 'cora-general-questions-rule' }),
    h(
      'section',
      { className: 'cora-general-questions' },
      h(
        'h3',
        { className: 'cora-general-questions-heading' },
        'GENERAL QUESTIONS'
      ),
      ...(config.generalQuestions ?? []).map((field) =>
        generalQuestion(
          field,
          caseRow.answers[`general:${field.key}`],
          onAnswer,
          editable
        )
      )
    ),
  ];
}

/** @param {any} field @param {any} answer @param {(id:string,value:any,renderNow?:boolean)=>void} onAnswer @param {boolean} editable */
function generalQuestion(field, answer, onAnswer, editable) {
  if (field.type === 'radio') {
    return h(
      'fieldset',
      { className: 'cora-general-question' },
      h('legend', {}, field.label),
      ...(field.options ?? []).map((/** @type {string} */ option) =>
        h(
          'label',
          {},
          h('input', {
            type: 'radio',
            name: `general-${field.key}`,
            value: option,
            checked: answer?.value === option,
            disabled: !editable,
            onchange: (/** @type {any} */ event) =>
              onAnswer(`general:${field.key}`, event.target.value),
          }),
          option
        )
      )
    );
  }
  if (field.type === 'select') {
    return h(
      'label',
      { className: 'cora-general-question' },
      field.label,
      h(
        'select',
        {
          value: answer?.value ?? '',
          disabled: !editable,
          onchange: (/** @type {any} */ event) =>
            onAnswer(`general:${field.key}`, event.target.value),
        },
        h('option', { value: '' }, '—'),
        ...(field.options ?? []).map((/** @type {string} */ option) =>
          h('option', { value: option }, option)
        )
      )
    );
  }
  return h(
    'label',
    { className: 'cora-general-question' },
    field.label,
    h(field.type === 'textarea' ? 'textarea' : 'input', {
      value: answer?.value ?? '',
      disabled: !editable,
      placeholder: field.placeholder,
      oninput: (/** @type {any} */ event) =>
        onAnswer(`general:${field.key}`, event.target.value, false),
    })
  );
}

/**
 * @param {string} name
 * @param {any[]} questions
 * @param {Record<string, any>} answers
 * @param {(id:string,value:any,renderNow?:boolean)=>void} onAnswer
 * @param {boolean} allowBulk
 * @param {boolean} editable
 */
function questionGroup(
  name,
  questions,
  answers,
  onAnswer,
  allowBulk,
  editable
) {
  return [
    h(
      'div',
      { className: 'cora-question-group-heading', 'data-qgroup': name },
      h('h4', {}, name),
      allowBulk
        ? h(
            'label',
            { className: 'cora-group-outcome-label' },
            h('span', {}, 'Group outcome'),
            h(
              'select',
              {
                className: 'cora-group-outcome',
                'aria-label': `Group outcome for ${name}`,
                value: '',
                disabled: !editable,
                onchange: (/** @type {any} */ event) => {
                  for (const question of questions) {
                    onAnswer(question.id, event.target.value);
                  }
                },
              },
              h('option', { value: '', disabled: true }, 'Set group outcome…'),
              ...[
                ...new Set(
                  questions.flatMap((question) => question.options ?? [])
                ),
              ].map((option) => h('option', { value: option }, option))
            )
          )
        : null
    ),
    ...questions.map((question) => {
      const options = responseOptions(question);
      const selected = answers[question.id]?.value;
      const multiple = ['multi-choice', 'multiple', 'multi'].includes(
        question.responseType
      );
      return h(
        'article',
        {
          className: 'cora-question-card',
          'data-unanswered': hasAnswer(answers[question.id]) ? null : 'true',
        },
        h(
          'fieldset',
          {
            id: `new-cora-q-${question.id}`,
            className: 'cora-question',
            role: multiple ? 'group' : 'radiogroup',
            'aria-required': 'true',
          },
          h('legend', {}, question.text),
          ...options.map((option) =>
            h(
              'label',
              { className: 'cora-question-option' },
              h('input', {
                type: 'radio',
                ...(multiple ? { type: 'checkbox' } : {}),
                name: `new-cora-q-${question.id}`,
                value: option,
                checked: multiple
                  ? Array.isArray(selected) && selected.includes(option)
                  : selected === option,
                disabled: !editable,
                onchange: (/** @type {any} */ event) => {
                  if (!multiple) {
                    onAnswer(question.id, String(event.target.value));
                    return;
                  }
                  const values = new Set(
                    Array.isArray(selected) ? selected : []
                  );
                  if (event.target.checked) values.add(event.target.value);
                  else values.delete(event.target.value);
                  onAnswer(question.id, [...values]);
                },
              }),
              h('span', {}, ` ${option}`)
            )
          )
        )
      );
    }),
  ];
}

/** @param {any} question */
function responseOptions(question) {
  const configured = ['yes-no', 'yes-no-na'].includes(question.responseType)
    ? ['Yes', 'No']
    : [...(question.options ?? [])];
  return configured.includes('NA') ? configured : [...configured, 'NA'];
}
