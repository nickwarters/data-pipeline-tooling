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
import { escapeHtml } from './question-bank-compile.js';

export class CRBankList extends ReactiveElement {
  render() {
    const bank = currentBank.get();
    const f = filters.get();
    const dirty = isDirty.get();
    const visible = bank.questions.filter((/** @type {any} */ q) => {
      if (!f.showDeprecated && q.deprecated) return false;
      if (f.category && q.category !== f.category) return false;
      if (f.conditionalOnly && !q.showWhen) return false;
      return true;
    });

    const head = h(
      'div',
      { className: 'editor-head' },
      h('h2', {
        innerHTML: `<span>${escapeHtml(bank.label)}</span><span class="meta">${bank.questions.length} questions · slug: ${escapeHtml(bank.slug)}</span>`,
      }),
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
        h('div', {
          className: 'empty',
          innerHTML:
            '<h3>No questions match your filters.</h3><p>Clear filters or add a new question below.</p>',
        })
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
      listRoot,
      h('button', {
        className: 'add-card',
        onClick: () => {
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
              /** @type {any} */ (this).querySelectorAll?.(
                'cr-question-card'
              ) ?? [];
            cards[cards.length - 1]?.scrollIntoView?.({
              behavior: 'smooth',
              block: 'center',
            });
          };
          if (typeof raf === 'function') raf(scroll);
          else scroll();
        },
        innerHTML: '<span class="plus">+</span> Draft a new question',
      })
    );
  }
}

customElements.define('cr-bank-list', CRBankList);
