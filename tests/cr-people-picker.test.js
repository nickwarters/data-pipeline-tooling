// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== MINIMAL DOM STUBS (installed before importing the component) =====
class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    /** @type {Record<string, string>} */
    this._attrs = {};
    this.textContent = '';
    this.className = '';
    this.placeholder = '';
    this.value = '';
    this.hidden = false;
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    this._children = cs;
  }
  appendChild(/** @type {StubEl} */ c) {
    this._children.push(c);
    return c;
  }
  append(/** @type {StubEl[]} */ ...cs) {
    this._children.push(...cs);
  }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  dispatchEvent(/** @type {any} */ e) {
    (this._listeners[e.type] ?? []).forEach((h) => h(e));
    return true;
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    this._attrs[k] = v;
  }
  /** @param {string} ev fire a listener as if the user triggered it */
  _fire(/** @type {string} */ ev, /** @type {any} */ payload) {
    (this._listeners[ev] ?? []).forEach((h) => h(payload));
  }
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).document = {
  /** @param {string} _tag @returns {StubEl} */
  createElement(_tag) {
    return new StubEl();
  },
  addEventListener() {},
  removeEventListener() {},
};
/** @type {any} */ (globalThis).customElements = { define() {} };

class StubCustomEvent {
  /** @param {string} type @param {{ detail?: any, bubbles?: boolean }} [init] */
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail ?? null;
    this.bubbles = init?.bubbles ?? false;
  }
}
/** @type {any} */ (globalThis).CustomEvent = StubCustomEvent;

// ===== IMPORTS (after stubs) =====
const { CRPeoplePicker } =
  await import('../src/components/cr-people-picker.js');

/**
 * Build a fake client whose searchPeople resolves to `results` and records queries.
 * @param {Array<{loginName: string, displayName: string, email?: string}>} results
 */
function makeClient(results) {
  /** @type {string[]} */
  const queries = [];
  return {
    queries,
    /** @param {string} q */
    async searchPeople(q) {
      queries.push(q);
      return results;
    },
  };
}

function mount(/** @type {any} */ client = null) {
  const el = new CRPeoplePicker();
  if (client) el.client = /** @type {any} */ (client);
  el.connectedCallback();
  return el;
}

const input = (/** @type {any} */ el) => el._children[0];
const results = (/** @type {any} */ el) => el._children[1];

test('CRPeoplePicker: renders a search input with the cr- namespaced class and default placeholder', () => {
  const el = mount();
  assert.equal(input(el).className, 'cr-people-picker-input');
  assert.equal(input(el).placeholder, 'Search people…');
});

test('CRPeoplePicker: results list starts hidden and empty', () => {
  const el = mount();
  assert.equal(results(el).className, 'cr-people-picker-results');
  assert.equal(results(el).hidden, true);
  assert.equal(results(el)._children.length, 0);
});

test('CRPeoplePicker: search renders one option per person with "Display — account" label', async () => {
  const client = makeClient([
    { loginName: 'jsmith', displayName: 'John Smith' },
    { loginName: 'asmith', displayName: 'Anna Smith' },
  ]);
  const el = mount(client);
  await el._search('smith');

  assert.equal(client.queries[0], 'smith');
  assert.equal(results(el).hidden, false);
  const opts = results(el)._children;
  assert.equal(opts.length, 2);
  assert.equal(opts[0].textContent, 'John Smith — jsmith');
  assert.equal(opts[0].className, 'cr-people-picker-option');
});

test('CRPeoplePicker: clicking an option emits cr-person-selected with the bare account and clears the field', async () => {
  const client = makeClient([
    { loginName: 'jsmith', displayName: 'John Smith' },
  ]);
  const el = mount(client);
  /** @type {any[]} */
  const events = [];
  el.addEventListener('cr-person-selected', (e) => events.push(e));
  await el._search('john');

  results(el)._children[0]._fire('click');

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail, {
    loginName: 'jsmith',
    displayName: 'John Smith',
  });
  assert.equal(events[0].bubbles, true);
  assert.equal(input(el).value, '');
  assert.equal(results(el).hidden, true);
  assert.equal(results(el)._children.length, 0);
});

test('CRPeoplePicker: free-text fallback offers the typed text as a raw account when search finds nothing', async () => {
  const client = makeClient([]);
  const el = mount(client);
  /** @type {any[]} */
  const events = [];
  el.addEventListener('cr-person-selected', (e) => events.push(e));
  await el._search('contractor1');

  const opts = results(el)._children;
  assert.equal(results(el).hidden, false);
  assert.equal(opts.length, 1);
  assert.equal(opts[0].textContent, 'Use “contractor1” as account');

  opts[0]._fire('click');
  assert.deepEqual(events[0].detail, {
    loginName: 'contractor1',
    displayName: 'contractor1',
  });
});

test('CRPeoplePicker: a blank query clears the list without querying the client', async () => {
  const client = makeClient([
    { loginName: 'jsmith', displayName: 'John Smith' },
  ]);
  const el = mount(client);
  await el._search('   ');

  assert.equal(client.queries.length, 0);
  assert.equal(results(el).hidden, true);
  assert.equal(results(el)._children.length, 0);
});

test('CRPeoplePicker: with no client a non-empty query renders no options', async () => {
  const el = mount();
  await el._search('smith');
  assert.equal(results(el).hidden, true);
  assert.equal(results(el)._children.length, 0);
});

test('CRPeoplePicker: typing debounces and routes the query through client.searchPeople', async () => {
  const client = makeClient([
    { loginName: 'jsmith', displayName: 'John Smith' },
  ]);
  const el = mount(client);
  el.debounceMs = 0;

  input(el)._fire('input', { target: { value: 'jo' } });
  await new Promise((r) => setTimeout(r));
  await el._searchPromise;

  assert.deepEqual(client.queries, ['jo']);
  assert.equal(results(el)._children[0].textContent, 'John Smith — jsmith');
});

test('CRPeoplePicker: typing resets the debounce timer so only the latest query fires', async () => {
  const client = makeClient([]);
  const el = mount(client);
  el.debounceMs = 5;

  input(el)._fire('input', { target: { value: 'jo' } });
  input(el)._fire('input', { target: { value: 'john' } });
  await new Promise((r) => setTimeout(r, 10));
  await el._searchPromise;

  assert.deepEqual(client.queries, ['john']);
});

test('CRPeoplePicker: input with a null target value is treated as empty string', async () => {
  const client = makeClient([]);
  const el = mount(client);
  el.debounceMs = 0;

  input(el)._fire('input', { target: { value: null } });
  await new Promise((r) => setTimeout(r));
  await el._searchPromise;

  assert.equal(
    client.queries.length,
    0,
    'empty query short-circuits before the client call'
  );
});

test('CRPeoplePicker: honours a custom placeholder', () => {
  const el = new CRPeoplePicker();
  el.placeholder = 'Attribute to…';
  el.connectedCallback();
  assert.equal(input(el).placeholder, 'Attribute to…');
});

test('CRPeoplePicker: disconnectedCallback clears the pending debounce timer', async () => {
  const client = makeClient([
    { loginName: 'jsmith', displayName: 'John Smith' },
  ]);
  const el = mount(client);
  el.debounceMs = 5;

  input(el)._fire('input', { target: { value: 'jo' } });
  el.disconnectedCallback();
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(
    client.queries.length,
    0,
    'cancelled timer never reaches the client'
  );
});
