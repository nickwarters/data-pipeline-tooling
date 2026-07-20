// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  queryAllByTag,
  queryAllByRole,
} from './helpers/semantic-dom.js';

installDom();

const { QuestionCard } =
  await import('../src/pages/question-bank/question-card.js');
const { questionBankReducer } =
  await import('../src/pages/question-bank/bank-slice.js');
const { BankList } =
  await import('../src/pages/question-bank/cora-bank-list.js');
const { BankRail } =
  await import('../src/pages/question-bank/cora-bank-rail.js');
const { BankDock } =
  await import('../src/pages/question-bank/cora-bank-dock.js');
const { effectiveOptions, OptionsEditor } =
  await import('../src/pages/question-bank/options-editor.js');
const { WordingEditor } =
  await import('../src/pages/question-bank/wording-editor.js');
const { QuestionLabels, makeLabelId } =
  await import('../src/pages/question-bank/question-labels.js');
const { ShowwhenEditor } =
  await import('../src/pages/question-bank/showwhen-editor.js');
const { ShowwhenLeaf } =
  await import('../src/pages/question-bank/showwhen-leaf.js');
const { ShowwhenGroup } =
  await import('../src/pages/question-bank/showwhen-group.js');
const { RemediationActionsEditor, nextRemediationActionId } =
  await import('../src/pages/question-bank/cora-remediation-actions-editor.js');
const { OutcomeOptionsEditor } =
  await import('../src/pages/question-bank/cora-outcome-options-editor.js');

function bank() {
  return {
    slug: 'example',
    label: 'Example',
    labels: [],
    outcomeOptions: [
      { id: 'pass', wording: 'Pass', severity: 0 },
      { id: 'fail', wording: 'Fail', severity: 100 },
    ],
    defaultOutcomeId: 'pass',
    questions: [
      {
        id: 'q-1',
        text: 'First?',
        category: 'Opening',
        questionGroup: 'Core',
        responseType: 'single-choice',
        options: ['Yes', 'No'],
        optionOutcomes: { No: 'fail' },
        deprecated: false,
      },
      {
        id: 'q-2',
        text: 'Second?',
        category: 'Opening',
        questionGroup: 'Core',
        responseType: 'yes-no-na',
        deprecated: false,
      },
      {
        id: 'q-3',
        text: 'Third?',
        category: 'Closing',
        questionGroup: 'Sign-off',
        responseType: 'yes-no-na',
        deprecated: false,
      },
    ],
  };
}

function state() {
  const current = /** @type {any} */ (bank());
  return /** @type {any} */ ({
    cases: { example: current },
    baseline: { example: structuredClone(current) },
    activeSlug: 'example',
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
  });
}

test('QuestionCard is a pure view that emits plain actions for edits and deprecation', () => {
  /** @type {any[]} */
  const actions = [];
  const current = bank();
  const card = /** @type {HTMLElement} */ (
    QuestionCard({
      question: current.questions[0],
      questionIndex: 0,
      bank: current,
      baselineQuestions: structuredClone(current.questions),
      groupFilterActive: false,
      conditional: false,
      dispatch: (action) => actions.push(action),
    })
  );

  const wording = getByRole(card, 'textbox', { name: 'Question wording' });
  wording.value = 'Edited wording';
  fireEvent(wording, 'input');
  fireEvent(getByRole(card, 'button', { name: 'Mark deprecated' }), 'click');

  assert.deepEqual(actions, [
    {
      type: 'question/field-changed',
      questionId: 'q-1',
      field: 'text',
      value: 'Edited wording',
    },
    { type: 'question/deprecation-toggled', questionId: 'q-1' },
  ]);
  for (const tag of [
    'cora-wording-editor',
    'cora-options-editor',
    'cora-question-labels',
    'cora-showwhen-editor',
    'cora-showwhen-group',
    'cora-showwhen-leaf',
    'cora-remediation-actions-editor',
  ]) {
    assert.equal(queryAllByTag(card, tag).length, 0);
  }
  assert.equal(
    queryAllByTag(card, 'button').some(
      (button) => button.getAttribute('aria-label') === 'Remove draft question'
    ),
    false,
    'Question Definitions are deprecated, never deleted'
  );
});

