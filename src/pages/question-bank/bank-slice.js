// @ts-check
import { questionBanks } from './question-bank-source.js';

/** @typedef {import('./question-bank-source.js').QuestionBank} QuestionBank */
/** @typedef {import('./question-bank-source.js').DraftQuestion} DraftQuestion */
/** @typedef {{ category: string|null, questionGroup: string|null, showDeprecated: boolean, conditionalOnly: boolean }} Filters */

const initialBanks = /** @type {Record<string, QuestionBank>} */ (
  structuredClone(questionBanks)
);
const defaultSlug = Object.keys(initialBanks)[0];

/**
 * @typedef {Object} QuestionBankRouteState
 * @property {Record<string, QuestionBank>} cases
 * @property {Record<string, QuestionBank>} baseline
 * @property {string} activeSlug
 * @property {Filters} filters
 * @property {boolean} drawerOpen
 * @property {boolean} railOpen
 * @property {string} toastMsg
 * @property {Record<string, import('./question-bank-simulate.js').SampleCase[]>} sampleCases
 */

/** @returns {QuestionBankRouteState} */
export function initialQuestionBankState() {
  return {
    cases: structuredClone(initialBanks),
    baseline: structuredClone(initialBanks),
    activeSlug: defaultSlug,
    filters: {
      category: null,
      questionGroup: null,
      showDeprecated: true,
      conditionalOnly: false,
    },
    drawerOpen: false,
    railOpen: false,
    toastMsg: '',
    sampleCases: {},
  };
}

/** @param {QuestionBankRouteState} state */
export function currentBank(state) {
  return state.cases[state.activeSlug];
}

/** @param {QuestionBankRouteState} state */
export function baselineBank(state) {
  return state.baseline[state.activeSlug];
}

/** @param {QuestionBankRouteState} state */
export function isDirty(state) {
  return JSON.stringify(state.cases) !== JSON.stringify(state.baseline);
}

/** @param {QuestionBankRouteState} state */
export function diffCounts(state) {
  let added = 0;
  let changed = 0;
  let deprecated = 0;
  for (const slug in state.cases) {
    /** @type {Record<string, DraftQuestion>} */
    const baseById = Object.fromEntries(
      (state.baseline[slug]?.questions ?? []).map((question) => [
        question.id,
        question,
      ])
    );
    for (const question of state.cases[slug].questions) {
      const before = baseById[question.id];
      if (!before) added += 1;
      else if (!before.deprecated && question.deprecated) deprecated += 1;
      else if (JSON.stringify(before) !== JSON.stringify(question))
        changed += 1;
    }
  }
  return { added, changed, deprecated };
}

/**
 * @param {QuestionBankRouteState} state
 * @param {any} action
 * @returns {QuestionBankRouteState}
 */
export function questionBankReducer(state, action) {
  if (action.type === 'question/deprecation-toggled') {
    const cases = structuredClone(state.cases);
    const question = cases[state.activeSlug].questions.find(
      (candidate) => candidate.id === action.questionId
    );
    if (!question) return state;
    question.deprecated = !question.deprecated;
    return { ...state, cases };
  }
  if (action.type === 'bank/selected') {
    return {
      ...state,
      activeSlug: action.slug,
      filters: { ...state.filters, category: null, questionGroup: null },
    };
  }
  if (action.type === 'filters/changed') {
    return { ...state, filters: { ...state.filters, ...action.patch } };
  }
  if (action.type === 'drawer/changed') {
    return { ...state, drawerOpen: Boolean(action.open) };
  }
  if (action.type === 'rail/changed') {
    return { ...state, railOpen: Boolean(action.open) };
  }
  if (action.type === 'samples/loaded') {
    return {
      ...state,
      sampleCases: { ...state.sampleCases, [action.slug]: action.cases },
    };
  }
  if (action.type === 'toast/changed') {
    return { ...state, toastMsg: action.message };
  }
  if (action.type === 'bank/reverted') {
    return { ...state, cases: structuredClone(state.baseline) };
  }
  if (action.type === 'bank/submitted') {
    return {
      ...state,
      baseline: structuredClone(state.cases),
      drawerOpen: false,
    };
  }
  // BANK-1 compatibility seam. BANK-2 replaces old editor mutation sinks with
  // explicit actions and removes this adapter action.
  if (action.type === 'bank/legacy-committed') {
    // Old editors close over question/option objects rather than locating them
    // from the reducer input. Apply against the live draft, then immediately
    // snapshot it into the next route state. BANK-2 removes this compatibility
    // branch together with those mutation sinks.
    action.mutator(state.cases);
    return { ...state, cases: structuredClone(state.cases) };
  }
  if (action.type === 'state/replaced') return action.state;
  return state;
}
