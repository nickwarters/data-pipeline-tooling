// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  queryAllByRole,
} from './helpers/semantic-dom.js';

installDom();

const { PeoplePicker, peoplePickerOptions, searchPeople } =
  await import('../src/components/base/cora-people-picker.js');

const PERSON = { loginName: 'jsmith', displayName: 'Jane Smith' };

test('PeoplePicker wraps input and results in one positioned control', () => {
  // The results list is `position: absolute`; the wrapper is its containing
  // block. Returning a loose [input, results] array left that containing block
  // to whatever the caller happened to spread the pair into.
  const host = /** @type {any} */ (
    PeoplePicker({
      placeholder: '',
      people: [],
      query: '',
      inputValue: '',
      onQueryInput() {},
      onSelect() {},
    })
  );
  assert.equal(host.tagName?.toLowerCase(), 'div');
  assert.equal(host.className, 'cora-people-picker');
  assert.ok(getByRole(host, 'combobox'));
  assert.ok(getByRole(host, 'listbox'));
});

test('PeoplePicker renders an accessible input and hidden empty result list', () => {
  /** @type {string[]} */
  const inputs = [];
  const host = PeoplePicker({
    placeholder: 'Find a colleague',
    people: [],
    query: '',
    inputValue: 'Jan',
    onQueryInput: (value) => inputs.push(value),
    onSelect() {},
  });
  const input = /** @type {any} */ (getByRole(host, 'combobox'));
  assert.equal(input.placeholder, 'Find a colleague');
  assert.equal(input.value, 'Jan');
  input.value = 'Jane';
  fireEvent(input, 'input');
  fireEvent(input, 'input', { target: {} });
  assert.deepEqual(inputs, ['Jane', '']);
  assert.equal(getByRole(host, 'listbox').hidden, true);
});

test('PeoplePicker renders one selectable option per search result', () => {
  /** @type {any[]} */
  const selected = [];
  const host = PeoplePicker({
    placeholder: '',
    people: [PERSON],
    query: 'Jane',
    inputValue: 'Jane',
    onQueryInput() {},
    onSelect: (person) => selected.push(person),
  });
  const [option] = queryAllByRole(host, 'option');
  assert.equal(option.textContent, 'Jane Smith — jsmith');
  fireEvent(option, 'click');
  assert.deepEqual(selected, [PERSON]);
  assert.equal(getByRole(host, 'listbox').hidden, false);
});

test('peoplePickerOptions offers a raw-account fallback only for a non-empty query', () => {
  assert.equal(peoplePickerOptions([], '', () => {}).length, 0);
  const [fallback] = peoplePickerOptions([], 'someone', () => {});
  assert.equal(fallback.textContent, 'Use “someone” as account');
});

test('searchPeople trims and forwards a query before rendering results', async () => {
  /** @type {any[]} */
  const calls = [];
  await searchPeople(
    {
      client: /** @type {any} */ ({
        async searchPeople(/** @type {string} */ query) {
          calls.push(query);
          return [PERSON];
        },
      }),
      renderResults: (
        /** @type {any[]} */ people,
        /** @type {string} */ query
      ) => calls.push([people, query]),
    },
    ' Jane '
  );
  assert.deepEqual(calls, ['Jane', [[PERSON], 'Jane']]);
});

test('searchPeople clears results without querying for blank input or a missing client', async () => {
  /** @type {any[]} */
  const rendered = [];
  const renderResults = (
    /** @type {any[]} */ people,
    /** @type {string} */ query
  ) => rendered.push([people, query]);
  await searchPeople(
    {
      client: /** @type {any} */ ({ searchPeople: assert.fail }),
      renderResults,
    },
    '   '
  );
  await searchPeople({ client: null, renderResults }, 'Jane');
  assert.deepEqual(rendered, [
    [[], ''],
    [[], ''],
  ]);
});
