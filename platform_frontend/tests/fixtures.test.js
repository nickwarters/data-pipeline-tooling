// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  makeCaseRow,
  makeChrome,
  makePermissions,
} from './helpers/fixtures.js';

test('makeCaseRow: two rows never share a mutable answers or conversation', () => {
  const first = makeCaseRow();
  const second = makeCaseRow();

  first.answers['q1'] = { value: 'Yes' };
  first.conversation.push({
    author: { loginName: 'someone', displayName: 'Someone Else' },
    timestamp: '2026-07-01T00:00:00Z',
    body: 'hello',
  });

  assert.deepEqual(second.answers, {});
  assert.deepEqual(second.conversation, []);
});

test('makeChrome: permission overrides compose with the Reviewer default', () => {
  const chrome = makeChrome({ permissions: { isControls: true } });

  assert.equal(chrome.permissions.isControls, true);
  assert.equal(chrome.permissions.isReviewer, true);
  assert.deepEqual(chrome.permissions, makePermissions({ isControls: true }));
});
