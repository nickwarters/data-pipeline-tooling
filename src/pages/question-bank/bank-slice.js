// @ts-check
import {
  moveCategory,
  moveGroup,
  moveQuestion,
  moveQuestionWithinGroup,
} from '../../lib/question-order.js';
import { parseShowWhen, serializeTree } from '../../lib/showwhen-tree.js';
import { normaliseConfiguredActions } from '../../evaluators/configured-outcome.js';

/** @typedef {import('./question-bank-source.js').QuestionBank} QuestionBank */
/** @typedef {import('./question-bank-source.js').BankLoadFailure} BankLoadFailure */
/** @typedef {import('./question-bank-source.js').DraftQuestion} DraftQuestion */
/** @typedef {{ category: string|null, questionGroup: string|null, showDeprecated: boolean, conditionalOnly: boolean }} Filters */

/**
 * @typedef {Object} QuestionBankRouteState
 * @property {Record<string, QuestionBank>} cases
 * @property {Record<string, QuestionBank>} baseline
 * @property {string} activeSlug
 * @property {boolean} loading
 * @property {string} loadError
 * @property {BankLoadFailure[]} loadFailures
 * @property {boolean} retrying
 * @property {Filters} filters
 * @property {boolean} drawerOpen
 * @property {boolean} railOpen
 * @property {string} toastMsg
 * @property {Record<string, import('./question-bank-simulate.js').SampleCase[]>} sampleCases
 * @property {string[]} conditionalQuestionIds
 * @property {'idle'|'publishing'|'succeeded'|'failed'} publishStatus
 * @property {ReturnType<import('./question-bank-compile.js').buildPublishArtifacts>|null} publishArtifacts
 * @property {string} publishError
 */

/**
 * The banks are absent until `start()`'s load resolves — importing this module
 * performs no I/O.
 * @returns {QuestionBankRouteState}
 */
export function initialQuestionBankState() {
  return {
    cases: {},
    baseline: {},
    activeSlug: '',
    loading: true,
    loadError: '',
    loadFailures: [],
    retrying: false,
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
    conditionalQuestionIds: [],
    publishStatus: 'idle',
    publishArtifacts: null,
    publishError: '',
  };
}

/**
 * Keep the selection only while the loaded banks still carry it, and otherwise
 * fall back to the first available slug — otherwise a later load with a
 * different slug set leaves `activeSlug` naming a bank that is gone, and the
 * editor renders its no-bank empty state after a *successful* load.
 *
 * The membership test is `Object.hasOwn`, not a truthiness check on
 * `banks[activeSlug]`: inherited keys (`constructor`, `toString`) read as
 * present through the prototype chain and would survive a load that does not
 * carry them — exactly the dangling selection this guard removes.
 *
 * @param {string} activeSlug
 * @param {Record<string, QuestionBank>} banks
 * @returns {string}
 */
function selectSlug(activeSlug, banks) {
  return Object.hasOwn(banks, activeSlug)
    ? activeSlug
    : (Object.keys(banks)[0] ?? '');
}

/**
 * Whether the curator holds a local edit for `slug`: a draft that exists as an
 * own key of `cases` and differs from the baseline it was seated against. A
 * draft carried through an earlier partial refresh has no baseline left, and
 * counts as edited — it is unsaved work either way.
 *
 * Both lookups are own-property lookups for the reason spelled out on
 * {@link selectSlug}.
 *
 * @param {QuestionBankRouteState} state
 * @param {string} slug
 * @returns {boolean}
 */
function isEdited(state, slug) {
  if (!Object.hasOwn(state.cases, slug)) return false;
  const baseline = Object.hasOwn(state.baseline, slug)
    ? state.baseline[slug]
    : undefined;
  return JSON.stringify(state.cases[slug]) !== JSON.stringify(baseline);
}

