// @ts-check
import { h } from '../../lib/html.js';
import {
  baselineBank,
  currentBank,
  diffCounts,
  initialQuestionBankState,
  isDirty,
  questionBankReducer,
} from './bank-slice.js';
import { BankRail } from './cora-bank-rail.js';
import { BankList } from './cora-bank-list.js';
import { BankDock } from './cora-bank-dock.js';
import {
  compileBank,
  hashStr,
  highlight,
  publishBankEffect,
} from './question-bank-compile.js';
import { simulatorEnabled } from './question-bank-flags.js';
import { SimulatePanel } from './simulate-panel.js';
import { CompileDrawer } from './compile-drawer.js';
import { CaseTabs } from '../../components/collections/cora-case-tabs.js';

/** @typedef {import('./bank-slice.js').QuestionBankRouteState} QuestionBankRouteState */
/** @typedef {{ chrome: import('../../core/chrome-state.js').ChromeState, routes: { questionBank: QuestionBankRouteState } }} QuestionBankState */

/** @param {QuestionBankState} state */
export function selectQuestionBankState(state) {
  return state.routes.questionBank;
}

/** @param {(action: any) => any} dispatch @param {string} message */
function toast(dispatch, message) {
  dispatch({ type: 'toast/changed', message });
  const later = /** @type {any} */ (globalThis).setTimeout;
  if (typeof later === 'function') {
    later(() => dispatch({ type: 'toast/changed', message: '' }), 2400);
  }
}

/**
 * @param {QuestionBankRouteState} route
 * @param {(action: any) => any} dispatch
 * @param {boolean} dirty
 */
function caseTabsPropsFor(route, dispatch, dirty) {
  return {
    types: route.cases,
    active: route.activeSlug,
    dirty,
    onSelect: (/** @type {string} */ slug) =>
      dispatch({ type: 'bank/selected', slug }),
    onRevert: () => {
      if (!dirty) return toast(dispatch, 'Nothing to revert');
      const ok = /** @type {any} */ (globalThis).confirm?.(
        'Discard all uncommitted edits and return to the last synced state?'
      );
      if (!ok) return;
      dispatch({ type: 'bank/reverted' });
      toast(dispatch, 'Reverted to baseline');
    },
    onCompile: () => dispatch({ type: 'drawer/changed', open: true }),
  };
}

/**
 * @param {QuestionBankRouteState} route
 * @param {(action: any) => any} dispatch
 * @param {() => void} publish
 * @param {{ added: number, changed: number, deprecated: number }} diff
 */
function compileDrawerPropsFor(route, dispatch, publish, diff) {
  return {
    open: route.drawerOpen,
    bank: currentBank(route),
    diff,
    compile: compileBank,
    highlight,
    hashCode: hashStr,
    simulatePanel: (/** @type {any} */ bank) =>
      simulatorEnabled()
        ? SimulatePanel(
            baselineBank(route),
            bank,
            route.sampleCases[bank.slug] ?? []
          )
        : null,
    onClose: () => dispatch({ type: 'drawer/changed', open: false }),
    onCopied: () => toast(dispatch, 'Bank JSON copied to clipboard'),
    onSubmit: publish,
  };
}

/**
 * @param {QuestionBankState} state
 * @param {{ dispatch: (action: any) => any, memo?: (key: PropertyKey, deps: readonly unknown[], render: () => HTMLElement) => HTMLElement, publish?: () => void }} tools
 * @returns {HTMLElement}
 */
