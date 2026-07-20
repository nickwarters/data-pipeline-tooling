// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { createRouteSlice, selectQuestionBankState } =
  await import('../src/pages/question-bank/cora-bank-editor.js');

function context() {
  return /** @type {any} */ ({
    appEl: { classList: { add() {}, remove() {} } },
    chrome: {
      toasts: [],
      nav: { currentHash: '#/question-bank' },
      currentUser: { id: 'owner-1', displayName: 'Owner' },
      permissions: {},
    },
  });
}

test('question bank slice owns bank selection, filters, and drawer state', () => {
  const slice = createRouteSlice({}, context());
  const initial = selectQuestionBankState(slice.initialState);
  const selected = slice.reducer(slice.initialState, {
    type: 'bank/selected',
    slug: initial.activeSlug,
  });
  const filtered = slice.reducer(selected, {
    type: 'filters/changed',
    patch: { conditionalOnly: true },
  });
  const opened = slice.reducer(filtered, {
    type: 'drawer/changed',
    open: true,
  });

  assert.equal(selectQuestionBankState(opened).filters.conditionalOnly, true);
  assert.equal(selectQuestionBankState(opened).drawerOpen, true);
  assert.equal(selectQuestionBankState(opened).activeSlug, initial.activeSlug);
  assert.notEqual(opened, slice.initialState);
});
