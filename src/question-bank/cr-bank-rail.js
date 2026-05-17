// @ts-check
import { CRElement } from '../components/cr-element.js';
import { el, reactive } from './cr-bank-dom.js';
import { currentBank, filters, setFilters } from './question-bank-store.js';
import { escapeHtml } from './question-bank-compile.js';

export class CRBankRail extends CRElement {
  connectedCallback() { reactive(this, () => this._render()); }
  _render() {
    const bank = currentBank.get();
    const f = filters.get();
    /** @type {Record<string, number>} */
    const cats = {};
    for (const q of bank.questions) {
      const c = q.category || 'Uncategorised';
      cats[c] = (cats[c] || 0) + 1;
    }
    const catList = el('div');
    catList.appendChild(el('div', {
      class: 'filter-chip' + (f.category === null ? ' active' : ''),
      onclick: () => setFilters({ category: null }),
      html: `<span>All</span><span class="chip-count">${bank.questions.length}</span>`,
    }));
    for (const [name, n] of Object.entries(cats)) {
      catList.appendChild(el('div', {
        class: 'filter-chip' + (f.category === name ? ' active' : ''),
        onclick: () => setFilters({ category: name }),
        html: `<span>${escapeHtml(name)}</span><span class="chip-count">${n}</span>`,
      }));
    }
    const tDep = el('div', { class: 'toggle' + (f.showDeprecated ? ' on' : ''),
      onclick: () => setFilters({ showDeprecated: !f.showDeprecated }) });
    const tCond = el('div', { class: 'toggle' + (f.conditionalOnly ? ' on' : ''),
      onclick: () => setFilters({ conditionalOnly: !f.conditionalOnly }) });

    this.replaceChildren(el('aside', { class: 'rail' },
      el('div', { class: 'rail-section' },
        el('h3', {}, 'At a Glance'),
        el('div', { class: 'rail-stat' }, String(bank.questions.length).padStart(2, '0')),
        el('div', { class: 'rail-stat-label' }, 'Total Questions'),
      ),
      el('div', { class: 'rail-section' },
        el('h3', {}, 'Filter by Category'),
        catList,
      ),
      el('div', { class: 'rail-section' },
        el('h3', {}, 'View'),
        el('div', { class: 'toggle-row' }, el('span', {}, 'Show deprecated'), tDep),
        el('div', { class: 'toggle-row' }, el('span', {}, 'Show conditional only'), tCond),
      ),
      el('div', { class: 'rail-section' },
        el('h3', {}, 'Legend'),
        el('div', { class: 'rail-legend', html:
          '<div><span class="swatch active"></span>Active</div>' +
          '<div><span class="swatch deprecated"></span>Deprecated</div>' +
          '<div><span class="swatch conditional"></span>Conditional</div>'
        }),
      ),
    ));
  }
}

customElements.define('cr-bank-rail', CRBankRail);
