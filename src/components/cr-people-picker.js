// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').PersonResult} PersonResult */

/**
 * Standalone, reusable people picker (ADR-0013). Type-ahead that queries the
 * directory through the `SharePointClient` (never `fetch` directly) and emits
 * the chosen bare account as a `cr-person-selected` event. Offers a free-text
 * raw-account fallback when the search returns nothing.
 */
export class CRPeoplePicker extends CRElement {
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
    // Set to the in-flight search promise so tests can await the debounced query.
    /** @type {Promise<void> | undefined} */
    this._searchPromise = undefined;
    /** @type {HTMLInputElement} */
    this._input = /** @type {any} */ (null);
    /** @type {HTMLElement} */
    this._results = /** @type {any} */ (null);
  }

  connectedCallback() {
    const inputEl = document.createElement('input');
    inputEl.className = 'cr-people-picker-input';
    inputEl.setAttribute('type', 'text');
    inputEl.setAttribute('role', 'combobox');
    inputEl.setAttribute('aria-label', 'Search people');
    /** @type {any} */ (inputEl).placeholder = this.placeholder;
    inputEl.addEventListener('input', (ev) => {
      const value = /** @type {any} */ (ev).target?.value ?? '';
      clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        this._searchPromise = this._search(value);
      }, this.debounceMs);
    });

    const resultsEl = document.createElement('ul');
    resultsEl.className = 'cr-people-picker-results';
    resultsEl.setAttribute('role', 'listbox');
    /** @type {any} */ (resultsEl).hidden = true;

    this._input = inputEl;
    this._results = resultsEl;
    this.replaceChildren(/** @type {any} */ (inputEl), /** @type {any} */ (resultsEl));
  }

  /**
   * @param {string} query
   * @returns {Promise<void>}
   */
  async _search(query) {
    const q = query.trim();
    // Nothing to search yet: render empty (no free-text fallback until a real
    // search actually comes back with no matches).
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
    const items = people.map(p =>
      this._option({ loginName: p.loginName, displayName: p.displayName }, `${p.displayName} — ${p.loginName}`)
    );
    if (people.length === 0 && query !== '') {
      // Free-text fallback (Option C): treat the typed text as a raw bare account.
      items.push(
        this._option({ loginName: query, displayName: query }, `Use “${query}” as account`)
      );
    }
    /** @type {any} */ (this._results).hidden = items.length === 0;
    this._results.replaceChildren(...items);
  }

  /**
   * @param {{ loginName: string, displayName: string }} person
   * @param {string} label
   * @returns {HTMLElement}
   */
  _option(person, label) {
    const li = document.createElement('li');
    li.className = 'cr-people-picker-option';
    li.textContent = label;
    li.setAttribute('role', 'option');
    li.addEventListener('click', () => this._select(person));
    return /** @type {any} */ (li);
  }

  /** @param {{ loginName: string, displayName: string }} person */
  _select(person) {
    this.dispatchEvent(
      new CustomEvent('cr-person-selected', {
        detail: { loginName: person.loginName, displayName: person.displayName },
        bubbles: true,
      })
    );
    /** @type {any} */ (this._input).value = '';
    this._renderResults([], '');
  }

  disconnectedCallback() {
    clearTimeout(this._timer);
    super.disconnectedCallback();
  }
}

customElements.define('cr-people-picker', CRPeoplePicker);
