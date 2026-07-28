// @ts-check
import { setRoute } from '../../core/route-state.js';
import { h } from '../../lib/html.js';
import { Toast } from '../../components/base/cora-toast.js';
import { ignoreAbortError } from '../../lib/abort.js';
import { withAbortSignal } from '../../services/abortable-client.js';
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
import { loadQuestionBanks } from './question-bank-source.js';

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
    onPublish: publish,
  };
}

/** @returns {HTMLElement} */
function masthead() {
  return h(
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
  );
}

/**
 * The shell the editor shows before any bank has arrived, and when none can be
 * loaded at all (#521).
 * @param {string} heading
 * @param {string} detail
 * @param {HTMLElement|null} [action]
 * @returns {HTMLElement}
 */
function bankStatusShell(heading, detail, action = null) {
  return h(
    'div',
    { className: 'cora-bank-editor' },
    masthead(),
    h(
      'main',
      { className: 'bank-main' },
      h(
        'section',
        { className: 'editor' },
        h(
          'div',
          { className: 'empty' },
          // The live region covers the message only. With the Retry control
          // inside it, every label toggle re-announces the whole failure.
          h(
            'div',
            { role: 'status' },
            h('h3', {}, heading),
            h('p', {}, detail)
          ),
          action
        )
      )
    )
  );
}

/** @param {import('./question-bank-source.js').BankLoadFailure[]} failures */
function describeFailures(failures) {
  return failures
    .map((failure) => `${failure.slug} (${failure.message})`)
    .join(', ');
}

/**
 * The control that makes a named failure recoverable in place (#549). Before
 * this, the only way out of a transient blip on one artifact was reloading the
 * page, which re-fetches every bank — including the ones the curator may be
 * part-way through editing.
 *
 * In-flight state is `aria-busy` + `aria-disabled`, not the `disabled`
 * property: a disabled button is removed from the tab order, so a keyboard
 * curator who pressed Retry would have focus dropped to the document mid-retry
 * and have to find their way back. `aria-disabled` announces the same thing and
 * keeps focus. It does not stop the click, so the effect owns the in-flight
 * latch — which it must anyway, since a pointer user can outrun a render.
 * @param {QuestionBankRouteState} route
 * @param {() => void} retry
 * @returns {HTMLElement}
 */
function retryButton(route, retry) {
  return h(
    'button',
    {
      className: 'mini-btn',
      'aria-busy': String(route.retrying),
      'aria-disabled': String(route.retrying),
      onclick: retry,
    },
    route.retrying ? 'Retrying…' : 'Retry'
  );
}

/**
 * @param {QuestionBankState} state
 * @param {{ dispatch: (action: any) => any, memo?: (key: PropertyKey, deps: readonly unknown[], viewFn: () => HTMLElement) => HTMLElement, publish?: () => void, retry?: () => void }} tools
 * @returns {HTMLElement}
 */
