// @ts-check
// Dev-only performance gate for Project Palimpsest (CORE-5). The route module
// owns state transitions and pure Question Group/card views; the standard
// store-route adapter owns the store, memo cache, morph reconciler, and teardown.

import { loadBank } from '../../case-types/load-bank.js';
import { evaluate } from '../evaluators/applicability-evaluator.js';
import { h } from '../lib/html.js';

/** @typedef {{ value: string | string[] }} PerformanceAnswer */
/** @typedef {{ id: string, text: string, questionGroup: string, responseType: string, options?: string[], showWhen?: Record<string, unknown>, deprecated: boolean }} PerformanceQuestion */
/** @typedef {{ questionCount: number, questionGroupCount: number, questionsPerGroup: number, textAnswerQuestionId: string, fanOutGateQuestionId: string, fanOutQuestionCount: number }} PerformanceProfile */
/** @typedef {{ slug: string, label: string, questions: PerformanceQuestion[], performanceProfile: PerformanceProfile }} PerformanceBank */
/** @typedef {{ scenario: string, startedAt: number, changedQuestionCount: number } | null} PendingMeasurement */
/** @typedef {{ bank: PerformanceBank, answers: Record<string, PerformanceAnswer>, applicable: Set<string>, dirtyGroupIds: string[], pendingMeasurement: PendingMeasurement }} PerformanceState */
/** @typedef {{ durationMs: number, changedQuestionCount: number, groupCount: number }} PerformanceSample */

export const PERFORMANCE_BANK = /** @type {PerformanceBank} */ (
  await loadBank('./banks/performance-500.txt')
);

/** @param {PerformanceBank} bank @returns {PerformanceState} */
export function createPerformanceState(bank) {
  return {
    bank,
    answers: {},
    applicable: evaluate(/** @type {any} */ (bank.questions), {}),
    dirtyGroupIds: [...new Set(bank.questions.map((q) => q.questionGroup))],
    pendingMeasurement: null,
  };
}

/**
 * Apply one Answer change and identify only the Question Groups whose rendered
 * cards can differ: the edited card's group plus groups containing definitions
 * whose applicability changed.
 *
 * @param {PerformanceState} state
 * @param {{ type: string, questionId?: string, value?: string, scenario?: string, startedAt?: number }} action
 * @returns {PerformanceState}
 */
export function reducePerformanceState(state, action) {
  if (action.type !== 'answer/changed' || !action.questionId) return state;
  const question = state.bank.questions.find((q) => q.id === action.questionId);
  if (!question) return state;

  const answers = {
    ...state.answers,
    [action.questionId]: { value: action.value ?? '' },
  };
  const applicable = evaluate(
    /** @type {any} */ (state.bank.questions),
    /** @type {any} */ (answers)
  );
  const dirty = new Set([question.questionGroup]);
  let changedQuestionCount = 1;
  for (const candidate of state.bank.questions) {
    if (state.applicable.has(candidate.id) !== applicable.has(candidate.id)) {
      dirty.add(candidate.questionGroup);
      changedQuestionCount += 1;
    }
  }

  return {
    ...state,
    answers,
    applicable,
    dirtyGroupIds: [...dirty],
    pendingMeasurement:
      action.scenario && action.startedAt != null
        ? {
            scenario: action.scenario,
            startedAt: action.startedAt,
            changedQuestionCount,
          }
        : null,
  };
}

/** @param {PerformanceBank} bank @returns {Map<string, PerformanceQuestion[]>} */
function questionsByGroup(bank) {
  /** @type {Map<string, PerformanceQuestion[]>} */
  const groups = new Map();
  for (const question of bank.questions) {
    const group = groups.get(question.questionGroup) ?? [];
    group.push(question);
    groups.set(question.questionGroup, group);
  }
  return groups;
}

/**
 * @param {PerformanceQuestion} question
 * @param {PerformanceAnswer | undefined} answer
 * @param {(action: any) => any} dispatch
 * @returns {HTMLElement}
 */