test('question editor actions preserve reorder, option, label, remediation, and showWhen behaviour', () => {
  const initial = state();
  const edited = questionBankReducer(initial, {
    type: 'question/field-changed',
    questionId: 'q-1',
    field: 'text',
    value: 'Edited',
  });
  assert.equal(edited.cases.example.questions[0].text, 'Edited');
  assert.equal(initial.cases.example.questions[0].text, 'First?');
  assert.equal(
    edited.cases.example.questions[1],
    initial.cases.example.questions[1]
  );

  const moved = questionBankReducer(edited, {
    type: 'question/moved',
    questionId: 'q-1',
    direction: 1,
    withinGroup: false,
  });
  assert.deepEqual(
    moved.cases.example.questions.map((question) => question.id),
    ['q-2', 'q-1', 'q-3']
  );

  const optionAdded = questionBankReducer(moved, {
    type: 'question/option-added',
    questionId: 'q-1',
    option: 'Maybe',
  });
  const optionMapped = questionBankReducer(optionAdded, {
    type: 'question/option-outcome-changed',
    questionId: 'q-1',
    option: 'Maybe',
    outcomeId: 'fail',
  });
  assert.deepEqual(optionMapped.cases.example.questions[1].options, [
    'Yes',
    'No',
    'Maybe',
  ]);
  assert.equal(
    optionMapped.cases.example.questions[1].optionOutcomes?.Maybe,
    'fail'
  );

  const labelled = questionBankReducer(optionMapped, {
    type: 'label/created',
    questionId: 'q-1',
    label: { id: 'lbl-risk', name: 'Risk', color: '#ff0000' },
  });
  assert.deepEqual(labelled.cases.example.questions[1].labelIds, ['lbl-risk']);

  const remediation = questionBankReducer(labelled, {
    type: 'question/remediation-action-added',
    questionId: 'q-1',
    action: { id: 'q-1-ra-0', text: 'Contact owner' },
  });
  assert.deepEqual(remediation.cases.example.questions[1].remediationActions, [
    { id: 'q-1-ra-0', text: 'Contact owner' },
  ]);

  const revealed = questionBankReducer(remediation, {
    type: 'question/showwhen-mode-changed',
    questionId: 'q-1',
    mode: 'conditional',
  });
  const conditional = questionBankReducer(revealed, {
    type: 'question/showwhen-condition-added',
    questionId: 'q-1',
    path: [],
    target: 'q-2',
  });
  assert.deepEqual(conditional.cases.example.questions[1].showWhen, {
    'q-2': { equals: '' },
  });
  const always = questionBankReducer(conditional, {
    type: 'question/showwhen-mode-changed',
    questionId: 'q-1',
    mode: 'always',
  });
  assert.equal('showWhen' in always.cases.example.questions[1], false);
});

test('renaming and removing outcomes updates every Question Definition reference', () => {
  const renamed = questionBankReducer(state(), {
    type: 'outcome/renamed',
    outcomeId: 'fail',
    id: 'needs-work',
  });
  assert.equal(
    renamed.cases.example.questions[0].optionOutcomes?.No,
    'needs-work'
  );
  const removed = questionBankReducer(renamed, {
    type: 'outcome/removed',
    outcomeId: 'needs-work',
  });
  assert.equal(removed.cases.example.questions[0].optionOutcomes, undefined);
});

