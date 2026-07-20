// @ts-check
import { questionBanks } from './question-bank-source.js';
import {
  moveCategory,
  moveGroup,
  moveQuestion,
  moveQuestionWithinGroup,
} from '../../lib/question-order.js';
import { parseShowWhen, serializeTree } from '../../lib/showwhen-tree.js';
import { normaliseConfiguredActions } from '../../evaluators/configured-outcome.js';

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
 * @property {string[]} conditionalQuestionIds
 * @property {'idle'|'publishing'|'succeeded'|'failed'} publishStatus
 * @property {ReturnType<import('./question-bank-compile.js').buildPublishArtifacts>|null} publishArtifacts
 * @property {string} publishError
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
    conditionalQuestionIds: [],
    publishStatus: 'idle',
    publishArtifacts: null,
    publishError: '',
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
