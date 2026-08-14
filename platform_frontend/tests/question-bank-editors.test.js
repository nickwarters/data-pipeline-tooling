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

const NOOP = () => {};
// prettier-ignore
const EMPTY_BANK = { slug: 'empty', label: 'Empty', labels: [], outcomeOptions: [], questions: [] };

/** @param {any} current @param {any} [overrides] */
function renderBankList(current, overrides = {}) {
  return BankList({
    bank: current,
    baselineQuestions: structuredClone(current.questions),
    filters: state().filters,
    dirty: false,
    conditionalQuestionIds: [],
    dispatch: NOOP,
    addQuestion: NOOP,
    ...overrides,
  });
}

/** @param {any} current @param {any} [overrides] */
function showwhenProps(current, overrides = {}) {
  return {
    question: current.questions[0],
    path: [0],
    bankQuestions: current.questions,
    dispatch: NOOP,
    ...overrides,
  };
}

/** @param {any} current @param {any} overrides */
const renderShowwhenEditor = (current, overrides) =>
  ShowwhenEditor(showwhenProps(current, overrides));
/** @param {any} current @param {any} leaf @param {any} [overrides] */
const renderShowwhenLeaf = (current, leaf, overrides = {}) =>
  ShowwhenLeaf({ ...showwhenProps(current, overrides), leaf });
/** @param {any} current @param {any} group @param {any} [overrides] */
const renderShowwhenGroup = (current, group, overrides = {}) =>
  ShowwhenGroup({ ...showwhenProps(current, overrides), group });

const questionAction = (/** @type {string} */ type, detail = {}) => ({
  type: `question/${type}`,
  questionId: 'q-1',
  ...detail,
});
const outcomeAction = (/** @type {string} */ type, detail = {}) => ({
  type: `outcome/${type}`,
  ...detail,
});

/** @param {any} current @param {...any} actions */
function reduce(current, ...actions) {
  return actions.reduce(
    (next, action) => questionBankReducer(next, action),
    current
  );
}

/** @param {any} current */
const questionIds = (current) =>
  current.cases.example.questions.map((/** @type {any} */ q) => q.id);

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