test('pure bank views expose every editor operation as a serialisable action', () => {
  const current = /** @type {any} */ (bank());
  current.labels = [
    { id: 'lbl-risk', name: 'Risk', color: '#ff0000' },
    { id: 'lbl-ops', name: 'Operations', color: '#00ff00' },
  ];
  current.questions[0].labelIds = ['lbl-risk'];
  current.questions[0].allowFreeFormRemediation = true;
  current.questions[0].remediationActions = [
    { id: 'q-1-ra-0', text: 'Contact owner' },
  ];
  current.questions[0].showWhen = {
    $and: [
      { 'q-2': { equals: 'Yes' } },
      { $or: [{ 'q-3': { answered: true } }] },
    ],
  };
  /** @type {any[]} */
  const actions = [];
  const view = BankList({
    bank: current,
    baselineQuestions: structuredClone(current.questions),
    filters: {
      category: null,
      questionGroup: null,
      showDeprecated: true,
      conditionalOnly: false,
    },
    dirty: true,
    conditionalQuestionIds: [],
    dispatch: (action) => actions.push(action),
    addQuestion: () => actions.push({ type: 'question/added' }),
  });

  const newLabel = /** @type {any} */ (view.querySelector('.label-new-name'));
  newLabel.value = 'Legal';
  const newColour = /** @type {any} */ (view.querySelector('.label-new-color'));
  newColour.value = '#123456';
  /** @type {any} */ (globalThis).prompt = () => 'Maybe';

  for (const input of queryAllByRole(view, 'textbox')) {
    input.value = input.value || 'Changed';
    fireEvent(input, input.tagName === 'TEXTAREA' ? 'input' : 'change');
  }
  for (const input of queryAllByTag(view, 'input')) {
    if (input.type === 'color') {
      input.value = '#abcdef';
      fireEvent(input, 'change');
    }
  }
  for (const select of queryAllByRole(view, 'combobox')) {
    if (select.getAttribute('aria-label') === 'Show when') {
      select.value = 'always';
    } else if (select.getAttribute('aria-label') === 'Condition operator') {
      select.value = 'in';
    } else if (select.getAttribute('aria-label') === 'Condition question') {
      select.value = 'q-3';
    }
    fireEvent(select, 'change');
  }
  for (const button of queryAllByRole(view, 'button'))
    fireEvent(button, 'click');
  for (const toggle of queryAllByRole(view, 'switch'))
    fireEvent(toggle, 'click');
  for (const selector of ['.tag-x', '.label-pill-x', '.leaf-x']) {
    for (const control of view.querySelectorAll(selector)) {
      fireEvent(control, 'click');
    }
  }

  const types = new Set(actions.map((action) => action.type));
  for (const type of [
    'question/field-changed',
    'question/deprecation-toggled',
    'question/duplicated',
    'question/option-added',
    'question/option-removed',
    'question/option-outcome-changed',
    'question/label-assigned',
    'question/label-unassigned',
    'label/created',
    'label/colour-changed',
    'question/free-form-remediation-toggled',
    'question/remediation-action-added',
    'question/remediation-action-changed',
    'question/remediation-action-removed',
    'question/showwhen-mode-changed',
    'question/showwhen-group-toggled',
    'question/showwhen-condition-added',
    'question/showwhen-group-added',
    'question/showwhen-node-removed',
    'question/showwhen-leaf-changed',
    'outcome/added',
    'outcome/default-changed',
    'outcome/renamed',
    'outcome/wording-changed',
    'outcome/severity-changed',
    'outcome/removed',
    'question/added',
  ]) {
    assert.equal(types.has(type), true, `${type} should be dispatched`);
  }
});

test('bank rail and dock preserve filters, grouping reorder, and drawer actions', () => {
  const current = /** @type {any} */ (bank());
  const calls = /** @type {any} */ ({
    filters: [],
    categories: [],
    groups: [],
    toggle: 0,
    close: 0,
    drawer: 0,
  });
  const root = /** @type {any} */ (document.createElement('div'));
  root.replaceChildren(
    ...BankRail({
      bank: current,
      filters: {
        category: null,
        questionGroup: null,
        showDeprecated: true,
        conditionalOnly: false,
      },
      railOpen: true,
      setFilters: (patch) => calls.filters.push(patch),
      moveCategory: (name, direction) =>
        calls.categories.push([name, direction]),
      moveGroup: (category, name, direction) =>
        calls.groups.push([category, name, direction]),
      onToggleRail: () => calls.toggle++,
      onCloseRail: () => calls.close++,
    }),
    BankDock({
      bank: current,
      diffCounts: { added: 1, changed: 2, deprecated: 1 },
      openDrawer: () => calls.drawer++,
    })
  );
  for (const button of queryAllByRole(root, 'button'))
    fireEvent(button, 'click');
  for (const chip of root.querySelectorAll('.filter-chip'))
    fireEvent(chip, 'click');
  for (const toggle of root.querySelectorAll('.toggle'))
    fireEvent(toggle, 'click');
  fireEvent(root.querySelector('.rail-backdrop'), 'click');

  assert.ok(calls.filters.length >= 3);
  assert.ok(calls.categories.length >= 1);
  assert.ok(calls.groups.length >= 1);
  assert.equal(calls.toggle, 1);
  assert.ok(calls.close >= 2);
  assert.equal(calls.drawer, 2);
});

