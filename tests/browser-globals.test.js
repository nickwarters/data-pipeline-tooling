// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';

const fixtureName = '__browserGlobalsFixture';
const addedName = '__browserGlobalsAdded';
const fixture = {
  location: { hash: '#/baseline' },
  listeners: { click: [() => 'baseline'] },
};

Object.defineProperty(globalThis, fixtureName, {
  configurable: true,
  enumerable: true,
  writable: true,
  value: fixture,
});
isolateBrowserGlobals([fixtureName, addedName]);

test('browser-global isolation restores direct and nested mutations', async (t) => {
  await t.test('permits mutations inside one test', () => {
    const current = /** @type {any} */ (globalThis)[fixtureName];
    current.location.hash = '#/changed';
    current.location.search = '?changed=1';
    current.listeners.click.push(() => 'changed');
    current.listeners.keydown = [() => 'added'];
    /** @type {any} */ (globalThis)[fixtureName] = { replaced: true };
    /** @type {any} */ (globalThis)[addedName] = 'test-only';

    assert.deepEqual(/** @type {any} */ (globalThis)[fixtureName], {
      replaced: true,
    });
  });

  await t.test('starts the next test from the file baseline', () => {
    const current = /** @type {any} */ (globalThis)[fixtureName];
    assert.equal(current, fixture, 'restores the original top-level object');
    assert.equal(current.location.hash, '#/baseline');
    assert.equal('search' in current.location, false);
    assert.equal(current.listeners.click.length, 1);
    assert.equal('keydown' in current.listeners, false);
    assert.equal(addedName in globalThis, false);
  });
});