export function bankEditorView(state, tools) {
  const route = selectQuestionBankState(state);
  const bank = currentBank(route);
  const dirty = isDirty(route);
  const diff = diffCounts(route);

  return h(
    'div',
    { className: 'cora-bank-editor' },
    h(
      'header',
      { className: 'masthead' },
      h(
        'div',
        {},
        h(
          'div',
          { className: 'eyebrow' },
          'Case Type Owner ',
          h('span', { className: 'dot' }),
          ' Question Bank'
        ),
        h('h1', {}, 'Question ', h('em', {}, 'Bank'))
      ),
      h(
        'div',
        { className: 'masthead-meta' },
        'Session: ',
        h('strong', {}, 'local · uncommitted'),
        h('br'),
        'Schema: ',
        h('strong', {}, 'questions.v3')
      )
    ),
    CaseTabs(caseTabsPropsFor(route, tools.dispatch, dirty)),
    h(
      'main',
      { className: 'bank-main' },
      ...BankRail({
        bank,
        filters: route.filters,
        railOpen: route.railOpen,
        setFilters: (patch) =>
          tools.dispatch({ type: 'filters/changed', patch }),
        moveCategory: (name, direction) =>
          tools.dispatch({ type: 'category/moved', category: name, direction }),
        moveGroup: (category, name, direction) =>
          tools.dispatch({
            type: 'group/moved',
            category,
            group: name,
            direction,
          }),
        onToggleRail: () =>
          tools.dispatch({ type: 'rail/changed', open: !route.railOpen }),
        onCloseRail: () =>
          tools.dispatch({ type: 'rail/changed', open: false }),
      }),
      BankList({
        bank,
        baselineQuestions: baselineBank(route)?.questions ?? [],
        filters: route.filters,
        dirty,
        conditionalQuestionIds: route.conditionalQuestionIds,
        dispatch: tools.dispatch,
        memo: tools.memo,
        addQuestion: () => tools.dispatch({ type: 'question/added' }),
      })
    ),
    BankDock({
      bank,
      diffCounts: diff,
      openDrawer: () => tools.dispatch({ type: 'drawer/changed', open: true }),
    }),
    ...CompileDrawer(
      compileDrawerPropsFor(
        route,
        tools.dispatch,
        tools.publish ?? (() => tools.dispatch({ type: 'publish/requested' })),
        diff
      )
    ),
    h(
      'div',
      { className: 'toast' + (route.toastMsg ? ' show' : '') },
      h('span', { className: 'dot' }),
      h('span', {}, route.toastMsg)
    )
  );
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../../setup/register-routes.js').AppContext} context
 */
export function createRouteSlice(_params, context) {
  let latestRoute = initialQuestionBankState();
  // The mount lifetime comes from the adapter's tools, not a page-local latch (#517).
  /** @type {any|null} */
  let effectTools = null;
  const publish = async () => {
    const tools = effectTools;
    if (!tools || !tools.isActive()) return;
    tools.dispatch({ type: 'publish/requested' });
    try {
      const write =
        context.writeQuestionBankArtifacts ??
        (async () => {
          // The browser workbench prepares exact artifacts; opening the PR is
          // deliberately a human-controlled handoff when no writer is injected.
        });
      // The supported offline cycle leaves the writer undefined and merges this
      // candidate entry into the existing append-only manifest before deployment.
      // Any future runtime writer must source that existing manifest here first.
      const artifacts = await publishBankEffect(
        currentBank(latestRoute),
        null,
        write
      );
      if (tools.isActive())
        tools.dispatch({ type: 'publish/succeeded', artifacts });
    } catch (error) {
      if (tools.isActive()) {
        tools.dispatch({
          type: 'publish/failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
  return {
    initialState: {
      chrome: context.chrome,
      routes: { questionBank: initialQuestionBankState() },
    },
    reducer(/** @type {QuestionBankState} */ state, /** @type {any} */ action) {
      const current = selectQuestionBankState(state);
      const next = questionBankReducer(current, action);
      if (next === current) return state;
      return { ...state, routes: { questionBank: next } };
    },
    view(/** @type {QuestionBankState} */ state, /** @type {any} */ tools) {
      latestRoute = selectQuestionBankState(state);
      return bankEditorView(state, { ...tools, publish });
    },
    start(/** @type {any} */ tools) {
      effectTools = tools;
      context.appEl.classList.add('cora-fullbleed');
      const key = (/** @type {any} */ event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault?.();
          tools.dispatch({ type: 'drawer/changed', open: true });
        }
        if (event.key === 'Escape') {
          tools.dispatch({ type: 'drawer/changed', open: false });
          tools.dispatch({ type: 'rail/changed', open: false });
        }
      };
      tools.listen(document, 'keydown', key);
      if (simulatorEnabled()) {
        const loadSamples =
          context.loadQuestionBankSamples ??
          (() =>
            import('./question-bank-samples.js').then((module) =>
              module.loadSampleCases(context.client, context.caseSources)
            ));
        void loadSamples().then((loaded) => {
          if (!loaded || typeof loaded !== 'object') return;
          for (const [slug, cases] of Object.entries(loaded)) {
            tools.dispatch({ type: 'samples/loaded', slug, cases });
          }
        });
      }
      return () => {
        effectTools = null;
        context.appEl.classList.remove('cora-fullbleed');
      };
    },
  };
}