test('bank reducer handles every editor action without mutating prior snapshots', () => {
  let current = state();
  const reduce = (/** @type {any} */ action) => {
    const previous = current;
    current = questionBankReducer(current, action);
    assert.notEqual(current, previous, action.type);
  };
  reduce({ type: 'question/added' });
  reduce({
    type: 'question/field-changed',
    questionId: 'q-1',
    field: 'category',
    value: '',
  });
  reduce({
    type: 'question/field-changed',
    questionId: 'q-1',
    field: 'questionGroup',
    value: 'Changed',
  });
  reduce({
    type: 'question/field-changed',
    questionId: 'q-1',
    field: 'responseType',
    value: 'outcome',
  });
  reduce({ type: 'question/deprecation-toggled', questionId: 'q-1' });
  reduce({
    type: 'question/moved',
    questionId: 'q-1',
    direction: 1,
    withinGroup: true,
  });
  reduce({ type: 'question/duplicated', questionId: 'q-1' });
  reduce({ type: 'category/moved', category: 'Opening', direction: 1 });
  reduce({
    type: 'group/moved',
    category: 'Opening',
    group: 'Changed',
    direction: 1,
  });
  reduce({ type: 'question/option-added', questionId: 'q-1', option: 'A' });
  reduce({
    type: 'question/option-outcome-changed',
    questionId: 'q-1',
    option: 'A',
    outcomeId: 'fail',
  });
  reduce({
    type: 'question/option-removed',
    questionId: 'q-1',
    index: 0,
    option: 'A',
  });
  reduce({
    type: 'label/created',
    questionId: 'q-1',
    label: { id: 'lbl-a', name: 'A', color: '#000000' },
  });
  reduce({
    type: 'label/colour-changed',
    labelId: 'lbl-a',
    colour: '#ffffff',
  });
  reduce({
    type: 'question/label-unassigned',
    questionId: 'q-1',
    labelId: 'lbl-a',
  });
  reduce({
    type: 'question/label-assigned',
    questionId: 'q-1',
    labelId: 'lbl-a',
  });
  reduce({
    type: 'question/free-form-remediation-toggled',
    questionId: 'q-1',
  });
  reduce({
    type: 'question/remediation-action-added',
    questionId: 'q-1',
    action: { id: 'ra-1', text: 'Act' },
  });
  reduce({
    type: 'question/remediation-action-changed',
    questionId: 'q-1',
    index: 0,
    text: 'Changed',
  });
  reduce({
    type: 'question/remediation-action-removed',
    questionId: 'q-1',
    index: 0,
  });
  reduce({
    type: 'question/showwhen-mode-changed',
    questionId: 'q-1',
    mode: 'conditional',
  });
  reduce({
    type: 'question/showwhen-condition-added',
    questionId: 'q-1',
    path: [],
    target: 'q-2',
  });
  reduce({
    type: 'question/showwhen-leaf-changed',
    questionId: 'q-1',
    path: [0],
    patch: { op: 'in' },
  });
  reduce({
    type: 'question/showwhen-leaf-changed',
    questionId: 'q-1',
    path: [0],
    patch: { value: 'Yes, No', qId: 'q-3' },
  });
  reduce({
    type: 'question/showwhen-group-toggled',
    questionId: 'q-1',
    path: [],
  });
  reduce({
    type: 'question/showwhen-group-added',
    questionId: 'q-1',
    path: [],
  });
  reduce({
    type: 'question/showwhen-node-removed',
    questionId: 'q-1',
    path: [1],
  });
  reduce({ type: 'outcome/added' });
  reduce({ type: 'outcome/default-changed', id: 'fail' });
  reduce({
    type: 'outcome/wording-changed',
    outcomeId: 'fail',
    wording: 'Needs work',
  });
  reduce({
    type: 'outcome/severity-changed',
    outcomeId: 'fail',
    severity: 'not-a-number',
  });
  reduce({
    type: 'outcome/renamed',
    outcomeId: 'fail',
    id: 'needs-work',
  });
  reduce({ type: 'outcome/removed', outcomeId: 'needs-work' });
  assert.equal(current.cases.example.questions.length, 5);
});

