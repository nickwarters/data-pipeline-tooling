// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { h } from '../lib/html.js';
import {
  activeSlug,
  commit,
  currentBank,
  filters,
  isDirty,
} from './question-bank-store.js';

/**
 * @param {{ bank: any, filters: any, dirty: boolean, addQuestion: () => void }} props
 * @returns {HTMLElement}
 */
export function BankList(props) {
  const { bank, dirty } = props;
  const f = props.filters;
  const visible = bank.questions.filter((/** @type {any} */ q) => {
    if (!f.showDeprecated && q.deprecated) return false;
    if (f.category && q.category !== f.category) return false;
    if (f.conditionalOnly && !q.showWhen) return false;
    return true;
  });

  const head = h(
    'div',
    { className: 'editor-head' },
    h(
      'h2',
      {},
      h('span', {}, bank.label),
      h(
        'span',
        { className: 'meta' },
        `${bank.questions.length} questions · slug: ${bank.slug}`
      )
    ),
    h(
      'div',
      { className: 'dirty-indicator' + (dirty ? ' is-dirty' : '') },
      h('span', { className: 'dirty-dot' }),
      h('span', {}, dirty ? 'Unsynced edits' : 'Clean · synced')
    )
  );

  const listRoot = h('div');
  if (visible.length === 0) {
    listRoot.appendChild(
      h(
        'div',
        { className: 'empty' },
        h('h3', {}, 'No questions match your filters.'),
        h('p', {}, 'Clear filters or add a new question below.')
      )
    );
  } else {
    visible.forEach((/** @type {any} */ q) => {
      const card = /** @type {any} */ (
        document.createElement('cr-question-card')
      );
      card.question = q;
      card.bankQuestions = bank.questions;
      card.questionIndex = bank.questions.indexOf(q);
      listRoot.appendChild(card);
    });
  }

  return h(
    'section',
    { className: 'editor' },
    head,
    /** @type {any} */ (document.createElement('cr-outcome-options-editor')),
    listRoot,
    h(
      'button',
      {
        className: 'add-card',
        onClick: () => {
          props.addQuestion();
        },
      },
      h('span', { className: 'plus' }, '+'),
      ' Draft a new question'
    )
  );
}

export class CRBankList extends ReactiveElement {
  render() {
    return BankList({
      bank: currentBank.get(),
      filters: filters.get(),
      dirty: isDirty.get(),
      addQuestion: () => this._addQuestion(),
    });
  }

  _addQuestion() {
    commit((types) => {
      const b = types[activeSlug.get()];
      b.questions.push(
        /** @type {any} */ ({
          id: `q-new-${b.questions.length + 1}`,
          text: 'New question — click to edit',
          category: 'Uncategorised',
          responseType: 'yes-no-na',
          deprecated: false,
        })
      );
    });
    const raf = /** @type {any} */ (globalThis).requestAnimationFrame;
    const scroll = () => {
      const cards =
        /** @type {any} */ (this).querySelectorAll?.('cr-question-card') ?? [];
      cards[cards.length - 1]?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'center',
      });
    };
    if (typeof raf === 'function') raf(scroll);
    else scroll();
  }
}

customElements.define('cr-bank-list', CRBankList);
