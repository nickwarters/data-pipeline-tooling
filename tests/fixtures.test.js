// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  makeCaseRow,
  makeChrome,
  makePermissions,
  REVIEWER,
} from './helpers/fixtures.js';

test('makeCaseRow: an override wins over the default', () => {
  const row = makeCaseRow({ id: 'case-9', title: 'Ninth' });

  assert.equal(row.id, 'case-9');
  assert.equal(row.title, 'Ninth');
  assert.equal(row.caseType, 'complaints');
});

test('makeCaseRow: the default posture is the assigned Reviewer of the row', () => {
  assert.equal(makeCaseRow().assignedReviewer, REVIEWER);
  assert.equal(makeChrome().currentUser.id, REVIEWER);
});

test('makeCaseRow: two rows never share a mutable answers or conversation', () => {
  const first = makeCaseRow();
  const second = makeCaseRow();

  first.answers['q1'] = { value: 'Yes' };
  first.conversation.push({
    author: 'someone',
    timestamp: '2026-07-01T00:00:00Z',
    body: 'hello',
  });

  assert.deepEqual(second.answers, {});
  assert.deepEqual(second.conversation, []);
});

test('makePermissions: an override wins, the rest of the posture stands', () => {
  const permissions = makePermissions({ isMaintainer: true });

  assert.equal(permissions.isMaintainer, true);
  assert.equal(permissions.isReviewer, true);
  assert.deepEqual(permissions.ownedCaseTypes, []);
});

test('makeChrome: permission overrides compose with the Reviewer default', () => {
  const chrome = makeChrome({ permissions: { isControls: true } });

  assert.equal(chrome.permissions.isControls, true);
  assert.equal(chrome.permissions.isReviewer, true);
  assert.deepEqual(chrome.permissions, makePermissions({ isControls: true }));
});

test('makeChrome: a partial currentUser keeps the fields it did not name', () => {
  const chrome = makeChrome({ currentUser: { id: 'x' } });

  assert.equal(chrome.currentUser.id, 'x');
  assert.equal(chrome.currentUser.displayName, 'Reviewer One');
});