test('pure editor variants preserve empty, fixed, outcome, and conditional states', () => {
  const current = /** @type {any} */ (bank());
  const dispatch = () => {};
  assert.deepEqual(
    effectiveOptions(current.questions[0], current.outcomeOptions).options,
    ['Yes', 'No']
  );
  assert.deepEqual(
    effectiveOptions(
      { responseType: 'yes-no-na', optionOutcomes: { No: 'fail' } },
      current.outcomeOptions
    ).options,
    ['Yes', 'No']
  );
  assert.deepEqual(
    effectiveOptions({ responseType: 'outcome' }, current.outcomeOptions)
      .options,
    ['Pass', 'Fail']
  );
  const optionView = /** @type {HTMLElement} */ (
    OptionsEditor({
      question: { id: 'q-empty', responseType: 'single-choice' },
      outcomeOptions: [],
      onRemoveOption() {},
      onAddOption() {},
      onSetOptionOutcome() {},
    })
  );
  assert.equal(
    /** @type {HTMLElement} */ (
      optionView.querySelector('.opt-na-note')
    ).textContent.includes('N/A'),
    true
  );

  const emptyBank = {
    slug: 'empty',
    label: 'Empty',
    labels: [],
    outcomeOptions: [],
    questions: [],
  };
  const emptyList = BankList({
    bank: emptyBank,
    baselineQuestions: [],
    filters: {
      category: 'Missing',
      questionGroup: 'Missing',
      showDeprecated: false,
      conditionalOnly: true,
    },
    dirty: false,
    dispatch,
    addQuestion() {},
  });
  assert.equal(
    emptyList.querySelector('.empty')?.textContent.includes('No questions'),
    true
  );
  assert.equal(
    OutcomeOptionsEditor({
      bank: emptyBank,
      addOutcome() {},
      setDefaultOutcome() {},
      renameOutcome() {},
      setWording() {},
      setSeverity() {},
      removeOutcome() {},
    })
      .querySelector('.outcome-empty')
      ?.textContent.includes('No configured'),
    true
  );
  assert.equal(
    QuestionLabels({
      question: current.questions[0],
      bank: emptyBank,
      dispatch,
    })?.querySelector('.label-empty')?.textContent,
    'No labels assigned'
  );
  assert.equal(makeLabelId('Risk!', ['lbl-risk']), 'lbl-risk-2');
  assert.equal(makeLabelId('---', []), 'lbl-label');

  const emptyRemediation = /** @type {HTMLElement} */ (
    RemediationActionsEditor({
      question: current.questions[1],
      dispatch,
    })
  );
  assert.ok(emptyRemediation.querySelector('.rem-empty'));
  assert.equal(
    nextRemediationActionId({
      id: 'q-1',
      remediationActions: [
        { id: 'q-1-ra-0', text: 'One' },
        { id: 'q-1-ra-1', text: 'Two' },
      ],
    }),
    'q-1-ra-2'
  );

  assert.ok(
    ShowwhenEditor({
      question: current.questions[1],
      conditional: false,
      bankQuestions: current.questions,
      dispatch,
    })?.querySelector('.showwhen-mode')
  );
  assert.ok(
    ShowwhenEditor({
      question: current.questions[1],
      conditional: true,
      bankQuestions: current.questions,
      dispatch,
    })?.querySelector('.showwhen-empty')
  );
  const answeredLeaf = /** @type {HTMLElement} */ (
    ShowwhenLeaf({
      question: current.questions[0],
      leaf: { type: 'leaf', qId: 'q-2', op: 'answered', value: true },
      path: [0],
      bankQuestions: current.questions,
      dispatch,
    })
  );
  assert.ok(answeredLeaf.querySelector('.leaf-answered-hint'));
  const arrayLeaf = /** @type {HTMLElement} */ (
    ShowwhenLeaf({
      question: current.questions[0],
      leaf: { type: 'leaf', qId: 'q-2', op: 'in', value: ['Yes', 'No'] },
      path: [0],
      bankQuestions: current.questions,
      dispatch,
    })
  );
  assert.equal(
    getByRole(arrayLeaf, 'textbox', { name: 'Condition value' }).value,
    'Yes, No'
  );

  const noGroups = /** @type {any} */ (document.createElement('div'));
  noGroups.replaceChildren(
    ...BankRail({
      bank: {
        slug: 'flat',
        label: 'Flat',
        questions: [
          { id: 'q', text: 'Q', responseType: 'yes-no-na', deprecated: true },
        ],
      },
      filters: {
        category: null,
        questionGroup: null,
        showDeprecated: false,
        conditionalOnly: true,
      },
      railOpen: false,
      setFilters() {},
      moveCategory() {},
      moveGroup() {},
      onToggleRail() {},
      onCloseRail() {},
    })
  );
  assert.equal(noGroups.querySelector('.rail').className, 'rail');
  assert.equal(
    BankDock({
      bank: emptyBank,
      diffCounts: { added: 0, changed: 0, deprecated: 0 },
      openDrawer() {},
    }).textContent.includes('0 changes'),
    true
  );
});

