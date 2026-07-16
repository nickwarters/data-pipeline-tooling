// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_dom-stub.js';
import {
  fireEvent,
  getByTag,
  getByTestId,
  getByText,
  getByRole,
  queryAllByRole,
  queryAllByTag,
  queryByRole,
} from './helpers/semantic-dom.js';

installDom();
const { h } = await import('../src/lib/html.js');

test('semantic DOM helpers find controls by role and accessible name', () => {
  const root = new StubEl('div');
  root.append(
    /** @type {any} */ (h('button', {}, 'Save case')),
    /** @type {any} */ (
      h('input', { 'aria-label': 'Case reference', value: 'CR-1' })
    ),
    /** @type {any} */ (
      h('button', {
        role: 'switch',
        'aria-label': 'Include archived cases',
      })
    )
  );

  assert.equal(
    getByRole(root, 'button', { name: 'Save case' }).tagName,
    'BUTTON'
  );
  assert.equal(getByRole(root, 'textbox', { name: /reference/ }).value, 'CR-1');
  assert.equal(
    getByRole(root, 'switch', { name: 'Include archived cases' }).role,
    'switch'
  );
  assert.equal(queryAllByRole(root, 'button').length, 1);
  assert.equal(queryByRole(root, 'combobox'), null);
});

test('semantic DOM helpers reject ambiguous single-element queries', () => {
  const root = new StubEl('div');
  root.append(
    /** @type {any} */ (h('button', {}, 'First')),
    /** @type {any} */ (h('button', {}, 'Second'))
  );

  assert.throws(() => queryByRole(root, 'button'), /multiple elements/);
  assert.throws(() => getByRole(root, 'textbox'), /Unable to find/);
});

test('fireEvent dispatches through the public event API', () => {
  const button = /** @type {any} */ (h('button', {}, 'Save'));
  let clicks = 0;
  button.addEventListener('click', (/** @type {any} */ event) => {
    clicks += 1;
    assert.equal(event.target, button);
  });

  const event = fireEvent(button, 'click');

  assert.equal(clicks, 1);
  assert.equal(event.bubbles, true);
});

test('semantic DOM helpers query table structure by role and tag', () => {
  const root = /** @type {any} */ (
    h(
      'table',
      {},
      h('tbody', {}, h('tr', {}, h('td', {}, h('span', {}, 'Case A'))))
    )
  );

  assert.equal(queryAllByRole(root, 'rowgroup').length, 1);
  assert.equal(queryAllByRole(root, 'row').length, 1);
  assert.equal(queryAllByRole(root, 'cell').length, 1);
  assert.equal(getByTag(root, 'tbody').tagName, 'TBODY');
  assert.equal(queryAllByTag(root, 'span').length, 1);
  assert.equal(getByText(root, 'Case A').tagName, 'SPAN');
});

test('semantic DOM helpers use title as a fallback name and query test ids', () => {
  const root = new StubEl('div');
  root.append(
    /** @type {any} */ (h('button', { title: 'Duplicate question' })),
    /** @type {any} */ (h('div', { 'data-testid': 'conditional-indicator' }))
  );

  assert.equal(
    getByRole(root, 'button', { name: 'Duplicate question' }).title,
    'Duplicate question'
  );
  assert.equal(getByTestId(root, 'conditional-indicator').tagName, 'DIV');
});
