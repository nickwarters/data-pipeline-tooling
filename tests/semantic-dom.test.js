// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  queryAllByRole,
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