test('toggling free-form remediation sets or deletes the opt-out, never writes false', () => {
  /** @param {any} next */
  const question = (next) =>
    next.cases.example.questions.find(
      (/** @type {any} */ candidate) => candidate.id === 'q-1'
    );
  /** @type {any} */
  const toggle = {
    type: 'question/free-form-remediation-toggled',
    questionId: 'q-1',
  };

  const off = questionBankReducer(state(), toggle);
  assert.equal(question(off).disallowFreeFormRemediation, true);

  const backOn = questionBankReducer(off, toggle);
  assert.equal('disallowFreeFormRemediation' in question(backOn), false);

  const authoredAllowed = state();
  question(authoredAllowed).disallowFreeFormRemediation = false;
  const fromAuthoredFalse = questionBankReducer(authoredAllowed, toggle);
  assert.equal(
    question(fromAuthoredFalse).disallowFreeFormRemediation,
    true,
    'an authored `false` reads as allowed and toggles to disallowed'
  );
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
  current.questions[0].disallowFreeFormRemediation = true;
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
  const view = renderBankList(current, {
    dirty: true,
    dispatch: (/** @type {any} */ action) => actions.push(action),
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

test('bank reducer: editor actions do not mutate prior snapshots', async (t) => {
  // prettier-ignore
  const actions = [
    ['adding a question', questionAction('added')],
    ['moving a question within its group', questionAction('moved', { direction: 1, withinGroup: true }), ['q-2', 'q-1', 'q-3', 'q-new-4']],
    ['changing a question group', questionAction('field-changed', { field: 'questionGroup', value: 'Changed' })],
    ['moving a question group', { type: 'group/moved', category: 'Opening', group: 'Changed', direction: -1 }, ['q-1', 'q-2', 'q-3', 'q-new-4']],
    ['moving a category', { type: 'category/moved', category: 'Opening', direction: 1 }],
    ['clearing a category', questionAction('field-changed', { field: 'category', value: '' })],
    ['changing a response type', questionAction('field-changed', { field: 'responseType', value: 'outcome' })],
    ['toggling deprecation', questionAction('deprecation-toggled')],
    ['duplicating a question', questionAction('duplicated'), undefined, 5],
    ['adding a response option', questionAction('option-added', { option: 'A' })],
    ['mapping a response option to an outcome', questionAction('option-outcome-changed', { option: 'A', outcomeId: 'fail' })],
    ['removing a response option', questionAction('option-removed', { index: 0, option: 'A' })],
    ['creating and assigning a label', { type: 'label/created', questionId: 'q-1', label: { id: 'lbl-a', name: 'A', color: '#000000' } }],
    ['changing a label colour', { type: 'label/colour-changed', labelId: 'lbl-a', colour: '#ffffff' }],
    ['unassigning a label', questionAction('label-unassigned', { labelId: 'lbl-a' })],
    ['reassigning a label', questionAction('label-assigned', { labelId: 'lbl-a' })],
    ['toggling free-form remediation', questionAction('free-form-remediation-toggled')],
    ['adding a remediation action', questionAction('remediation-action-added', { action: { id: 'ra-1', text: 'Act' } })],
    ['editing a remediation action', questionAction('remediation-action-changed', { index: 0, text: 'Changed' })],
    ['removing a remediation action', questionAction('remediation-action-removed', { index: 0 })],
    ['making a question conditional', questionAction('showwhen-mode-changed', { mode: 'conditional' })],
    ['adding a show-when condition', questionAction('showwhen-condition-added', { path: [], target: 'q-2' })],
    ['changing a show-when operator', questionAction('showwhen-leaf-changed', { path: [0], patch: { op: 'in' } })],
    ['changing a show-when value and target', questionAction('showwhen-leaf-changed', { path: [0], patch: { value: 'Yes, No', qId: 'q-3' } })],
    ['toggling a show-when group operator', questionAction('showwhen-group-toggled', { path: [] })],
    ['adding a nested show-when group', questionAction('showwhen-group-added', { path: [] })],
    ['removing a show-when node', questionAction('showwhen-node-removed', { path: [1] })],
    ['adding an outcome', outcomeAction('added')],
    ['changing the default outcome', outcomeAction('default-changed', { id: 'fail' })],
    ['changing outcome wording', outcomeAction('wording-changed', { outcomeId: 'fail', wording: 'Needs work' })],
    ['normalising an invalid outcome severity', outcomeAction('severity-changed', { outcomeId: 'fail', severity: 'not-a-number' })],
    ['renaming an outcome', outcomeAction('renamed', { outcomeId: 'fail', id: 'needs-work' })],
    ['removing an outcome', outcomeAction('removed', { outcomeId: 'needs-work' })],
  ];

  let current = state();
  for (const [description, action, expectedOrder, expectedCount] of actions) {
    await t.test(`${description} leaves its input snapshot untouched`, () => {
      const previous = current;
      const snapshot = structuredClone(previous);
      current = questionBankReducer(previous, /** @type {any} */ (action));
      assert.notEqual(current, previous);
      assert.deepEqual(previous, snapshot);
      if (expectedOrder) assert.deepEqual(questionIds(current), expectedOrder);
      if (expectedCount)
        assert.equal(current.cases.example.questions.length, expectedCount);
    });
  }
});

test('pure editor variants', async (t) => {
  const current = /** @type {any} */ (bank());
  const optionsFor = (/** @type {any} */ question) =>
    effectiveOptions(question, current.outcomeOptions).options;
  // These three cases share only option derivation; the DOM cases stay direct.
  // prettier-ignore
  const optionCases = [
    ['authored response options keep their order', current.questions[0], ['Yes', 'No']],
    ['fixed yes-no options ignore authored mappings', { responseType: 'yes-no-na', optionOutcomes: { No: 'fail' } }, ['Yes', 'No']],
    ['outcome questions use configured wording', { responseType: 'outcome' }, ['Pass', 'Fail']],
  ];
  for (const [name, question, expected] of optionCases) {
    await t.test(name, () => assert.deepEqual(optionsFor(question), expected));
  }

  await t.test('an empty single-choice editor explains the N/A option', () => {
    const view = /** @type {HTMLElement} */ (
      OptionsEditor({
        question: { id: 'q-empty', responseType: 'single-choice' },
        outcomeOptions: [],
        onRemoveOption: NOOP,
        onAddOption: NOOP,
        onSetOptionOutcome: NOOP,
      })
    );
    assert.ok(view.querySelector('.opt-na-note')?.textContent.includes('N/A'));
  });

  await t.test('a filtered empty bank reports that it has no questions', () => {
    const view = renderBankList(EMPTY_BANK, {
      filters: {
        category: 'Missing',
        questionGroup: 'Missing',
        showDeprecated: false,
        conditionalOnly: true,
      },
    });
    assert.ok(
      view.querySelector('.empty')?.textContent.includes('No questions')
    );
  });

  await t.test('an empty outcome editor reports no configured outcomes', () => {
    const view = OutcomeOptionsEditor({
      bank: EMPTY_BANK,
      addOutcome: NOOP,
      setDefaultOutcome: NOOP,
      renameOutcome: NOOP,
      setWording: NOOP,
      setSeverity: NOOP,
      removeOutcome: NOOP,
    });
    assert.ok(
      view
        .querySelector('.outcome-empty')
        ?.textContent.includes('No configured')
    );
  });

  await t.test('labels: empty copy and collision-safe ids', () => {
    const labels = QuestionLabels({
      question: current.questions[0],
      bank: EMPTY_BANK,
      dispatch: NOOP,
    });
    assert.equal(
      labels?.querySelector('.label-empty')?.textContent,
      'No labels assigned'
    );
    assert.equal(makeLabelId('Risk!', ['lbl-risk']), 'lbl-risk-2');
    assert.equal(makeLabelId('---', []), 'lbl-label');
  });

  await t.test('remediation: implicit and explicit free-form policy', () => {
    const disallowed = /** @type {HTMLElement} */ (
      RemediationActionsEditor({
        question: {
          ...current.questions[1],
          disallowFreeFormRemediation: true,
        },
        dispatch: NOOP,
      })
    );
    const allowed = /** @type {HTMLElement} */ (
      RemediationActionsEditor({
        question: current.questions[1],
        dispatch: NOOP,
      })
    );
    assert.ok(disallowed.querySelector('.rem-empty'));
    assert.equal(
      queryAllByRole(allowed, 'switch')[0].getAttribute('aria-checked'),
      'true'
    );
    assert.equal(
      queryAllByRole(disallowed, 'switch')[0].getAttribute('aria-checked'),
      'false'
    );
  });

  await t.test('remediation: next id follows the highest suffix', () => {
    // prettier-ignore
    const question = { id: 'q-1', remediationActions: [{ id: 'q-1-ra-0', text: 'One' }, { id: 'q-1-ra-1', text: 'Two' }] };
    assert.equal(nextRemediationActionId(question), 'q-1-ra-2');
  });

  await t.test('show-when: always and empty conditional modes', () => {
    const common = {
      question: current.questions[1],
    };
    const always = renderShowwhenEditor(current, {
      ...common,
      conditional: false,
    });
    const conditional = renderShowwhenEditor(current, {
      ...common,
      conditional: true,
    });
    assert.ok(always?.querySelector('.showwhen-mode'));
    assert.ok(conditional?.querySelector('.showwhen-empty'));
  });

  await t.test('show-when leaves render answered and array values', () => {
    // prettier-ignore
    const answered = /** @type {HTMLElement} */ (renderShowwhenLeaf(current, { type: 'leaf', qId: 'q-2', op: 'answered', value: true }));
    // prettier-ignore
    const choices = /** @type {HTMLElement} */ (renderShowwhenLeaf(current, { type: 'leaf', qId: 'q-2', op: 'in', value: ['Yes', 'No'] }));
    assert.ok(answered.querySelector('.leaf-answered-hint'));
    assert.equal(
      getByRole(choices, 'textbox', { name: 'Condition value' }).value,
      'Yes, No'
    );
  });

  await t.test('flat navigation stays closed and reports zero changes', () => {
    const root = /** @type {HTMLElement} */ (document.createElement('div'));
    // prettier-ignore
    const flatBank = { slug: 'flat', label: 'Flat', questions: [{ id: 'q', text: 'Q', responseType: 'yes-no-na', deprecated: true }] };
    // prettier-ignore
    const filters = { category: null, questionGroup: null, showDeprecated: false, conditionalOnly: true };
    root.replaceChildren(
      ...BankRail({
        bank: flatBank,
        filters,
        railOpen: false,
        setFilters: NOOP,
        moveCategory: NOOP,
        moveGroup: NOOP,
        onToggleRail: NOOP,
        onCloseRail: NOOP,
      }),
      BankDock({
        bank: EMPTY_BANK,
        diffCounts: { added: 0, changed: 0, deprecated: 0 },
        openDrawer: NOOP,
      })
    );
    assert.equal(root.querySelector('.rail')?.className, 'rail');
    assert.ok(root.textContent.includes('0 changes'));
  });
});

test('pure view edge cases', async (t) => {
  await t.test('uncategorised conditional filters show a card', () => {
    const current = /** @type {any} */ (bank());
    delete current.questions[0].category;
    delete current.questions[0].questionGroup;
    current.questions[0].showWhen = { 'q-2': { equals: 'Yes' } };
    const list = renderBankList(current, {
      filters: {
        category: 'Uncategorised',
        questionGroup: 'Uncategorised',
        showDeprecated: true,
        conditionalOnly: true,
      },
      conditionalQuestionIds: ['q-1'],
      memo: (
        /** @type {any} */ _key,
        /** @type {any} */ _deps,
        /** @type {() => any} */ render
      ) => render(),
    });
    assert.equal(list.querySelectorAll('.card').length, 1);
  });

  await t.test('option prompts reject blanks and excessive length', () => {
    const current = /** @type {any} */ (bank());
    const list = renderBankList(current);
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
  });

  await t.test('a missing show-when group renders nothing', () => {
    const current = /** @type {any} */ (bank());
    assert.equal(renderShowwhenGroup(current, null), undefined);
  });

  await t.test('a lone question cannot self-reference', () => {
    const current = /** @type {any} */ (bank());
    const group = /** @type {HTMLElement} */ (
      renderShowwhenGroup(
        current,
        { type: 'group', op: 'or', children: [] },
        {
          isRoot: true,
          bankQuestions: [current.questions[0]],
        }
      )
    );
    fireEvent(getByRole(group, 'button', { name: '+ condition' }), 'click');
    assert.equal(group.querySelector('.danger'), null);
  });

  await t.test('null editor inputs render nothing', () => {
    const current = /** @type {any} */ (bank());
    assert.equal(
      QuestionLabels({ question: null, bank: current, dispatch: NOOP }),
      undefined
    );
    assert.equal(
      renderShowwhenLeaf(current, null, {
        question: null,
        bankQuestions: [],
      }),
      undefined
    );
    assert.equal(
      renderShowwhenEditor(current, {
        question: null,
        bankQuestions: [],
        conditional: false,
      }),
      undefined
    );
  });

  await t.test('missing label data falls back to an empty label editor', () => {
    const labels = /** @type {HTMLElement} */ (
      QuestionLabels({
        question: { id: 'q-label', labelIds: ['missing'] },
        bank: undefined,
        dispatch: NOOP,
      })
    );
    fireEvent(labels.querySelector('.label-new-add'), 'click');
    assert.ok(labels.querySelector('.label-empty'));
  });

  await t.test('deprecated targets show a label and empty value', () => {
    const current = /** @type {any} */ (bank());
    current.questions[1].deprecated = true;
    // prettier-ignore
    const leaf = /** @type {HTMLElement} */ (renderShowwhenLeaf(current, { type: 'leaf', qId: 'q-2', op: 'equals', value: null }));
    assert.ok(leaf.textContent.includes('(deprecated)'));
    assert.equal(
      getByRole(leaf, 'textbox', { name: 'Condition value' }).value,
      ''
    );
  });
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

test('bank reducer: defensive and clearing actions', async (t) => {
  await t.test('missing questions and unsupported fields are no-ops', () => {
    const current = state();
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
  });

  await t.test('blank ids are ignored while null wording becomes empty', () => {
    const current = reduce(
      state(),
      questionAction('field-changed', { field: 'id', value: '   ' }),
      questionAction('field-changed', { field: 'text', value: null })
    );
    assert.equal(current.cases.example.questions[0].id, 'q-1');
    assert.equal(current.cases.example.questions[0].text, '');
  });

  await t.test('category values set and empty groups clear', () => {
    const current = reduce(
      state(),
      questionAction('field-changed', {
        field: 'category',
        value: 'Changed',
      }),
      questionAction('field-changed', { field: 'questionGroup', value: '' })
    );
    assert.equal(current.cases.example.questions[0].category, 'Changed');
    assert.equal('questionGroup' in current.cases.example.questions[0], false);
  });

  await t.test('fixed response types clear generated choice options', () => {
    const singleChoice = reduce(
      state(),
      questionAction('field-changed', {
        questionId: 'q-2',
        field: 'responseType',
        value: 'single-choice',
      })
    );
    assert.deepEqual(singleChoice.cases.example.questions[1].options, [
      'Option A',
      'Option B',
    ]);
    const current = reduce(
      singleChoice,
      questionAction('field-changed', {
        questionId: 'q-2',
        field: 'responseType',
        value: 'yes-no-na',
      })
    );
    assert.equal(current.cases.example.questions[1].options, undefined);
  });

  await t.test('clearing the last option outcome removes the mapping', () => {
    const current = reduce(
      state(),
      questionAction('option-outcome-changed', { option: 'No', outcomeId: '' })
    );
    assert.equal(current.cases.example.questions[0].optionOutcomes, undefined);
  });

  await t.test('labels stay unique and final removal clears', () => {
    const current = reduce(
      state(),
      questionAction('label-assigned', { labelId: 'lbl-a' }),
      questionAction('label-assigned', { labelId: 'lbl-b' }),
      questionAction('label-assigned', { labelId: 'lbl-b' }),
      questionAction('label-unassigned', { labelId: 'lbl-a' }),
      questionAction('label-unassigned', { labelId: 'lbl-b' })
    );
    assert.equal(current.cases.example.questions[0].labelIds, undefined);
  });

  await t.test('invalid remediation edits are ignored before removal', () => {
    const current = reduce(
      state(),
      questionAction('remediation-action-added', {
        action: { id: 'ra-1', text: 'One' },
      }),
      questionAction('remediation-action-added', {
        action: { id: 'ra-2', text: 'Two' },
      }),
      questionAction('remediation-action-changed', {
        index: 9,
        text: 'Missing',
      }),
      questionAction('remediation-action-removed', { index: 0 })
    );
    assert.deepEqual(current.cases.example.questions[0].remediationActions, [
      { id: 'ra-2', text: 'Two' },
    ]);
  });

  await t.test('removing the only show-when leaf clears the condition', () => {
    const current = reduce(
      state(),
      questionAction('showwhen-condition-added', {
        path: [],
        target: 'q-2',
      }),
      questionAction('showwhen-leaf-changed', {
        path: [0],
        patch: { op: 'answered' },
      }),
      questionAction('showwhen-leaf-changed', {
        path: [0],
        patch: { op: 'equals', value: 'Yes' },
      }),
      questionAction('showwhen-node-removed', { path: [0] })
    );
    assert.equal(current.cases.example.questions[0].showWhen, undefined);
  });

  await t.test('invalid outcomes preserve ids and clear defaults', () => {
    const current = reduce(
      state(),
      outcomeAction('default-changed', { id: '' }),
      outcomeAction('wording-changed', {
        outcomeId: 'missing',
        wording: 'x',
      }),
      outcomeAction('renamed', { outcomeId: 'pass', id: '' })
    );
    assert.equal(current.cases.example.defaultOutcomeId, undefined);
    assert.equal(current.cases.example.outcomeOptions?.[0]?.id, 'pass');
  });

  await t.test('new outcome ids skip existing numeric suffixes', () => {
    const current = state();
    current.cases.example.outcomeOptions.push({
      id: 'outcome-3',
      wording: 'Existing',
      severity: 3,
    });
    const added = questionBankReducer(current, { type: 'outcome/added' });
    assert.ok(
      added.cases.example.outcomeOptions?.some(
        (/** @type {{ id: string }} */ option) => option.id === 'outcome-4'
      ) === true
    );
  });

  await t.test('selection resets filters; missing moves are no-ops', () => {
    const selected = reduce(state(), {
      type: 'bank/selected',
      slug: 'example',
    });
    const before = structuredClone(selected.cases.example.questions);
    const current = reduce(
      selected,
      questionAction('moved', {
        questionId: 'missing',
        direction: 1,
        withinGroup: true,
      }),
      questionAction('duplicated', { questionId: 'missing' })
    );
    assert.equal(current.filters.category, null);
    assert.equal(current.filters.questionGroup, null);
    assert.deepEqual(current.cases.example.questions, before);
  });

  await t.test(
    'option actions tolerate absent arrays and clear mappings',
    () => {
      const current = reduce(
        state(),
        questionAction('option-removed', {
          questionId: 'q-2',
          index: 0,
          option: 'Missing',
        }),
        questionAction('option-removed', { index: 0, option: 'Yes' }),
        questionAction('option-outcome-changed', {
          questionId: 'q-2',
          option: 'Yes',
          outcomeId: 'pass',
        }),
        questionAction('option-outcome-changed', {
          questionId: 'q-2',
          option: 'Yes',
          outcomeId: '',
        })
      );
      assert.deepEqual(current.cases.example.questions[0].options, ['No']);
      assert.equal(
        current.cases.example.questions[1].optionOutcomes,
        undefined
      );
    }
  );

  await t.test('missing label targets and show-when paths are safe', () => {
    const current = reduce(
      state(),
      {
        type: 'label/created',
        questionId: 'missing',
        label: { id: 'lbl-c', name: 'C', color: '#000000' },
      },
      {
        type: 'label/colour-changed',
        labelId: 'missing',
        colour: '#ffffff',
      },
      questionAction('showwhen-group-toggled', { path: [99] })
    );
    assert.deepEqual(current.cases.example.labels, [
      { id: 'lbl-c', name: 'C', color: '#000000' },
    ]);
    assert.equal(current.cases.example.questions[0].showWhen, undefined);
  });
});
