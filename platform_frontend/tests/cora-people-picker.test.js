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

const { PeoplePicker } =
  await import('../src/components/base/cora-people-picker.js');

const PERSON = { loginName: 'jsmith', displayName: 'Jane Smith' };

/**
 * @param {Partial<import('../src/components/base/cora-people-picker.js').PeoplePickerProps>} [overrides]
 * @returns {import('../src/components/base/cora-people-picker.js').PeoplePickerProps}
 */
function props(overrides = {}) {
  return {
    placeholder: '',
    people: [],
    status: 'idle',
    inputValue: '',
    onQueryInput() {},
    onSelect() {},
    ...overrides,
  };
}

/** @param {HTMLElement} host */
function statusLine(host) {
  return /** @type {any} */ (host).querySelector('.cora-people-picker-status');
}

/** @param {HTMLElement} host */
function statusText(host) {
  return statusLine(host).textContent;
}

test('PeoplePicker wraps input and results in one positioned control', () => {
  // The results list is `position: absolute`; the wrapper is its containing
  // block. Returning a loose [input, results] array left that containing block
  // to whatever the caller happened to spread the pair into.
  const host = /** @type {any} */ (PeoplePicker(props()));
  assert.equal(host.tagName?.toLowerCase(), 'div');
  assert.equal(host.className, 'cora-people-picker');
  assert.ok(getByRole(host, 'combobox'));
  assert.ok(getByRole(host, 'listbox'));
});

test('PeoplePicker renders an accessible input and hidden empty result list', () => {
  /** @type {string[]} */
  const inputs = [];
  const host = PeoplePicker(
    props({
      placeholder: 'Find a colleague',
      inputValue: 'Jan',
      onQueryInput: (value) => inputs.push(value),
    })
  );
  const input = /** @type {any} */ (
    getByRole(host, 'combobox', { name: 'Search people' })
  );
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
  const host = PeoplePicker(
    props({
      people: [PERSON],
      status: 'success',
      inputValue: 'Jane',
      onSelect: (person) => selected.push(person),
    })
  );
  const [option] = queryAllByRole(host, 'option');
  assert.equal(option.textContent, 'Jane Smith — jsmith');
  fireEvent(option, 'click');
  assert.deepEqual(selected, [PERSON]);
  assert.equal(getByRole(host, 'listbox').hidden, false);
  assert.equal(statusText(host), '');
  assert.equal(statusLine(host).getAttribute('aria-hidden'), 'true');
});

test('no option is ever offered for an empty result set, whatever the status', () => {
  for (const status of /** @type {const} */ ([
    'idle',
    'loading',
    'success',
    'error',
  ])) {
    assert.equal(
      queryAllByRole(
        PeoplePicker(props({ status, inputValue: 'someone' })),
        'option'
      ).length,
      0,
      `${status} offered a selectable option for an unmatched query`
    );
  }
});

test('a search in flight says so rather than reading as an empty directory', () => {
  const host = PeoplePicker(
    props({ status: 'loading', inputValue: 'someone' })
  );
  assert.ok(statusLine(host));
  assert.equal(statusText(host), 'Searching…');
  assert.equal(statusLine(host).getAttribute('aria-hidden'), null);
});

test('a directory that answers with nothing is reported as no matches', () => {
  const host = PeoplePicker(
    props({ status: 'success', inputValue: 'someone' })
  );
  assert.ok(statusLine(host));
  assert.equal(statusText(host), 'No matches');
  assert.equal(statusLine(host).getAttribute('aria-hidden'), null);
});

test('a cleared box makes no claim about matches it never asked for', () => {
  const host = PeoplePicker(props({ status: 'idle' }));
  assert.ok(statusLine(host));
  assert.equal(statusText(host), '');
  assert.equal(statusLine(host).getAttribute('aria-hidden'), 'true');
});

test('a failed search is named as a failure, not as an empty directory', () => {
  const host = PeoplePicker(props({ status: 'error', inputValue: 'someone' }));
  assert.ok(statusLine(host));
  assert.equal(statusText(host), 'Directory search is unavailable');
  assert.equal(statusLine(host).getAttribute('aria-hidden'), null);
});

test('a picker names its input for the field it belongs to', () => {
  // The default name says only that the control searches people. A picker whose
  // surroundings do not say which field it fills supplies its own.
  const named = PeoplePicker(
    props({ ariaLabel: 'Search people for Responsible Party' })
  );
  assert.ok(
    getByRole(named, 'combobox', {
      name: 'Search people for Responsible Party',
    })
  );
});
