// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import {
  bindQuestionBankStore,
  cases,
  activeSlug,
  isDirty as dirtySignal,
  currentBank as currentBankSignal,
  drawerOpen as drawerSignal,
  railOpen as railSignal,
  showToast as showLegacyToast,
} from './question-bank-store.js';
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
import { compileBank, hashStr, highlight } from './question-bank-compile.js';
import { simulatorEnabled } from './question-bank-flags.js';
import { SimulatePanel } from './simulate-panel.js';
import { CompileDrawer } from './compile-drawer.js';
import { moveCategory, moveGroup } from '../../lib/question-order.js';

// BANK-1 keeps the question-card internals behind the temporary adapter.
import '../../components/collections/cora-case-tabs.js';
import './cora-outcome-options-editor.js';
import '../../components/sections/cora-question-card.js';
import '../../components/base/cora-question-labels.js';
import '../../components/sections/cora-wording-editor.js';
import '../../components/base/cora-options-editor.js';
import '../../components/sections/cora-showwhen-editor.js';
import '../../components/sections/cora-showwhen-group.js';
import '../../components/base/cora-showwhen-leaf.js';
import './cora-remediation-actions-editor.js';
import '../../components/base/cora-toast.js';

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
 */
function caseTabsPropsFor(route, dispatch) {
  return {
    cases,
    active: activeSlug,
    dirty: dirtySignal,
    onSelect: (/** @type {string} */ slug) =>
      dispatch({ type: 'bank/selected', slug }),
    onRevert: () => {
      if (!isDirty(route)) return toast(dispatch, 'Nothing to revert');
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
 */
function compileDrawerPropsFor(route, dispatch) {
  return {
    open: route.drawerOpen,
    bank: currentBank(route),
    diff: diffCounts(route),
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
    onSubmit: () => {
      dispatch({ type: 'bank/submitted' });
      toast(dispatch, 'Submitted for review');
    },
  };
}

/**
 * @param {QuestionBankState} state
 * @param {{ dispatch: (action: any) => any, memo?: (key: PropertyKey, deps: readonly unknown[], render: () => HTMLElement) => HTMLElement }} tools
 * @returns {HTMLElement}
 */
export function bankEditorView(state, tools) {
  const route = selectQuestionBankState(state);
  bindQuestionBankStore(() => route, tools.dispatch);
  const bank = currentBank(route);
  const onCommit = (
    /** @type {(banks: QuestionBankRouteState['cases']) => void} */ mutator
  ) => tools.dispatch({ type: 'bank/legacy-committed', mutator });

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
    h('cora-case-tabs', caseTabsPropsFor(route, tools.dispatch)),
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
          onCommit((banks) =>
            moveCategory(banks[route.activeSlug].questions, name, direction)
          ),
        moveGroup: (category, name, direction) =>
          onCommit((banks) =>
            moveGroup(
              banks[route.activeSlug].questions,
              category,
              name,
              direction
            )
          ),
        onToggleRail: () =>
          tools.dispatch({ type: 'rail/changed', open: !route.railOpen }),
        onCloseRail: () =>
          tools.dispatch({ type: 'rail/changed', open: false }),
      }),
      BankList({
        bank,
        baselineQuestions: baselineBank(route)?.questions ?? [],
        filters: route.filters,
        dirty: isDirty(route),
        onCommit,
        memo: tools.memo,
        addQuestion: () => {
          onCommit((banks) => {
            const active = banks[route.activeSlug];
            active.questions.push(
              /** @type {any} */ ({
                id: `q-new-${active.questions.length + 1}`,
                text: 'New question — click to edit',
                questionGroup: 'Uncategorised',
                responseType: 'yes-no-na',
                deprecated: false,
              })
            );
          });
        },
      })
    ),
    BankDock({
      bank,
      diffCounts: diffCounts(route),
      openDrawer: () => tools.dispatch({ type: 'drawer/changed', open: true }),
    }),
    ...CompileDrawer(compileDrawerPropsFor(route, tools.dispatch)),
    h('cora-toast', { message: { get: () => route.toastMsg } })
  );
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../../setup/register-routes.js').AppContext} context
 */
export function createRouteSlice(_params, context) {
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
    view: bankEditorView,
    start(/** @type {any} */ tools) {
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
        void loadSamples();
      }
      return () => context.appEl.classList.remove('cora-fullbleed');
    },
  };
}

// Legacy exports remain only until BANK-2 finishes porting the editor tests.
/** @param {string} slug */
export function selectBank(slug) {
  activeSlug.set(slug);
}
export function revertBank() {
  const state = /** @type {any} */ ({
    cases: cases.get(),
    baseline: awaitBaseline().get(),
  });
  if (!dirtySignal.get()) return showLegacyToast('Nothing to revert');
  if (
    !(
      /** @type {any} */ (globalThis).confirm?.(
        'Discard all uncommitted edits and return to the last synced state?'
      )
    )
  )
    return;
  cases.set(structuredClone(state.baseline));
  showLegacyToast('Reverted to baseline');
}
function awaitBaseline() {
  return /** @type {any} */ (legacyBaseline);
}
import { baseline as legacyBaseline } from './question-bank-store.js';
export function submitBankForReview() {
  legacyBaseline.set(structuredClone(cases.get()));
  drawerSignal.set(false);
  showLegacyToast('Submitted for review');
}
export function caseTabsProps() {
  return {
    cases,
    active: activeSlug,
    dirty: dirtySignal,
    onSelect: selectBank,
    onRevert: revertBank,
    onCompile: () => drawerSignal.set(true),
  };
}
export function compileDrawerProps() {
  const route = /** @type {QuestionBankRouteState} */ ({
    cases: cases.get(),
    baseline: legacyBaseline.get(),
    activeSlug: activeSlug.get(),
    filters: /** @type {any} */ ({}),
    drawerOpen: drawerSignal.get(),
    railOpen: false,
    toastMsg: '',
    sampleCases: {},
  });
  return compileDrawerPropsFor(route, (action) => {
    if (action.type === 'drawer/changed') drawerSignal.set(action.open);
    if (action.type === 'bank/submitted') submitBankForReview();
    if (action.type === 'toast/changed' && action.message)
      showLegacyToast(action.message);
  });
}
/** @param {{ addEventListener: Function, removeEventListener: Function }} target */
export function bindBankEditorKeys(target) {
  const key = (/** @type {any} */ event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault?.();
      drawerSignal.set(true);
    }
    if (event.key === 'Escape') {
      drawerSignal.set(false);
      railSignal.set(false);
    }
  };
  target.addEventListener('keydown', key);
  return () => target.removeEventListener('keydown', key);
}
export class CORABankEditor extends ShellElement {
  constructor() {
    super();
    /** @type {null | (() => void)} */
    this._key = null;
  }
  connectedCallback() {
    super.connectedCallback();
    this._key = bindBankEditorKeys(document);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._key?.();
    this._key = null;
  }
  render() {
    return bankEditorView(
      {
        chrome: /** @type {any} */ ({}),
        routes: {
          questionBank: {
            ...initialQuestionBankState(),
            cases: cases.get(),
            baseline: legacyBaseline.get(),
            activeSlug: activeSlug.get(),
          },
        },
      },
      { dispatch: () => {} }
    );
  }
}
customElements.define('cora-bank-editor', CORABankEditor);
