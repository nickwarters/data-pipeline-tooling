// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import {
  activeSlug,
  commit,
  currentBank,
  filters,
  railOpen,
  setFilters,
} from './question-bank-store.js';
import {
  canMoveCategory,
  categoryKey,
  categoryOrder,
  moveCategory,
} from '../../lib/question-order.js';

/**
 * @param {{ bank: any, filters: any, railOpen: boolean, setFilters: (patch: any) => void, moveCategory: (name: string, direction: -1 | 1) => void, onToggleRail: () => void, onCloseRail: () => void }} props
 * @returns {Node[]}
 */
export function BankRail(props) {
  const bank = props.bank;
  const f = props.filters;
  // Selecting a category is the primary navigation action, so on narrow
  // viewports it dismisses the pop-over to reveal the filtered list.
  const selectCategory = (/** @type {string|null} */ category) => {
    props.setFilters({ category });
    props.onCloseRail();
  };
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
        onClick: () => selectCategory(null),
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
          onClick: () => selectCategory(name),
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
                props.moveCategory(name, -1);
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
                props.moveCategory(name, 1);
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
    onClick: () => props.setFilters({ showDeprecated: !f.showDeprecated }),
  });
  const tCond = h('div', {
    className: 'toggle' + (f.conditionalOnly ? ' on' : ''),
    onClick: () => props.setFilters({ conditionalOnly: !f.conditionalOnly }),
  });

  const aside = h(
    'aside',
    {
      id: 'bank-rail-panel',
      className: 'rail' + (props.railOpen ? ' open' : ''),
    },
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

  // The toggle button and backdrop only surface on narrow viewports (CSS
  // media query); on wide viewports they are hidden and the aside is a static
  // grid column. `data-focus-key` keeps focus on the toggle across the rail's
  // re-render when it flips the pop-over open/closed.
  const toggle = h(
    'button',
    {
      type: 'button',
      className: 'rail-toggle',
      'data-focus-key': 'bank-rail-toggle',
      'aria-expanded': props.railOpen ? 'true' : 'false',
      'aria-controls': 'bank-rail-panel',
      onClick: props.onToggleRail,
    },
    props.railOpen ? '✕ Filters' : '☰ Filters'
  );

  const backdrop = h('div', {
    className: 'rail-backdrop' + (props.railOpen ? ' open' : ''),
    'aria-hidden': 'true',
    onClick: props.onCloseRail,
  });

  return [aside, toggle, backdrop];
}

export class CORABankRail extends ShellElement {
  render() {
    return BankRail({
      bank: currentBank.get(),
      filters: filters.get(),
      railOpen: railOpen.get(),
      setFilters,
      moveCategory: (name, direction) =>
        commit((types) =>
          moveCategory(types[activeSlug.get()].questions, name, direction)
        ),
      onToggleRail: () => railOpen.set(!railOpen.get()),
      onCloseRail: () => {
        if (railOpen.get()) railOpen.set(false);
      },
    });
  }
}

customElements.define('cora-bank-rail', CORABankRail);
