// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveQueue } from '../src/services/save-queue.js';
import { formSaveTarget } from '../src/services/form-save-target.js';
import {
  MockSharePointClient,
  storedFormFields,
} from '../src/services/mock-sharepoint-client.js';
import { oneToOne } from '../form-types/one-to-one.js';

// Capability: a Form saves through the same queue as a Case, and two editors
// holding one Form open each save their own fields without being told the
// other's write is a conflict; only a change to a field being saved is one.

const SAM = { loginName: 'sam', displayName: 'Sam Patel' };
const ANA = { loginName: 'ana', displayName: 'Ana Lopez' };

function client() {
  return new MockSharePointClient({
    personas: {},
    formLists: {
      [oneToOne.listName]: [
        {
          id: '1',
          etag: '"1"',
          created: '2026-10-01T09:00:00Z',
          modified: '2026-10-01T09:00:00Z',
          fields: storedFormFields(oneToOne, {
            Employee: SAM,
            CurrentFirstLineManager: ANA,
            CurrentSecondLineManager: null,
            Status: 'Pending',
            DueDate: '2026-10-31',
            Agenda: 'First draft',
          }),
        },
      ],
    },
  });
}

/** @param {MockSharePointClient} sharepoint */
async function openedBy(sharepoint) {
  const queue = new SaveQueue(sharepoint, {
    target: formSaveTarget(sharepoint, oneToOne),
    // Nothing waits on the debounce: every test flushes explicitly.
    setTimer: () => 0,
    clearTimer: () => {},
  });
  const item = await sharepoint.getFormItem(oneToOne, '1');
  assert.ok(item);
  queue.loadCase(item);
  return queue;
}

test('a Form edit is written to its list, decoded the same on the way back', async () => {
  const sharepoint = client();
  const queue = await openedBy(sharepoint);
  queue.enqueue('1', 'Agenda', 'Leave planning ✓');
  assert.equal(await queue.flushCase('1'), true);
  const fresh = await sharepoint.getFormItem(oneToOne, '1');
  assert.equal(fresh?.fields.Agenda, 'Leave planning ✓');
  assert.equal(queue.status.get(), 'saved');
});

test('two editors saving different fields of one Form both land, without a conflict', async () => {
  const sharepoint = client();
  const employee = await openedBy(sharepoint);
  const manager = await openedBy(sharepoint);

  employee.enqueue('1', 'IndividualComments', 'Happy with the plan.');
  assert.equal(await employee.flushCase('1'), true);
  manager.enqueue('1', 'LineManagerComments', 'A strong month.');
  assert.equal(await manager.flushCase('1'), true);

  const fresh = await sharepoint.getFormItem(oneToOne, '1');
  assert.equal(fresh?.fields.IndividualComments, 'Happy with the plan.');
  assert.equal(fresh?.fields.LineManagerComments, 'A strong month.');
  assert.equal(manager.status.get(), 'saved');
});

test('saving a field the other editor changed since it was opened is a conflict, and overwrites nothing', async () => {
  const sharepoint = client();
  const employee = await openedBy(sharepoint);
  const manager = await openedBy(sharepoint);

  employee.enqueue('1', 'Agenda', 'Employee’s agenda');
  assert.equal(await employee.flushCase('1'), true);
  manager.enqueue('1', 'Agenda', 'Manager’s agenda');
  assert.equal(await manager.flushCase('1'), false);

  assert.equal(manager.status.get(), 'conflict');
  const fresh = await sharepoint.getFormItem(oneToOne, '1');
  assert.equal(fresh?.fields.Agenda, 'Employee’s agenda');
});

test('an editor’s own earlier save is not mistaken for someone else’s change', async () => {
  const sharepoint = client();
  const employee = await openedBy(sharepoint);
  const manager = await openedBy(sharepoint);

  employee.enqueue('1', 'Agenda', 'Second draft');
  assert.equal(await employee.flushCase('1'), true);
  // The manager's write moves the ETag on, so the employee's next one is
  // rejected and judged against what the employee last saved.
  manager.enqueue('1', 'LineManagerComments', 'Noted.');
  assert.equal(await manager.flushCase('1'), true);
  employee.enqueue('1', 'Agenda', 'Third draft');
  assert.equal(await employee.flushCase('1'), true);

  const fresh = await sharepoint.getFormItem(oneToOne, '1');
  assert.equal(fresh?.fields.Agenda, 'Third draft');
});

test('a Form deleted while open is reported as a conflict rather than retried', async () => {
  const sharepoint = client();
  const queue = await openedBy(sharepoint);
  sharepoint.getFormItem = async () => null;
  sharepoint.patchFormItem = async () => ({ ok: false, status: 412 });
  queue.enqueue('1', 'Agenda', 'Lost');
  assert.equal(await queue.flushCase('1'), false);
  assert.equal(queue.status.get(), 'conflict');
});
