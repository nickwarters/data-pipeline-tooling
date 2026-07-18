// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createChromeState } from '../src/core/chrome-state.js';

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
    currentHash: '#/reports',
  });

  assert.equal(chrome.nav.currentHash, '#/reports');
});