function questionCard(question, answer, dispatch) {
  const value = typeof answer?.value === 'string' ? answer.value : '';
  let control;
  if (question.responseType === 'text') {
    control = h('input', {
      key: `${question.id}-control`,
      type: 'text',
      'aria-label': question.text,
      'data-question-id': question.id,
      value,
      onkeydown: (/** @type {any} */ event) => {
        event.target.dataset.performanceStartedAt = String(performance.now());
      },
      oninput: (/** @type {any} */ event) =>
        dispatch({
          type: 'answer/changed',
          questionId: question.id,
          value: event.target.value,
          scenario: 'steady-state-keystroke',
          startedAt: Number(event.target.dataset.performanceStartedAt),
        }),
    });
  } else {
    const options =
      question.id === PERFORMANCE_BANK.performanceProfile.fanOutGateQuestionId
        ? ['No', 'Yes']
        : (question.options ?? ['Yes', 'No', 'N/A']);
    control = h(
      'select',
      {
        key: `${question.id}-control`,
        'aria-label': question.text,
        'data-question-id': question.id,
        value,
        onchange: (/** @type {any} */ event) =>
          dispatch({
            type: 'answer/changed',
            questionId: question.id,
            value: event.target.value,
            scenario:
              question.id ===
              PERFORMANCE_BANK.performanceProfile.fanOutGateQuestionId
                ? 'fan-out-dispatch'
                : undefined,
            startedAt: performance.now(),
          }),
      },
      h('option', { value: '' }, 'Not answered'),
      ...options.map((option) => h('option', { value: option }, option))
    );
  }

  return h(
    'article',
    {
      key: question.id,
      class: 'cora-performance-card',
      'data-question-card-id': question.id,
    },
    h('label', {}, question.text),
    control
  );
}

/**
 * @param {string} groupId
 * @param {PerformanceQuestion[]} questions
 * @param {PerformanceState} state
 * @param {{ dispatch: (action: any) => any, memo: any }} tools
 * @returns {HTMLElement}
 */
function groupView(groupId, questions, state, tools) {
  return h(
    'div',
    { key: `${groupId}-cards`, class: 'cora-performance-group__cards' },
    h('h2', {}, groupId),
    ...questions.map((question) => {
      const applicable = state.applicable.has(question.id);
      const answer = state.answers[question.id];
      return tools.memo(question.id, [applicable, answer?.value], () =>
        applicable ? questionCard(question, answer, tools.dispatch) : null
      );
    })
  );
}

/** @param {PerformanceBank} bank @returns {HTMLElement} */
function shellView(bank) {
  const groupIds = [...questionsByGroup(bank).keys()];
  return h(
    'section',
    { class: 'cora-performance-harness' },
    h('h1', {}, 'Palimpsest 500-question performance gate'),
    h(
      'p',
      { class: 'cora-performance-harness__summary' },
      `${bank.questions.length} Question Definitions · ${groupIds.length} Question Groups`
    ),
    h('output', {
      class: 'cora-performance-harness__results',
      'aria-live': 'polite',
    }),
    ...groupIds.map((groupId) =>
      h('section', {
        key: groupId,
        class: 'cora-performance-group',
        'data-group-id': groupId,
      })
    )
  );
}

/** @param {PerformanceSample[]} samples */
function summariseSamples(samples) {
  const durations = samples
    .map((sample) => sample.durationMs)
    .sort((a, b) => a - b);
  const percentile = (/** @type {number} */ value) =>
    durations.length === 0
      ? null
      : durations[Math.max(0, Math.ceil((value / 100) * durations.length) - 1)];
  return {
    sampleCount: samples.length,
    p50Ms: percentile(50),
    p95Ms: percentile(95),
    maxMs: durations.at(-1) ?? null,
    samples,
  };
}

/**
 * @returns {{
 *   initialState: PerformanceState,
 *   reducer: typeof reducePerformanceState,
 *   render: (container: Element, state: PerformanceState, tools: { dispatch: (action: any) => any, memo: any, morph: (container: Element, tree: any, stats?: any) => any }) => void,
 *   start: (tools: { dispatch: (action: any) => any }) => () => void,
 * }}
 */
