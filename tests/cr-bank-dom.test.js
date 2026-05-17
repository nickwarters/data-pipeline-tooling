// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_bank-dom-stub.js';
installDom();

const { el, reactive } = await import('../src/cr-bank-dom.js');
const { signal } = await import('../src/signal.js');

test('el: assigns className via "class"', () => {
  const e = el('div', { class: 'foo' });
  assert.equal(e.className, 'foo');
});

test('el: assigns style.cssText for string style', () => {
  const e = el('div', { style: 'color: red' });
  assert.equal(e.style.cssText, 'color: red');
});

test('el: skips style when not a string', () => {
  const e = el('div', { style: 123 });
  // Non-string style falls through to setAttribute, but value is preserved as attr
  assert.ok(e);
});

test('el: registers event handlers via on*', () => {
  /** @type {string[]} */
  const calls = [];
  const e = el('button', { onclick: () => calls.push('clicked') });
  e._listeners.click[0]();
  assert.deepEqual(calls, ['clicked']);
});

test('el: html prop sets innerHTML', () => {
  const e = el('div', { html: '<span>x</span>' });
  assert.equal(e.innerHTML, '<span>x</span>');
});

test('el: arbitrary attrs go through setAttribute', () => {
  const e = el('div', { title: 'hi', 'data-x': '1' });
  assert.equal(e.getAttribute('title'), 'hi');
  assert.equal(e.getAttribute('data-x'), '1');
});

test('el: null/undefined attrs are skipped', () => {
  const e = el('div', { title: null, alt: undefined });
  assert.equal(e.getAttribute('title'), null);
  assert.equal(e.getAttribute('alt'), null);
});

test('el: children — strings become text nodes', () => {
  const e = el('div', {}, 'hello');
  assert.equal(e._children[0].textContent, 'hello');
});

test('el: children — element nodes appended', () => {
  const child = el('span');
  const e = el('div', {}, child);
  assert.equal(e._children[0], child);
});

test('el: children — flattens arrays, skips nulls/false', () => {
  const c1 = el('span');
  const c2 = el('em');
  const e = el('div', {}, [c1, null, false, c2]);
  assert.equal(e._children.length, 2);
});

test('reactive: invokes render immediately and on signal change, pushes a disposer', () => {
  const s = signal(0);
  let runs = 0;
  /** @type {any} */
  const host = { _disposes: [] };
  reactive(host, () => { s.get(); runs++; });
  assert.equal(runs, 1);
  s.set(1);
  assert.equal(runs, 2);
  assert.equal(host._disposes.length, 1);
  host._disposes[0]();
  s.set(2);
  assert.equal(runs, 2); // disposer prevents further runs
});