/**
 * Seat the banks from the **initial** load: both the curator's draft (`cases`)
 * and what it is diffed against (`baseline`) come from the loaded artifacts.
 * A later load must use {@link banksRefreshed} instead — this one overwrites
 * the draft.
 *
 * `cases` and `baseline` are separately cloned on purpose: the editor diffs
 * draft against baseline, and sharing one reference would make every diff —
 * and the impact simulation — silently empty.
 *
 * @param {QuestionBankRouteState} state
 * @param {Record<string, QuestionBank>} banks
 * @param {BankLoadFailure[]} [failures]
 * @returns {QuestionBankRouteState}
 */
export function banksLoaded(state, banks, failures = []) {
  return {
    ...state,
    cases: structuredClone(banks),
    baseline: structuredClone(banks),
    activeSlug: selectSlug(state.activeSlug, banks),
    loading: false,
    loadError: '',
    loadFailures: failures,
  };
}

/**
 * Seat the banks from a **later** load — a retry of a failed artifact,
 * or a refresh after publishing. The freshly loaded artifacts always become the
 * new `baseline`; they replace a bank's draft only where the curator has no
 * local edit for that slug.
 *
 * **Conflict behaviour: when a bank has both a curator edit and a
 * changed baseline, the draft wins and the upstream change is not applied.**
 * This is deliberate, and the reason is asymmetry of harm: a draft is unsaved,
 * curator-authored work that exists nowhere else, so discarding it is
 * unrecoverable data loss, whereas a superseded baseline can be reloaded.
 *
 * Be clear about what that costs, because it is not free. The moved baseline
 * is currently **indistinguishable from the curator's own edits**: `diffCounts`
 * folds both into one `changed` count per question, so an upstream change to a
 * question the curator also touched renders as if the curator had reverted it,
 * and nothing anywhere names the bank whose baseline moved underneath them.
 * Recovery is soft too — `bank/reverted` recovers the baseline only by
 * discarding the draft wholesale, and a remount dispatches `bank/loaded`, which
 * overwrites the draft anyway. We do NOT raise a conflict prompt here, and
 * there is still no per-bank "baseline moved" signal.
 *
 * **That follow-on was assessed and not built, because neither of this
 * action's two callers can reach the conflict.** A retry (`bank/recovered`)
 * re-fetches only the slugs that FAILED to load, which therefore hold no draft
 * — the curator has never seen them — and it carries the already-loaded
 * artifacts through unchanged from `state.baseline`. The other writer of
 * `baseline` is `publish/succeeded`, which does not go through this action at
 * all: it promotes the curator's own `cases` to `baseline`, so the baseline it
 * moves is by definition the one the draft already matches. The two cannot
 * interleave into a conflict either, because `bank/recovered` reads the union
 * out of `state.baseline` inside this reducer — at dispatch time, after any
 * publish that landed while the retry was in flight — rather than out of
 * anything the effect captured before it awaited.
 *
 * The signal becomes worth building for the first caller that re-fetches a bank
 * the curator may be editing: a post-publish *reload* of the artifacts, or any
 * periodic refresh. Neither exists yet. Whoever adds one owns the signal.
 *
 * The loaded slug set is authoritative for the baseline and the selection: a
 * slug the refresh does not carry leaves `baseline`, and `activeSlug` reselects
 * rather than dangling. It is NOT authoritative for the draft. A refresh's
 * `banks` may be a partial set, so an omitted slug that carries a curator edit
 * keeps its draft in `cases` (with no baseline left, which `diffCounts`
 * tolerates and reads as wholly added). Dropping it would be the same silent,
 * unrecoverable data loss this action exists to prevent. An omitted slug with
 * no local edit is dropped.
 *
 * Because that drop is real, the retry does not hand this action its
 * fetched subset: `bank/recovered` unions it with the banks already loaded,
 * since both are current. Passing the subset alone would drop every unedited
 * bank from `cases` and every bank from `baseline` — a curator retrying one
 * artifact would watch the others disappear.
 *
 * `cases` and `baseline` never share a reference — each retained or carried
 * bank keeps its own draft object, and each replaced one is cloned separately
 * from the baseline clone.
 *
 * @param {QuestionBankRouteState} state
 * @param {Record<string, QuestionBank>} banks
 * @param {BankLoadFailure[]} [failures]
 * @returns {QuestionBankRouteState}
 */
