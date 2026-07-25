// @ts-check
import { h } from '../../lib/html.js';

/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../../sharepoint-client.js').PersonResult} PersonResult */

/**
 * @typedef {object} PeoplePickerProps
 * @property {string} placeholder
 * @property {PersonResult[]} people
 * @property {string} query
 * @property {string} inputValue
 * @property {(value: string) => void} onInput
 * @property {(person: { loginName: string, displayName: string }) => void} onSelect
 */

/**
 * Build the result option nodes for a query: one per match, or a single
 * raw-account fallback when a non-empty query returns nothing.
 *
 * @param {PersonResult[]} people
 * @param {string} query
 * @param {(person: { loginName: string, displayName: string }) => void} onSelect
 * @returns {HTMLElement[]}
 */
export function peoplePickerOptions(people, query, onSelect) {
  const items = people.map((p) =>
    peoplePickerOption(
      { loginName: p.loginName, displayName: p.displayName },
      `${p.displayName} — ${p.loginName}`,
      onSelect
    )
  );
  if (people.length === 0 && query !== '') {
    items.push(
      peoplePickerOption(
        { loginName: query, displayName: query },
        `Use “${query}” as account`,
        onSelect
      )
    );
  }
  return items;
}

/**
 * @param {PeoplePickerProps} props
 * @returns {Node[]}
 */
export function PeoplePicker(props) {
  const items = peoplePickerOptions(props.people, props.query, props.onSelect);

  const inputEl = h('input', {
    className: 'cora-people-picker-input',
    type: 'text',
    role: 'combobox',
    'aria-label': 'Search people',
    placeholder: props.placeholder,
    value: props.inputValue,
    oninput: (/** @type {any} */ ev) => {
      props.onInput(ev.target?.value ?? '');
    },
  });

  const resultsEl = h(
    'ul',
    {
      className: 'cora-people-picker-results',
      role: 'listbox',
      hidden: items.length === 0,
    },
    ...items
  );

  return [inputEl, resultsEl];
}

/**
 * @param {{ loginName: string, displayName: string }} person
 * @param {string} label
 * @param {(person: { loginName: string, displayName: string }) => void} onSelect
 * @returns {HTMLElement}
 */
export function peoplePickerOption(person, label, onSelect) {
  return h(
    'li',
    {
      className: 'cora-people-picker-option',
      role: 'option',
      onclick: () => onSelect(person),
    },
    label
  );
}

/**
 * @param {{ client: SharePointClient | null, renderResults(people: PersonResult[], query: string): void }} context
 * @param {string} query
 * @returns {Promise<void>}
 */
export async function searchPeople(context, query) {
  const q = query.trim();
  if (q === '' || !context.client) {
    context.renderResults([], '');
    return;
  }
  const people = await context.client.searchPeople(q);
  context.renderResults(people, q);
}