test('pure views cover filtered, memoised, guarded, and validation variants', () => {
  const current = /** @type {any} */ (bank());
  delete current.questions[0].category;
  delete current.questions[0].questionGroup;
  current.questions[0].showWhen = { 'q-2': { equals: 'Yes' } };
  const list = BankList({
    bank: current,
    baselineQuestions: structuredClone(current.questions),
    filters: {
      category: 'Uncategorised',
      questionGroup: 'Uncategorised',
      showDeprecated: true,
      conditionalOnly: true,
    },
    dirty: false,
    conditionalQuestionIds: ['q-1'],
    dispatch() {},
    addQuestion() {},
    memo: (_key, _deps, render) => render(),
  });
  assert.equal(list.querySelectorAll('.card').length, 1);

  const add = getByRole(list, 'button', { name: '+ option' });
  const originalPrompt = /** @type {any} */ (globalThis).prompt;
  const originalAlert = /** @type {any} */ (globalThis).alert;
  let alerts = 0;
  try {
    /** @type {any} */ (globalThis).alert = () => alerts++;
    /** @type {any} */ (globalThis).prompt = () => '   ';
    fireEvent(add, 'click');
    /** @type {any} */ (globalThis).prompt = () => 'x'.repeat(1000);
    fireEvent(add, 'click');
  } finally {
    /** @type {any} */ (globalThis).prompt = originalPrompt;
    /** @type {any} */ (globalThis).alert = originalAlert;
  }
  assert.equal(alerts, 1);

  assert.equal(
    ShowwhenGroup({
      question: current.questions[0],
      group: null,
      path: [],
      bankQuestions: current.questions,
      dispatch() {},
    }),
    undefined
  );
  const onlyQuestion = /** @type {HTMLElement} */ (
    ShowwhenGroup({
      question: current.questions[0],
      group: { type: 'group', op: 'or', children: [] },
      path: [],
      isRoot: true,
      bankQuestions: [current.questions[0]],
      dispatch() {},
    })
  );
  fireEvent(
    getByRole(onlyQuestion, 'button', { name: '+ condition' }),
    'click'
  );
  assert.equal(onlyQuestion.querySelector('.danger'), null);

  assert.equal(
    QuestionLabels({ question: null, bank: current, dispatch() {} }),
    undefined
  );
  assert.equal(
    ShowwhenLeaf({
      question: null,
      leaf: null,
      path: [],
      bankQuestions: [],
      dispatch() {},
    }),
    undefined
  );
  assert.equal(
    ShowwhenEditor({
      question: null,
      conditional: false,
      bankQuestions: [],
      dispatch() {},
    }),
    undefined
  );

  const labels = /** @type {HTMLElement} */ (
    QuestionLabels({
      question: { id: 'q-label', labelIds: ['missing'] },
      bank: undefined,
      dispatch() {},
    })
  );
  fireEvent(labels.querySelector('.label-new-add'), 'click');
  assert.ok(labels.querySelector('.label-empty'));

  current.questions[1].deprecated = true;
  const leaf = /** @type {HTMLElement} */ (
    ShowwhenLeaf({
      question: current.questions[0],
      leaf: { type: 'leaf', qId: 'q-2', op: 'equals', value: null },
      path: [0],
      bankQuestions: current.questions,
      dispatch() {},
    })
  );
  assert.ok(leaf.textContent.includes('(deprecated)'));
  assert.equal(
    getByRole(leaf, 'textbox', { name: 'Condition value' }).value,
    ''
  );
});