export function banksRefreshed(state, banks, failures = []) {
  /** @type {Record<string, QuestionBank>} */
  const cases = {};
  for (const slug of Object.keys(banks)) {
    cases[slug] = isEdited(state, slug)
      ? state.cases[slug]
      : structuredClone(banks[slug]);
  }
  for (const slug of Object.keys(state.cases)) {
    if (!Object.hasOwn(banks, slug) && isEdited(state, slug)) {
      cases[slug] = state.cases[slug];
    }
  }
  return {
    ...state,
    cases,
    baseline: structuredClone(banks),
    activeSlug: selectSlug(state.activeSlug, banks),
    loading: false,
    loadError: '',
    loadFailures: failures,
    retrying: false,
  };
}

/**
 * Seat the result of a retry: the artifacts it recovered, unioned with the
 * ones that were already loaded.
 *
 * The union is built **here**, from `state.baseline` at dispatch time, and that
 * placement is the whole point of this function existing rather than the effect
 * spreading a captured snapshot into `bank/refreshed`. An effect can only hold
 * state it read before it awaited, and `publish/succeeded` writes `baseline`
 * too. A publish landing during an in-flight retry would then be silently
 * rolled back — `cases` and `baseline` both reverting to the pre-publish
 * artifact while `publishStatus` still read `'succeeded'` and `isDirty` read
 * false, which is exactly the invisible data loss this guards against.
 * Reading the union in the reducer makes that unreachable by construction
 * instead of by an undocumented render-ordering invariant.
 *
 * The base is `baseline`, never `cases`: `cases` holds the curator's draft, and
 * unioning from it would promote that draft into the new baseline, zeroing the
 * diff and reporting "no changes" to the impact simulation.
 *
 * @param {QuestionBankRouteState} state
 * @param {Record<string, QuestionBank>} banks the freshly recovered artifacts
 * @param {BankLoadFailure[]} [failures]
 * @returns {QuestionBankRouteState}
 */
