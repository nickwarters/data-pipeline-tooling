// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').PersonResult} PersonResult */

export class CRPeoplePicker extends ReactiveElement {
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
    // ReactiveElement's connectedCallback will call render() inside an effect,
    // but since we don't use signals here, we do an initial render manually.
    super.connectedCallback();
    this._render();
  }

  _render() {
    const content = this.render();
    if (content !== undefined) {
      if (Array.isArray(content)) this.replaceChildren(...content);
      else this.replaceChildren(content);
    }
  }

  render() {
    const items = this._people.map((p) =>
      this._option(
        { loginName: p.loginName, displayName: p.displayName },
        `${p.displayName} — ${p.loginName}`
      )
    );
    if (this._people.length === 0 && this._query !== '') {
      items.push(
        this._option(
          { loginName: this._query, displayName: this._query },
          `Use “${this._query}” as account`
        )
      );
    }

    const inputEl = h('input', {
      class: 'cr-people-picker-input',
      type: 'text',
      role: 'combobox',
      'aria-label': 'Search people',
      placeholder: this.placeholder,
      value: this._inputValue,
      oninput: (/** @type {any} */ ev) => {
        const value = ev.target?.value ?? '';
        this._inputValue = value;
        clearTimeout(this._timer);
        this._timer = setTimeout(() => {
          this._searchPromise = this._search(value);
        }, this.debounceMs);
      },
    });
    this._input = inputEl;

    const resultsEl = h(
      'ul',
      {
        class: 'cr-people-picker-results',
        role: 'listbox',
        hidden: items.length === 0,
      },
      ...items
    );
    this._results = resultsEl;

    return [inputEl, resultsEl];
  }

  /**
   * @param {string} query
   * @returns {Promise<void>}
   */
  async _search(query) {
    const q = query.trim();
    if (q === '' || !this.client) {
      this._renderResults([], '');
      return;
    }
    const people = await this.client.searchPeople(q);
    this._renderResults(people, q);
  }

  /**
   * @param {PersonResult[]} people
   * @param {string} query
   */
  _renderResults(people, query) {
    this._people = people;
    this._query = query;
    this._render();
  }

  /**
   * @param {{ loginName: string, displayName: string }} person
   * @param {string} label
   * @returns {HTMLElement}
   */
  _option(person, label) {
    return h(
      'li',
      {
        class: 'cr-people-picker-option',
        role: 'option',
        onclick: () => this._select(person),
      },
      label
    );
  }

  /** @param {{ loginName: string, displayName: string }} person */
  _select(person) {
    this.dispatchEvent(
      new CustomEvent('cr-person-selected', {
        detail: {
          loginName: person.loginName,
          displayName: person.displayName,
        },
        bubbles: true,
      })
    );
    this._inputValue = '';
    this._renderResults([], '');
  }

  disconnectedCallback() {
    clearTimeout(this._timer);
    super.disconnectedCallback();
  }
}

customElements.define('cr-people-picker', CRPeoplePicker);
