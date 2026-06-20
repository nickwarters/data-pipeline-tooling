// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { h } from '../lib/html.js';
import { currentBank, filters, setFilters } from './question-bank-store.js';
import { escapeHtml } from './question-bank-compile.js';

export class CRBankRail extends ReactiveElement {
  render() {
    const bank = currentBank.get();
    const f = filters.get();
    /** @type {Record<string, number>} */
    const cats = {};
    for (const q of bank.questions) {
      const c = q.category || 'Uncategorised';
      cats[c] = (cats[c] || 0) + 1;
    }
    const catList = h('div');
    catList.appendChild(h('div', {
      className: 'filter-chip' + (f.category === null ? ' active' : ''),
      onClick: () => setFilters({ category: null }),
      innerHTML: `<span>All</span><span class="chip-count">${bank.questions.length}</span>`,
    }));
    for (const [name, n] of Object.entries(cats)) {
      catList.appendChild(h('div', {
        className: 'filter-chip' + (f.category === name ? ' active' : ''),
        onClick: () => setFilters({ category: name }),
        innerHTML: `<span>${escapeHtml(name)}</span><span class="chip-count">${n}</span>`,
      }));
    }
    const tDep = h('div', { className: 'toggle' + (f.showDeprecated ? ' on' : ''),
      onClick: () => setFilters({ showDeprecated: !f.showDeprecated }) });
    const tCond = h('div', { className: 'toggle' + (f.conditionalOnly ? ' on' : ''),
      onClick: () => setFilters({ conditionalOnly: !f.conditionalOnly }) });

    return h('aside', { className: 'rail' },
      h('div', { className: 'rail-section' },
        h('h3', {}, 'At a Glance'),
        h('div', { className: 'rail-stat' }, String(bank.questions.length).padStart(2, '0')),
        h('div', { className: 'rail-stat-label' }, 'Total Questions'),
      ),
      h('div', { className: 'rail-section' },
        h('h3', {}, 'Filter by Category'),
        catList,
      ),
      h('div', { className: 'rail-section' },
        h('h3', {}, 'View'),
        h('div', { className: 'toggle-row' }, h('span', {}, 'Show deprecated'), tDep),
        h('div', { className: 'toggle-row' }, h('span', {}, 'Show conditional only'), tCond),
      ),
      h('div', { className: 'rail-section' },
        h('h3', {}, 'Legend'),
        h('div', { className: 'rail-legend', innerHTML:
          '<div><span class="swatch active"></span>Active</div>' +
          '<div><span class="swatch deprecated"></span>Deprecated</div>' +
          '<div><span class="swatch conditional"></span>Conditional</div>'
        }),
      ),
    );
  }
}

customElements.define('cr-bank-rail', CRBankRail);
