// @ts-check
import { CRElement } from './cr-element.js';
import { el, reactive } from './cr-bank-dom.js';
import { activeSlug, commit, currentBank, filters, isDirty } from './question-bank-store.js';
import { escapeHtml } from './question-bank-compile.js';

export class CRBankList extends CRElement {
  connectedCallback() { reactive(this, () => this._render()); }
  _render() {
    const bank = currentBank.get();
    const f = filters.get();
    const dirty = isDirty.get();
    const visible = bank.questions.filter((/** @type {any} */ q) => {
      if (!f.showDeprecated && q.deprecated) return false;
      if (f.category && q.category !== f.category) return false;
      if (f.conditionalOnly && !q.showWhen) return false;
      return true;
    });

    const head = el('div', { class: 'editor-head' },
      el('h2', { html: `<span>${escapeHtml(bank.label)}</span><span class="meta">${bank.questions.length} questions · slug: ${escapeHtml(bank.slug)}</span>` }),
      el('div', { class: 'dirty-indicator' + (dirty ? ' is-dirty' : '') },
        el('span', { class: 'dirty-dot' }),
        el('span', {}, dirty ? 'Unsynced edits' : 'Clean · synced'),
      ),
    );

    const listRoot = el('div');
    if (visible.length === 0) {
      listRoot.appendChild(el('div', { class: 'empty',
        html: '<h3>No questions match your filters.</h3><p>Clear filters or add a new question below.</p>' }));
    } else {
      visible.forEach((/** @type {any} */ q) => {
        const card = /** @type {any} */ (document.createElement('cr-question-card'));
        card.question = q;
        card.questionIndex = bank.questions.indexOf(q);
        listRoot.appendChild(card);
      });
    }

    this.replaceChildren(el('section', { class: 'editor' },
      head,
      listRoot,
      el('button', {
        class: 'add-card',
        onclick: () => {
          commit(types => {
            const b = types[activeSlug.get()];
            b.questions.push(/** @type {any} */ ({
              id: `q-new-${b.questions.length + 1}`,
              text: 'New question — click to edit',
              category: 'Uncategorised',
              responseType: 'yes-no-na',
              deprecated: false,
            }));
          });
          const raf = (/** @type {any} */ (globalThis)).requestAnimationFrame;
          const scroll = () => {
            const cards = /** @type {any} */ (this).querySelectorAll?.('cr-question-card') ?? [];
            cards[cards.length - 1]?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
          };
          if (typeof raf === 'function') raf(scroll);
          else scroll();
        },
        html: '<span class="plus">+</span> Draft a new question',
      }),
    ));
  }
}

customElements.define('cr-bank-list', CRBankList);
