// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';
import { SaveQueue } from '../src/services/save-queue.js';
import { saveCaseNotes } from '../src/actions/case-actions.js';

test('saveCaseNotes persists through SaveQueue and dispatches the saved mock row', async () => {
  /** @type {import('../src/sharepoint-client.js').CaseRow} */
  const row = {
    id: 'case-1',
    caseType: 'test',
    title: 'Case',
    status: 'In-progress',
    assignedReviewer: 'reviewer',
    responsibleParty: 'owner',
    answers: {},
    conversation: [],
    notes: 'before',
    completedAt: null,
    etag: '1',
  };
  const client = new MockSharePointClient({
    personas: {},
    lists: { Cases: [row] },
  });
  const saveQueue = new SaveQueue(client, { debounceMs: 0 });
  /** @type {Array<{ type: 'case/saved', case: import('../src/sharepoint-client.js').CaseRow }>} */
  const actions = [];

  await saveCaseNotes({
    client,
    saveQueue,
    caseId: 'case-1',
    listName: 'Cases',
    notes: 'after',
    dispatch: (action) => actions.push(action),
  });

  assert.equal(client.snapshot().lists.Cases[0].notes, 'after');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'case/saved');
  assert.equal(actions[0].case.notes, 'after');
});

test('saveCaseNotes rejects when the case does not exist', async () => {
  const client = new MockSharePointClient({
    personas: {},
    lists: { Cases: [] },
  });
  const saveQueue = new SaveQueue(client, { debounceMs: 0 });
  await assert.rejects(
    saveCaseNotes({
      client,
      saveQueue,
      dispatch() {},
      caseId: 'missing',
      listName: 'Cases',
      notes: 'x',
    }),
    /was not found/
  );
});