export function createRouteSlice() {
  const routeMountStartedAt = performance.now();
  const initialState = createPerformanceState(PERFORMANCE_BANK);
  const groups = questionsByGroup(PERFORMANCE_BANK);
  /** @type {{ initialRouteMount: PerformanceSample[], steadyStateKeystroke: PerformanceSample[], fanOutDispatch: PerformanceSample[] }} */
  const samples = {
    initialRouteMount: [],
    steadyStateKeystroke: [],
    fanOutDispatch: [],
  };
  let mounted = false;
  /** @type {Element | null} */
  let mountedContainer = null;

  /** @param {keyof typeof samples} scenario @param {number} startedAt @param {number} changedQuestionCount @param {number} groupCount */
  function record(scenario, startedAt, changedQuestionCount, groupCount) {
    samples[scenario].push({
      durationMs: performance.now() - startedAt,
      changedQuestionCount,
      groupCount,
    });
  }

  function results() {
    return {
      capturedAt: new Date().toISOString(),
      userAgent:
        /** @type {any} */ (globalThis).navigator?.userAgent ?? 'unknown',
      timingBoundary:
        'event handler start through dispatch, store update, and dirty-group morph completion',
      profile: PERFORMANCE_BANK.performanceProfile,
      scenarios: {
        initialRouteMount: summariseSamples(samples.initialRouteMount),
        steadyStateKeystroke: summariseSamples(samples.steadyStateKeystroke),
        fanOutDispatch: summariseSamples(samples.fanOutDispatch),
      },
    };
  }

  return {
    initialState,
    reducer: reducePerformanceState,
    render(container, state, tools) {
      const initialMountStartedAt = mounted ? null : routeMountStartedAt;
      if (!mounted) {
        tools.morph(container, shellView(state.bank));
        mountedContainer = container;
        mounted = true;
      }
      for (const groupId of state.dirtyGroupIds) {
        const groupContainer = container.querySelector(
          `[data-group-id="${groupId}"]`
        );
        if (!groupContainer) continue;
        tools.morph(
          groupContainer,
          groupView(groupId, groups.get(groupId) ?? [], state, tools)
        );
      }
      if (initialMountStartedAt != null) {
        record(
          'initialRouteMount',
          initialMountStartedAt,
          state.bank.questions.length,
          groups.size
        );
      }
      if (state.pendingMeasurement) {
        const scenario =
          state.pendingMeasurement.scenario === 'steady-state-keystroke'
            ? 'steadyStateKeystroke'
            : 'fanOutDispatch';
        record(
          scenario,
          state.pendingMeasurement.startedAt,
          state.pendingMeasurement.changedQuestionCount,
          state.dirtyGroupIds.length
        );
      }
    },
    start() {
      const runner = {
        results,
        async run({ steadyStateIterations = 100, fanOutIterations = 20 } = {}) {
          if (!mountedContainer)
            throw new Error('Performance harness is not mounted');
          const textInput = /** @type {any} */ (
            mountedContainer.querySelector(
              `[data-question-id="${PERFORMANCE_BANK.performanceProfile.textAnswerQuestionId}"]`
            )
          );
          const gateInput = /** @type {any} */ (
            mountedContainer.querySelector(
              `[data-question-id="${PERFORMANCE_BANK.performanceProfile.fanOutGateQuestionId}"]`
            )
          );
          if (!textInput || !gateInput) {
            throw new Error('Performance harness controls are unavailable');
          }

          // Warm the text path before recording the steady-state, memoised run.
          textInput.dispatchEvent(new CustomEvent('keydown'));
          textInput.value = 'warm';
          textInput.dispatchEvent(new CustomEvent('input'));
          await Promise.resolve();
          samples.steadyStateKeystroke.length = 0;

          for (let index = 0; index < steadyStateIterations; index += 1) {
            textInput.dispatchEvent(new CustomEvent('keydown'));
            textInput.value = `${textInput.value}${index % 10}`;
            textInput.dispatchEvent(new CustomEvent('input'));
            await Promise.resolve();
          }

          for (let index = 0; index < fanOutIterations; index += 1) {
            gateInput.value = index % 2 === 0 ? 'Yes' : 'No';
            gateInput.dispatchEvent(new CustomEvent('change'));
            await Promise.resolve();
          }

          const captured = results();
          const output = mountedContainer.querySelector(
            '.cora-performance-harness__results'
          );
          if (output) {
            output.textContent = JSON.stringify(captured, null, 2);
            output.setAttribute('data-status', 'complete');
          }
          return captured;
        },
      };
      /** @type {any} */ (globalThis).__coraPerformanceGate = runner;
      const autoRun = new URLSearchParams(
        /** @type {any} */ (globalThis).location?.search ?? ''
      ).get('perf');
      if (autoRun === 'auto') {
        queueMicrotask(() => {
          runner.run().catch((error) => {
            const output = mountedContainer?.querySelector(
              '.cora-performance-harness__results'
            );
            if (output) {
              output.textContent = String(error);
              output.setAttribute('data-status', 'failed');
            }
          });
        });
      }
      return () => {
        if (/** @type {any} */ (globalThis).__coraPerformanceGate === runner) {
          delete (/** @type {any} */ (globalThis).__coraPerformanceGate);
        }
      };
    },
  };
}
