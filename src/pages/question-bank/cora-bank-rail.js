// @ts-check
import { h } from '../../lib/html.js';
import {
  canMoveCategory,
  canMoveGroup,
  categoryKey,
  categoryOrder,
  groupKey,
  groupOrder,
} from '../../lib/question-order.js';

/**
 * A move up/down button pair for a rail chip.
 *
 * @param {string} label
 * @param {boolean} canUp
 * @param {boolean} canDown
 * @param {(direction: -1 | 1) => void} onMove
 * @returns {Node[]}
 */
function moveButtons(label, canUp, canDown, onMove) {
  return [
    h(
      'button',
      {
        className: 'icon-btn chip-move',
        title: `Move ${label} up`,
        'aria-label': `Move ${label} up`,
        disabled: !canUp,
        onClick: (/** @type {Event} */ e) => {
          e.stopPropagation?.();
          onMove(-1);
        },
      },
      '↑'
    ),
    h(
      'button',
      {
        className: 'icon-btn chip-move',
        title: `Move ${label} down`,
        'aria-label': `Move ${label} down`,
        disabled: !canDown,
        onClick: (/** @type {Event} */ e) => {
          e.stopPropagation?.();
          onMove(1);
        },
      },
      '↓'
    ),
  ];
}

/**
 * The filter rail: groups the bank's questions by `category` (top level,
 * shown only when any question declares one), then by `questionGroup` within
 * it (#390 Part 1). Selecting a chip filters the list; move buttons reorder
 * categories among themselves and Question Groups within their category.
 *
 * @param {{ bank: any, filters: any, railOpen: boolean, setFilters: (patch: any) => void, moveCategory: (name: string, direction: -1 | 1) => void, moveGroup: (category: string, name: string, direction: -1 | 1) => void, onToggleRail: () => void, onCloseRail: () => void }} props
 * @returns {Node[]}
 */
export function BankRail(props) {
  const bank = props.bank;
  const f = props.filters;
  // Selecting a chip is the primary navigation action, so on narrow
  // viewports it dismisses the pop-over to reveal the filtered list.
  const select = (
    /** @type {string|null} */ category,
    /** @type {string|null} */ questionGroup
  ) => {
    props.setFilters({ category, questionGroup });
    props.onCloseRail();
  };

  const questions = bank.questions;
  const hasCategories = questions.some((/** @type {any} */ q) => q.category);
  // Group chips render whenever any question declares a Question Group — or
  // when there are no categories either, so a flat bank still gets its
  // 'Uncategorised' chip. With categories only, per-category 'Uncategorised'
  // group chips would be pure noise.
  const hasGroups = questions.some((/** @type {any} */ q) => q.questionGroup);
  const showGroups = hasGroups || !hasCategories;
  const catList = h('div');
  catList.appendChild(
    h(
      'div',
      {
        className:
          'filter-chip' +
          (f.category === null && f.questionGroup === null ? ' active' : ''),
        onClick: () => select(null, null),
      },
      h('span', {}, 'All'),
      h('span', { className: 'chip-count' }, String(questions.length))
    )
  );

  const categories = categoryOrder(questions);
  for (const [i, catName] of categories.entries()) {
    const inCategory = questions.filter(
      (/** @type {any} */ q) => categoryKey(q) === catName
    );

    if (hasCategories) {
      catList.appendChild(
        h(
          'div',
          {
            className:
              'filter-chip chip-category' +
              (f.category === catName && f.questionGroup === null
                ? ' active'
                : ''),
            onClick: () => select(catName, null),
          },
          h('span', {}, catName),
          h(
            'span',
            { className: 'chip-meta' },
            h('span', { className: 'chip-count' }, String(inCategory.length)),
            ...moveButtons(
              `${catName} category`,
              i !== 0 && canMoveCategory(questions, catName, -1),
              i !== categories.length - 1 &&
                canMoveCategory(questions, catName, 1),
              (direction) => props.moveCategory(catName, direction)
            )
          )
        )
      );
    }

    const groups = showGroups ? groupOrder(inCategory) : [];
    for (const [j, groupName] of groups.entries()) {
      const n = inCategory.filter(
        (/** @type {any} */ q) => groupKey(q) === groupName
      ).length;
      catList.appendChild(
        h(
          'div',
          {
            className:
              'filter-chip' +
              (hasCategories ? ' chip-group' : '') +
              (f.questionGroup === groupName &&
              (!hasCategories || f.category === catName)
                ? ' active'
                : ''),
            onClick: () => select(hasCategories ? catName : null, groupName),
          },
          h('span', {}, groupName),
          h(
            'span',
            { className: 'chip-meta' },
            h('span', { className: 'chip-count' }, String(n)),
            ...moveButtons(
              `${groupName} question group`,
              j !== 0 && canMoveGroup(questions, catName, groupName, -1),
              j !== groups.length - 1 &&
                canMoveGroup(questions, catName, groupName, 1),
              (direction) => props.moveGroup(catName, groupName, direction)
            )
          )
        )
      );
    }
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
        String(questions.length).padStart(2, '0')
      ),
      h('div', { className: 'rail-stat-label' }, 'Total Questions')
    ),
    h(
      'div',
      { className: 'rail-section' },
      h('h3', {}, 'Filter by Grouping'),
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