test('wording editor reports new, unchanged, edited, long, and focus states', () => {
  const question = {
    id: 'q-wording',
    text: 'A'.repeat(181),
    responseType: 'yes-no-na',
    deprecated: true,
  };
  /** @type {string[]} */
  const values = [];
  const originalRaf = /** @type {any} */ (globalThis).requestAnimationFrame;
  /** @type {any} */ (globalThis).requestAnimationFrame = (
    /** @type {FrameRequestCallback} */ callback
  ) => callback(0);
  try {
    const view = /** @type {HTMLElement} */ (
      WordingEditor({
        question,
        baselineQuestion: { ...question, text: 'Before' },
        onTextInput: (value) => values.push(value),
      })
    );
    const input = getByRole(view, 'textbox', { name: 'Question wording' });
    fireEvent(input, 'focus');
    assert.equal(view.className, 'wording focused');
    input.value = 'After';
    fireEvent(input, 'input');
    fireEvent(input, 'blur');
    assert.deepEqual(values, ['After']);
    assert.equal(view.className, 'wording');
    assert.ok(view.querySelector('.charcount')?.className.includes('warn'));
  } finally {
    /** @type {any} */ (globalThis).requestAnimationFrame = originalRaf;
  }
  assert.ok(
    WordingEditor({
      question,
      baselineQuestion: undefined,
      onTextInput() {},
    })?.textContent.includes('New draft')
  );
  assert.ok(
    WordingEditor({
      question,
      baselineQuestion: structuredClone(question),
      onTextInput() {},
    })?.textContent.includes('Unchanged')
  );
});

