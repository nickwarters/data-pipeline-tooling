// @ts-check
import { h } from '../../lib/html.js';
import { QuestionCard } from './question-card.js';
import { OutcomeOptionsEditor } from './cora-outcome-options-editor.js';

/**
 * Pure Question Bank list. Each card is memoised on only the values that can
 * change its rendered subtree.
 * @param {{ bank: any, baselineQuestions: any[], filters: any, dirty: boolean, conditionalQuestionIds?: string[], dispatch: (action: any) => void, addQuestion: () => void, memo?: (key: PropertyKey, deps: readonly unknown[], render: () => HTMLElement) => HTMLElement }} props
 */
export function BankList(props) {
  const { bank, dirty } = props;
  const filters = props.filters;
  const visible = bank.questions.filter((/** @type {any} */ question) => {
    if (!filters.showDeprecated && question.deprecated) return false;
    if (
      filters.category &&
      (question.category || 'Uncategorised') !== filters.category
    )
      return false;
    if (
      filters.questionGroup &&
      (question.questionGroup || 'Uncategorised') !== filters.questionGroup
    )
      return false;
    if (filters.conditionalOnly && !question.showWhen) return false;
    return true;
  });

  const outcomeEditor = OutcomeOptionsEditor({
    bank,
    addOutcome: () => props.dispatch({ type: 'outcome/added' }),
    setDefaultOutcome: (id) =>
      props.dispatch({ type: 'outcome/default-changed', id }),
    renameOutcome: (option, id) =>
      props.dispatch({ type: 'outcome/renamed', outcomeId: option.id, id }),
    setWording: (option, wording) =>
      props.dispatch({
        type: 'outcome/wording-changed',
        outcomeId: option.id,
        wording,
      }),
    setSeverity: (option, severity) =>
      props.dispatch({
        type: 'outcome/severity-changed',
        outcomeId: option.id,
        severity,
      }),
    removeOutcome: (option) =>
      props.dispatch({ type: 'outcome/removed', outcomeId: option.id }),
  });

  const cards = visible.map((/** @type {any} */ question) => {
    const baselineQuestion = props.baselineQuestions.find(
      (candidate) => candidate.id === question.id
    );
    const conditional =
      Boolean(question.showWhen) ||
      Boolean(props.conditionalQuestionIds?.includes(question.id));
    const render = () =>
      /** @type {HTMLElement} */ (
        QuestionCard({
          question,
          questionIndex: bank.questions.indexOf(question),
          bank,
          baselineQuestions: props.baselineQuestions,
          groupFilterActive: Boolean(filters.questionGroup),
          conditional,
          dispatch: props.dispatch,
        })
      );
    return props.memo
      ? props.memo(
          question.id,
          [
            question,
            bank.outcomeOptions,
            bank.labels,
            baselineQuestion,
            filters.questionGroup,
            conditional,
          ],
          render
        )
      : render();
  });

  return h(
    'section',
    { class: 'editor' },
    h(
      'div',
      { class: 'editor-head' },
      h(
        'h2',
        {},
        h('span', {}, bank.label),
        h(
          'span',
          { class: 'meta' },
          `${bank.questions.length} questions · slug: ${bank.slug}`
        )
      ),
      h(
        'div',
        { class: 'dirty-indicator' + (dirty ? ' is-dirty' : '') },
        h('span', { class: 'dirty-dot' }),
        h('span', {}, dirty ? 'Unsynced edits' : 'Clean · synced')
      )
    ),
    outcomeEditor,
    h(
      'div',
      {},
      ...(cards.length
        ? cards
        : [
            h(
              'div',
              { class: 'empty' },
              h('h3', {}, 'No questions match your filters.'),
              h('p', {}, 'Clear filters or add a new question below.')
            ),
          ])
    ),
    h(
      'button',
      { class: 'add-card', onClick: props.addQuestion },
      h('span', { class: 'plus' }, '+'),
      ' Draft a new question'
    )
  );
}