export function bankEditorView(state, tools) {
  const route = selectQuestionBankState(state);
  // No retry tool, no control. There is no useful fallback: dispatching
  // `bank/retry-requested` with nothing behind it only sets `retrying`, and the
  // button that set it is the thing that would have cleared it.
  const retry = tools.retry ?? null;
  if (route.loading) {
    return bankStatusShell(
      'Loading Question Banks…',
      'Reading the published bank artifacts.'
    );
  }
  const bank = currentBank(route);
  if (!bank) {
    return bankStatusShell(
      'No Question Bank could be loaded.',
      route.loadError ||
        (route.loadFailures.length
          ? `Failed: ${describeFailures(route.loadFailures)}`
          : 'No Question Bank artifacts are registered for this site.'),
      // Nothing loaded is the case where a full page reload costs the most and
      // the retry is worth the most, so the shell carries it too — including
      // when the loader failed wholesale (`loadError`, no named slugs), where
      // the retry re-runs the whole load. Only a site with no artifacts
      // registered at all gets no control: there is nothing to re-fetch.
      retry && (route.loadFailures.length || route.loadError)
        ? retryButton(route, retry)
        : null
    );
  }
  const dirty = isDirty(route);
  const diff = diffCounts(route);

  return h(
    'div',
    { className: 'cora-bank-editor' },
    masthead(),
    route.loadFailures.length
      ? h(
          'div',
          { className: 'bank-load-warning' },
          // `role="status"` scopes to the message, not the whole banner: the
          // Retry label toggles between renders, and inside the live region
          // that re-announces the entire failure list every time.
          h(
            'span',
            { role: 'status' },
            `Some Question Banks could not be loaded: ${describeFailures(route.loadFailures)}`
          ),
          retry ? retryButton(route, retry) : null
        )
      : null,
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
    Toast({ message: route.toastMsg })
  );
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../../setup/register-routes.js').AppContext} context
 * @param {{ loadBanks?: typeof loadQuestionBanks }} [deps]
 */
export function createRouteSlice(_params, context, deps = {}) {
  const loadBanks = deps.loadBanks ?? loadQuestionBanks;
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
  let retryInFlight = false;
  /**
   * Re-run the load for the failed slugs only (#549), and seat the result
   * through `bank/recovered`, which never overwrites a draft the curator holds.
   *
   * What to retry is read back out of the store — `dispatch()` returns the next
   * state — rather than out of the render-derived snapshot this module keeps
   * for `publish`. Same for the union of already-loaded and recovered banks,
   * which `bank/recovered` builds inside the reducer at dispatch time. Nothing
   * here depends on a render having happened, so nothing here breaks if the
   * store's render scheduling changes.
   *
   * The retry deliberately does not re-fetch the banks that loaded: they are
   * current, and re-reading them is the cost of the full page reload this
   * control exists to replace. The one exception is a load that failed
   * wholesale — no banks, no named slugs, only `loadError` — where there is
   * nothing partial to preserve and the retry re-runs the entire load.
   */
  const retry = async () => {
    const tools = effectTools;
    if (!tools || !tools.isActive() || retryInFlight) return;
    const route = selectQuestionBankState(
      tools.dispatch({ type: 'bank/retry-requested' })
    );
    // The reducer refuses when there is nothing to re-fetch.
    if (!route.retrying) return;
    const slugs = route.loadFailures.map((failure) => failure.slug);
    retryInFlight = true;
    try {
      const loaded = await loadBanks(
        undefined,
        slugs.length ? slugs : undefined
      );
      if (!tools.isActive()) return;
      tools.dispatch({
        type: 'bank/recovered',
        banks: loaded.banks,
        failures: loaded.failures,
      });
    } catch (error) {
      console.error('[CORA] question bank retry failed', error);
      const message = error instanceof Error ? error.message : String(error);
      if (!tools.isActive()) return;
      if (slugs.length) {
        // loadQuestionBanks contains per-bank failures itself, so this is the
        // loader failing wholesale. Keep the slugs named rather than dropping
        // them: an empty failure list would read as "all recovered".
        tools.dispatch({
          type: 'bank/recovered',
          banks: {},
          failures: slugs.map((slug) => ({ slug, message })),
        });
      } else {
        // The whole-load retry failed the same way the initial load did, so it
        // lands back where the initial failure did — still retryable.
        tools.dispatch({ type: 'bank/load-failed', message });
      }
    } finally {
      retryInFlight = false;
    }
  };
  // Hoisted, not rebuilt per render: an inline arrow changes the button's
  // `onclick` identity every pass, so render() detaches and reattaches the
  // listener on every render.
  const retryHandler = () => void retry();
  return {
    initialState: {
      chrome: context.chrome,
      routes: { questionBank: initialQuestionBankState() },
    },
    reducer(/** @type {QuestionBankState} */ state, /** @type {any} */ action) {
      const current = selectQuestionBankState(state);
      const next = questionBankReducer(current, action);
      if (next === current) return state;
      return setRoute(state, 'questionBank', next);
    },
    view(/** @type {QuestionBankState} */ state, /** @type {any} */ tools) {
      latestRoute = selectQuestionBankState(state);
      return bankEditorView(state, { ...tools, publish, retry: retryHandler });
    },
    start(/** @type {any} */ tools) {
      effectTools = tools;
      context.appEl.classList.add('cora-fullbleed');
      // The bank artifacts are fetched here, not at module evaluation, so
      // importing this page performs no I/O (#521).
      void loadBanks().then(
        ({ banks, failures }) => {
          if (!tools.isActive()) return;
          tools.dispatch({ type: 'bank/loaded', banks, failures });
        },
        (error) => {
          console.error('[CORA] question bank load failed', error);
          if (!tools.isActive()) return;
          tools.dispatch({
            type: 'bank/load-failed',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      );
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
        // The sample fan-out is a read across every Case source, so it carries
        // the mount lifetime (#567). `loadSampleCases` already tolerates a
        // per-source failure, which an abort now arrives as: navigating away
        // leaves the drawer's empty state rather than the editor failing.
        const readClient = withAbortSignal(context.client, tools.signal);
        const loadSamples =
          context.loadQuestionBankSamples ??
          (() =>
            import('./question-bank-samples.js').then((module) =>
              module.loadSampleCases(readClient, context.caseSources)
            ));
        void loadSamples()
          .then((loaded) => {
            if (!tools.isActive()) return;
            if (!loaded || typeof loaded !== 'object') return;
            for (const [slug, cases] of Object.entries(loaded)) {
              tools.dispatch({ type: 'samples/loaded', slug, cases });
            }
          })
          .catch(ignoreAbortError);
      }
      return () => {
        effectTools = null;
        context.appEl.classList.remove('cora-fullbleed');
      };
    },
  };
}