test('bank reducer covers defensive and clearing branches for plain actions', () => {
  let current = state();
  assert.equal(
    questionBankReducer(current, {
      type: 'question/field-changed',
      questionId: 'missing',
      field: 'text',
      value: 'No-op',
    }),
    current
  );
  assert.equal(
    questionBankReducer(current, {
      type: 'question/field-changed',
      questionId: 'q-1',
      field: 'unsupported',
      value: 'No-op',
    }),
    current
  );
  /** @param {any} action */
  const apply = (action) => {
    current = questionBankReducer(current, action);
  };
  apply({
    type: 'question/field-changed',
    questionId: 'q-1',
    field: 'id',
    value: '   ',
  });
  apply({
    type: 'question/field-changed',
    questionId: 'q-1',
    field: 'text',
    value: null,
  });
  apply({
    type: 'question/field-changed',
    questionId: 'q-1',
    field: 'category',
    value: 'Changed',
  });
  apply({
    type: 'question/field-changed',
    questionId: 'q-1',
    field: 'questionGroup',
    value: '',
  });
  apply({
    type: 'question/field-changed',
    questionId: 'q-2',
    field: 'responseType',
    value: 'single-choice',
  });
  apply({
    type: 'question/field-changed',
    questionId: 'q-2',
    field: 'responseType',
    value: 'yes-no-na',
  });
  apply({
    type: 'question/option-outcome-changed',
    questionId: 'q-1',
    option: 'No',
    outcomeId: '',
  });
  apply({
    type: 'question/label-assigned',
    questionId: 'q-1',
    labelId: 'lbl-a',
  });
  apply({
    type: 'question/label-assigned',
    questionId: 'q-1',
    labelId: 'lbl-b',
  });
  apply({
    type: 'question/label-unassigned',
    questionId: 'q-1',
    labelId: 'lbl-a',
  });
  apply({
    type: 'question/remediation-action-added',
    questionId: 'q-1',
    action: { id: 'ra-1', text: 'One' },
  });
  apply({
    type: 'question/remediation-action-added',
    questionId: 'q-1',
    action: { id: 'ra-2', text: 'Two' },
  });
  apply({
    type: 'question/remediation-action-changed',
    questionId: 'q-1',
    index: 9,
    text: 'Missing',
  });
  apply({
    type: 'question/remediation-action-removed',
    questionId: 'q-1',
    index: 0,
  });
  apply({
    type: 'question/showwhen-condition-added',
    questionId: 'q-1',
    path: [],
    target: 'q-2',
  });
  apply({
    type: 'question/showwhen-leaf-changed',
    questionId: 'q-1',
    path: [0],
    patch: { op: 'answered' },
  });
  apply({
    type: 'question/showwhen-leaf-changed',
    questionId: 'q-1',
    path: [0],
    patch: { op: 'equals', value: 'Yes' },
  });
  apply({
    type: 'question/showwhen-node-removed',
    questionId: 'q-1',
    path: [0],
  });
  apply({
    type: 'outcome/default-changed',
    id: '',
  });
  apply({
    type: 'outcome/wording-changed',
    outcomeId: 'missing',
    wording: 'x',
  });
  current.cases.example.outcomeOptions.push({
    id: 'outcome-3',
    wording: 'Existing',
    severity: 3,
  });
  apply({ type: 'outcome/added' });
  apply({ type: 'bank/selected', slug: 'example' });
  apply({
    type: 'question/moved',
    questionId: 'missing',
    direction: 1,
    withinGroup: true,
  });
  apply({ type: 'question/duplicated', questionId: 'missing' });
  apply({
    type: 'question/option-removed',
    questionId: 'q-2',
    index: 0,
    option: 'Missing',
  });
  apply({
    type: 'question/option-removed',
    questionId: 'q-1',
    index: 0,
    option: 'Yes',
  });
  apply({
    type: 'question/option-outcome-changed',
    questionId: 'q-2',
    option: 'Yes',
    outcomeId: 'pass',
  });
  apply({
    type: 'question/option-outcome-changed',
    questionId: 'q-2',
    option: 'Yes',
    outcomeId: '',
  });
  apply({
    type: 'question/label-assigned',
    questionId: 'q-1',
    labelId: 'lbl-b',
  });
  apply({
    type: 'question/label-unassigned',
    questionId: 'q-1',
    labelId: 'lbl-b',
  });
  apply({
    type: 'label/created',
    questionId: 'missing',
    label: { id: 'lbl-c', name: 'C', color: '#000000' },
  });
  apply({
    type: 'label/colour-changed',
    labelId: 'missing',
    colour: '#ffffff',
  });
  apply({
    type: 'question/showwhen-group-toggled',
    questionId: 'q-1',
    path: [99],
  });
  apply({
    type: 'outcome/renamed',
    outcomeId: 'pass',
    id: '',
  });

  assert.equal(current.cases.example.questions[0].id, 'q-1');
  assert.equal(current.cases.example.questions[0].labelIds, undefined);
  assert.equal(current.cases.example.questions[0].showWhen, undefined);
  assert.ok(
    current.cases.example.outcomeOptions.some(
      (/** @type {{ id: string }} */ option) => option.id === 'outcome-4'
    )
  );
});
