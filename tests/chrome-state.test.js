// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';

isolateBrowserGlobals();

import { createChromeState } from '../src/core/chrome-state.js';

test('createChromeState: defines the shared store home for app chrome', () => {
  const currentUser = { id: 'u1', displayName: 'A User' };
  const permissions = /** @type {any} */ ({ isReviewer: true });

  assert.deepEqual(createChromeState({ currentUser, permissions }), {
    currentUser,
    permissions,
  });
});
