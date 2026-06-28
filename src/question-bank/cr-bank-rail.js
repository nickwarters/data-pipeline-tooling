// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { h } from '../lib/html.js';
import {
  activeSlug,
  commit,
  currentBank,
  filters,
  setFilters,
} from './question-bank-store.js';
import {
  canMoveCategory,
  categoryKey,
  categoryOrder,
  moveCategory,
} from './question-bank-order.js';

// TODO(simplify-ui): Convert this class-backed custom element to the simpler
// function-component model. The target shape is a plain function returning h()
// nodes, wrapped in reactive() only when local signals need to re-render; keep
// custom elements only for route or browser-integration shells.
export class CRBankRail extends ReactiveElement {
  render() {
    const bank = currentBank.get();
    const f = filters.get();
    const order = categoryOrder(bank.questions);
    /** @type {Map<string, number>} */
    const cats = new Map(order.map((name) => [name, 0]));
    for (const q of bank.questions) {
      const c = categoryKey(q);
      cats.set(c, (cats.get(c) || 0) + 1);
    }
    const catList = h('div');
    catList.appendChild(
      h(
        'div',
        {
          className: 'filter-chip' + (f.category === null ? ' active' : ''),
          onClick: () => setFilters({ category: null }),
        },
        h('span', {}, 'All'),
        h('span', { className: 'chip-count' }, String(bank.questions.length))
      )
    );
    for (const [i, name] of order.entries()) {
      const n = cats.get(name) || 0;
      catList.appendChild(
        h(
          'div',
          {
            className: 'filter-chip' + (f.category === name ? ' active' : ''),
            onClick: () => setFilters({ category: name }),
          },
          h('span', {}, name),
          h(
            'span',
            { className: 'chip-meta' },
            h('span', { className: 'chip-count' }, String(n)),
            h(
              'button',
              {
                className: 'icon-btn chip-move',
                title: `Move ${name} category up`,
                'aria-label': `Move ${name} category up`,
                disabled: i === 0 || !canMoveCategory(bank.questions, name, -1),
                onClick: (/** @type {Event} */ e) => {
                  e.stopPropagation?.();
                  commit((types) =>
                    moveCategory(types[activeSlug.get()].questions, name, -1)
                  );
                },
              },
              '↑'
            ),
            h(
              'button',
              {
                className: 'icon-btn chip-move',
                title: `Move ${name} category down`,
                'aria-label': `Move ${name} category down`,
                disabled:
                  i === order.length - 1 ||
                  !canMoveCategory(bank.questions, name, 1),
                onClick: (/** @type {Event} */ e) => {
                  e.stopPropagation?.();
                  commit((types) =>
                    moveCategory(types[activeSlug.get()].questions, name, 1)
                  );
                },
              },
              '↓'
            )
          )
        )
      );
    }
    const tDep = h('div', {
      className: 'toggle' + (f.showDeprecated ? ' on' : ''),
      onClick: () => setFilters({ showDeprecated: !f.showDeprecated }),
    });
    const tCond = h('div', {
      className: 'toggle' + (f.conditionalOnly ? ' on' : ''),
      onClick: () => setFilters({ conditionalOnly: !f.conditionalOnly }),
    });

    return h(
      'aside',
      { className: 'rail' },
      h(
        'div',
        { className: 'rail-section' },
        h('h3', {}, 'At a Glance'),
        h(
          'div',
          { className: 'rail-stat' },
          String(bank.questions.length).padStart(2, '0')
        ),
        h('div', { className: 'rail-stat-label' }, 'Total Questions')
      ),
      h(
        'div',
        { className: 'rail-section' },
        h('h3', {}, 'Filter by Category'),
        catList
      ),
      h(
        'div',
        { className: 'rail-section' },
        h('h3', {}, 'View'),
        h(
          'div',
          { className: 'toggle-row' },
          h('span', {}, 'Show deprecated'),
          tDep
        ),
        h(
          'div',
          { className: 'toggle-row' },
          h('span', {}, 'Show conditional only'),
          tCond
        )
      ),
      h(
        'div',
        { className: 'rail-section' },
        h('h3', {}, 'Legend'),
        h(
          'div',
          { className: 'rail-legend' },
          h('div', {}, h('span', { className: 'swatch active' }), 'Active'),
          h(
            'div',
            {},
            h('span', { className: 'swatch deprecated' }),
            'Deprecated'
          ),
          h(
            'div',
            {},
            h('span', { className: 'swatch conditional' }),
            'Conditional'
          )
        )
      )
    );
  }
}

customElements.define('cr-bank-rail', CRBankRail);
