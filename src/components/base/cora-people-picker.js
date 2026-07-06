// @ts-check
import { ShellElement } from '../../lib/view.js';
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
    class: 'cora-people-picker-input',
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
      class: 'cora-people-picker-results',
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
      class: 'cora-people-picker-option',
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

export class CORAPeoplePicker extends ShellElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {string} */
    this.placeholder = 'Search people…';
    /** @type {number} */
    this.debounceMs = 200;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this._timer = undefined;
    /** @type {Promise<void> | undefined} */
    this._searchPromise = undefined;

    // Internal state for rendering
    /** @type {PersonResult[]} */
    this._people = [];
    /** @type {string} */
    this._query = '';
    /** @type {string} */
    this._inputValue = '';
    /** @type {HTMLElement | null} */
    this._input = null;
    /** @type {HTMLElement | null} */
    this._results = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._render();
  }

  _render() {
    this.replaceChildren(...this.render());
  }

  render() {
    const nodes = PeoplePicker({
      placeholder: this.placeholder,
      people: this._people,
      query: this._query,
      inputValue: this._inputValue,
      onInput: (value) => this._queueSearch(value),
      onSelect: (person) => this._select(person),
    });
    this._input = /** @type {HTMLElement} */ (nodes[0]);
    this._results = /** @type {HTMLElement} */ (nodes[1]);
    return nodes;
  }

  /** @param {string} value */
  _queueSearch(value) {
    this._inputValue = value;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._searchPromise = this._search(value);
    }, this.debounceMs);
  }

  /**
   * @param {string} query
   * @returns {Promise<void>}
   */
  async _search(query) {
    await searchPeople(
      {
        client: this.client,
        renderResults: (people, q) => this._renderResults(people, q),
      },
      query
    );
  }

  /**
   * Refresh only the results list, leaving the search input untouched. A
   * background search resolving must not rebuild the input the reviewer is
   * typing into — replacing that node would drop focus and the caret
   * (issue: focus lost while typing).
   *
   * `connectedCallback` renders once before any search or selection can run, so
   * `_results` is always present here.
   *
   * @param {PersonResult[]} people
   * @param {string} query
   */
  _renderResults(people, query) {
    this._people = people;
    this._query = query;
    const options = peoplePickerOptions(people, query, (person) =>
      this._select(person)
    );
    /** @type {any} */ (this._results).replaceChildren(...options);
    /** @type {any} */ (this._results).hidden = options.length === 0;
  }

  /** @param {{ loginName: string, displayName: string }} person */
  _select(person) {
    this.dispatchEvent(
      new CustomEvent('cora-person-selected', {
        detail: {
          loginName: person.loginName,
          displayName: person.displayName,
        },
        bubbles: true,
      })
    );
    this._inputValue = '';
    if (this._input) {
      /** @type {HTMLInputElement} */ (this._input).value = '';
    }
    this._renderResults([], '');
  }

  disconnectedCallback() {
    clearTimeout(this._timer);
    super.disconnectedCallback();
  }
}

customElements.define('cora-people-picker', CORAPeoplePicker);
