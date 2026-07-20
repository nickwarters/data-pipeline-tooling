// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';

isolateBrowserGlobals();

import {
  bindChromeNavigation,
  createChromeState,
} from '../src/core/chrome-state.js';

test('createChromeState: defines the shared store home for app chrome', () => {
  const currentUser = { id: 'u1', displayName: 'A User' };
  const permissions = /** @type {any} */ ({ isReviewer: true });

  assert.deepEqual(createChromeState({ currentUser, permissions }), {
    toasts: [],
    nav: { currentHash: '#/' },
    currentUser,
    permissions,
  });
});

test('createChromeState: captures the current route for nav state', () => {
  const chrome = createChromeState({
    currentUser: { id: 'u1', displayName: 'A User' },
    permissions: /** @type {any} */ ({}),
    currentHash: '#/question-bank',
  });

  assert.equal(chrome.nav.currentHash, '#/question-bank');
});

test('bindChromeNavigation: keeps nav state current and removes its listener', () => {
  const target = new EventTarget();
  let currentHash = '#/';
  const chrome = createChromeState({
    currentUser: { id: 'u1', displayName: 'A User' },
    permissions: /** @type {any} */ ({}),
  });
  const dispose = bindChromeNavigation(chrome, {
    target,
    readHash: () => currentHash,
  });

  currentHash = '#/question-bank';
  target.dispatchEvent(new Event('hashchange'));
  assert.equal(chrome.nav.currentHash, '#/question-bank');

  dispose();
  currentHash = '#/dashboard';
  target.dispatchEvent(new Event('hashchange'));
  assert.equal(chrome.nav.currentHash, '#/question-bank');
});

test('bindChromeNavigation: default browser binding normalises an empty hash', () => {
  const originalWindow = /** @type {any} */ (globalThis).window;
  const originalLocation = /** @type {any} */ (globalThis).location;
  const target = new EventTarget();
  /** @type {any} */ (globalThis).window = target;
  /** @type {any} */ (globalThis).location = { hash: '' };
  const chrome = createChromeState({
    currentUser: { id: 'u1', displayName: 'A User' },
    permissions: /** @type {any} */ ({}),
    currentHash: '#/question-bank',
  });

  try {
    const dispose = bindChromeNavigation(chrome);
    target.dispatchEvent(new Event('hashchange'));
    assert.equal(chrome.nav.currentHash, '#/');
    dispose();
  } finally {
    /** @type {any} */ (globalThis).window = originalWindow;
    /** @type {any} */ (globalThis).location = originalLocation;
  }
});