export function banksRecovered(state, banks, failures = []) {
  return banksRefreshed(state, { ...state.baseline, ...banks }, failures);
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
 * Replace one Question Definition while preserving every untouched question's
 * identity. Card memoisation depends on this narrow immutable update.
 * @param {QuestionBankRouteState} state
 * @param {string} questionId
 * @param {(question: DraftQuestion) => void} update
 */
function updateQuestion(state, questionId, update) {
  const bank = currentBank(state);
  const index = bank.questions.findIndex(
    (question) => question.id === questionId
  );
  if (index < 0) return state;
  const question = structuredClone(bank.questions[index]);
  update(question);
  const questions = bank.questions.slice();
  questions[index] = question;
  return {
    ...state,
    cases: {
      ...state.cases,
      [state.activeSlug]: { ...bank, questions },
    },
  };
}

/** @param {QuestionBankRouteState} state @param {(bank: QuestionBank) => void} update */
function updateBank(state, update) {
  const bank = structuredClone(currentBank(state));
  update(bank);
  return {
    ...state,
    cases: { ...state.cases, [state.activeSlug]: bank },
  };
}

/** @param {any} root @param {number[]} path */
function treeNodeAt(root, path) {
  let node = root;
  for (const index of path) {
    if (node?.type !== 'group') return null;
    node = node.children[index];
  }
  return node ?? null;
}

/** @param {DraftQuestion} question @param {(tree: any) => void} update */
function updateShowwhen(question, update) {
  const tree = parseShowWhen(question.showWhen);
  update(tree);
  const value = serializeTree(tree);
  if (value) question.showWhen = value;
  else delete question.showWhen;
}

/**
 * @param {QuestionBankRouteState} state
 * @param {any} action
 * @returns {QuestionBankRouteState}
 */
export function questionBankReducer(state, action) {
  if (action.type === 'question/field-changed') {
    const fields = new Set([
      'id',
      'text',
      'category',
      'questionGroup',
      'responseType',
    ]);
    if (!fields.has(action.field)) return state;
    return updateQuestion(state, action.questionId, (question) => {
      const value = typeof action.value === 'string' ? action.value : '';
      if (action.field === 'id') question.id = value.trim() || question.id;
      else if (action.field === 'category') {
        if (value) question.category = value;
        else delete question.category;
      } else if (action.field === 'questionGroup') {
        if (value) question.questionGroup = value;
        else delete question.questionGroup;
      } else if (action.field === 'text') question.text = value;
      else if (action.field === 'responseType') {
        question.responseType = value;
        if (value === 'yes-no-na' || value === 'outcome') {
          delete question.options;
        } else if (!question.options)
          question.options = ['Option A', 'Option B'];
        if (value === 'outcome') delete question.optionOutcomes;
      }
    });
  }
  if (action.type === 'question/deprecation-toggled') {
    return updateQuestion(state, action.questionId, (question) => {
      question.deprecated = !question.deprecated;
    });
  }
  if (action.type === 'question/added') {
    return updateBank(state, (bank) => {
      bank.questions.push({
        id: `q-new-${bank.questions.length + 1}`,
        text: 'New question — click to edit',
        questionGroup: 'Uncategorised',
        responseType: 'yes-no-na',
        deprecated: false,
      });
    });
  }
  if (action.type === 'question/moved') {
    return updateBank(state, (bank) => {
      const question = bank.questions.find(
        (candidate) => candidate.id === action.questionId
      );
      if (!question) return;
      if (action.withinGroup)
        moveQuestionWithinGroup(bank.questions, question, action.direction);
      else moveQuestion(bank.questions, question, action.direction);
    });
  }
  if (action.type === 'question/duplicated') {
    return updateBank(state, (bank) => {
      const index = bank.questions.findIndex(
        (question) => question.id === action.questionId
      );
      if (index < 0) return;
      const copy = structuredClone(bank.questions[index]);
      copy.id = `${copy.id}-copy`;
      bank.questions.splice(index + 1, 0, copy);
    });
  }
  if (action.type === 'category/moved' || action.type === 'group/moved') {
    return updateBank(state, (bank) => {
      if (action.type === 'category/moved')
        moveCategory(bank.questions, action.category, action.direction);
      else
        moveGroup(
          bank.questions,
          action.category,
          action.group,
          action.direction
        );
    });
  }
  if (action.type === 'question/option-added') {
    return updateQuestion(state, action.questionId, (question) => {
      (question.options ??= []).push(action.option);
    });
  }
  if (action.type === 'question/option-removed') {
    return updateQuestion(state, action.questionId, (question) => {
      question.options?.splice(action.index, 1);
      if (question.optionOutcomes) {
        delete question.optionOutcomes[action.option];
        if (!Object.keys(question.optionOutcomes).length)
          delete question.optionOutcomes;
      }
    });
  }
  if (action.type === 'question/option-outcome-changed') {
    return updateQuestion(state, action.questionId, (question) => {
      if (action.outcomeId) {
        (question.optionOutcomes ??= {})[action.option] = action.outcomeId;
      } else if (question.optionOutcomes) {
        delete question.optionOutcomes[action.option];
        if (!Object.keys(question.optionOutcomes).length)
          delete question.optionOutcomes;
      }
    });
  }
  if (
    action.type === 'question/label-assigned' ||
    action.type === 'question/label-unassigned'
  ) {
    return updateQuestion(state, action.questionId, (question) => {
      const ids = question.labelIds ?? [];
      if (action.type === 'question/label-assigned') {
        if (!ids.includes(action.labelId))
          question.labelIds = [...ids, action.labelId];
      } else {
        const next = ids.filter((id) => id !== action.labelId);
        if (next.length) question.labelIds = next;
        else delete question.labelIds;
      }
    });
  }
  if (action.type === 'label/created') {
    return updateBank(state, (bank) => {
      (bank.labels ??= []).push(action.label);
      const question = bank.questions.find(
        (candidate) => candidate.id === action.questionId
      );
      if (question) (question.labelIds ??= []).push(action.label.id);
    });
  }
  if (action.type === 'label/colour-changed') {
    return updateBank(state, (bank) => {
      const label = bank.labels?.find(
        (candidate) => candidate.id === action.labelId
      );
      if (label) label.color = action.colour;
    });
  }
  if (action.type === 'question/free-form-remediation-toggled') {
    return updateQuestion(state, action.questionId, (question) => {
      question.allowFreeFormRemediation = !question.allowFreeFormRemediation;
    });
  }
  if (action.type === 'question/remediation-action-added') {
    return updateQuestion(state, action.questionId, (question) => {
      question.remediationActions = [
        ...normaliseConfiguredActions(
          question.remediationActions ?? [],
          question.id
        ),
        action.action,
      ];
    });
  }
  if (action.type === 'question/remediation-action-changed') {
    return updateQuestion(state, action.questionId, (question) => {
      const actions = normaliseConfiguredActions(
        question.remediationActions ?? [],
        question.id
      );
      if (actions[action.index]) actions[action.index].text = action.text;
      question.remediationActions = actions;
    });
  }
  if (action.type === 'question/remediation-action-removed') {
    return updateQuestion(state, action.questionId, (question) => {
      const actions = normaliseConfiguredActions(
        question.remediationActions ?? [],
        question.id
      );
      actions.splice(action.index, 1);
      if (actions.length) question.remediationActions = actions;
      else delete question.remediationActions;
    });
  }
  if (action.type === 'question/showwhen-mode-changed') {
    const ids = state.conditionalQuestionIds.filter(
      (id) => id !== action.questionId
    );
    if (action.mode === 'conditional') {
      return {
        ...state,
        conditionalQuestionIds: [...ids, action.questionId],
      };
    }
    const next = updateQuestion(state, action.questionId, (question) => {
      delete question.showWhen;
    });
    return { ...next, conditionalQuestionIds: ids };
  }
  if (
    action.type === 'question/showwhen-group-toggled' ||
    action.type === 'question/showwhen-condition-added' ||
    action.type === 'question/showwhen-group-added' ||
    action.type === 'question/showwhen-node-removed' ||
    action.type === 'question/showwhen-leaf-changed'
  ) {
    return updateQuestion(state, action.questionId, (question) => {
      updateShowwhen(question, (tree) => {
        const node = treeNodeAt(tree, action.path);
        if (action.type === 'question/showwhen-group-toggled') {
          if (node?.type === 'group')
            node.op = node.op === 'and' ? 'or' : 'and';
        } else if (action.type === 'question/showwhen-condition-added') {
          if (node?.type === 'group')
            node.children.push({
              type: 'leaf',
              qId: action.target,
              op: 'equals',
              value: '',
            });
        } else if (action.type === 'question/showwhen-group-added') {
          if (node?.type === 'group')
            node.children.push({
              type: 'group',
              op: node.op === 'and' ? 'or' : 'and',
              children: [],
            });
        } else if (action.type === 'question/showwhen-node-removed') {
          const parent = treeNodeAt(tree, action.path.slice(0, -1));
          if (parent?.type === 'group')
            parent.children.splice(action.path.at(-1), 1);
        } else if (node?.type === 'leaf') {
          if ('qId' in action.patch) node.qId = action.patch.qId;
          if ('op' in action.patch) {
            node.op = action.patch.op;
            if (node.op === 'answered') node.value = true;
            else if (node.op === 'in')
              node.value = Array.isArray(node.value) ? node.value : [];
            else node.value = typeof node.value === 'string' ? node.value : '';
          }
          if ('value' in action.patch) {
            node.value =
              node.op === 'in'
                ? String(action.patch.value)
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean)
                : action.patch.value;
          }
        }
      });
    });
  }
  if (action.type.startsWith('outcome/')) {
    return updateBank(state, (bank) => {
      bank.outcomeOptions ??= [];
      if (action.type === 'outcome/added') {
        const ids = new Set(bank.outcomeOptions.map((option) => option.id));
        let index = bank.outcomeOptions.length + 1;
        while (ids.has(`outcome-${index}`)) index += 1;
        bank.outcomeOptions.push({
          id: `outcome-${index}`,
          wording: 'New outcome',
          severity: 100,
        });
      } else if (action.type === 'outcome/default-changed') {
        if (action.id) bank.defaultOutcomeId = action.id;
        else delete bank.defaultOutcomeId;
      } else {
        const option = bank.outcomeOptions.find(
          (candidate) => candidate.id === action.outcomeId
        );
        if (!option) return;
        if (action.type === 'outcome/wording-changed')
          option.wording = action.wording;
        if (action.type === 'outcome/severity-changed') {
          const severity = Number(action.severity);
          option.severity = Number.isFinite(severity) ? severity : 0;
        }
        if (action.type === 'outcome/renamed') {
          const previousId = option.id;
          const nextId = String(action.id).trim() || previousId;
          option.id = nextId;
          for (const question of bank.questions) {
            for (const key of Object.keys(question.optionOutcomes ?? {})) {
              if (question.optionOutcomes?.[key] === previousId)
                question.optionOutcomes[key] = nextId;
            }
          }
          if (bank.defaultOutcomeId === previousId)
            bank.defaultOutcomeId = nextId;
        }
        if (action.type === 'outcome/removed') {
          bank.outcomeOptions = bank.outcomeOptions.filter(
            (candidate) => candidate.id !== action.outcomeId
          );
          for (const question of bank.questions) {
            const map = question.optionOutcomes;
            for (const key of Object.keys(map ?? {})) {
              if (map && map[key] === action.outcomeId) delete map[key];
            }
            if (
              question.optionOutcomes &&
              !Object.keys(question.optionOutcomes).length
            )
              delete question.optionOutcomes;
          }
          if (bank.defaultOutcomeId === action.outcomeId)
            delete bank.defaultOutcomeId;
        }
      }
    });
  }
  if (action.type === 'bank/loaded') {
    return banksLoaded(state, action.banks ?? {}, action.failures ?? []);
  }
  if (action.type === 'bank/refreshed') {
    return banksRefreshed(state, action.banks ?? {}, action.failures ?? []);
  }
  if (action.type === 'bank/retry-requested') {
    // Nothing named as failed and no wholesale load error: there is nothing to
    // re-fetch, so refuse rather than latching `retrying` on with no effect
    // running to clear it. The effect reads this back to decide whether to run.
    if (!state.loadFailures.length && !state.loadError) return state;
    // The named failures stay on screen while the retry runs: they are still
    // true, and clearing them would flash an all-clear the retry has not earned.
    return { ...state, retrying: true };
  }
  if (action.type === 'bank/recovered') {
    return banksRecovered(state, action.banks ?? {}, action.failures ?? []);
  }
  if (action.type === 'bank/load-failed') {
    // `retrying` clears here too: this is where a retry of a wholesale load
    // failure lands when it fails again, and leaving it set would disable the
    // control that is the only way out.
    return {
      ...state,
      loading: false,
      loadError: action.message,
      retrying: false,
    };
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
  if (action.type === 'publish/requested') {
    return { ...state, publishStatus: 'publishing', publishError: '' };
  }
  if (action.type === 'publish/succeeded') {
    return {
      ...state,
      baseline: structuredClone(state.cases),
      drawerOpen: false,
      publishStatus: 'succeeded',
      publishArtifacts: action.artifacts,
      publishError: '',
      toastMsg: 'Submitted for review',
    };
  }
  if (action.type === 'publish/failed') {
    return {
      ...state,
      publishStatus: 'failed',
      publishError: action.message,
      toastMsg: 'Publish failed',
    };
  }
  return state;
}
