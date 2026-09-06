// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';
import { NotesPlugin } from '../src/sections/notes/notes-plugin.js';
import { getSectionPlugin } from '../src/sections/registry.js';
import { configureAppSections } from './helpers/configure-sections.js';

configureAppSections();
installDom();

test('NotesPlugin has correct contract properties and is registered', () => {
  configureAppSections();
  assert.equal(getSectionPlugin('notes'), NotesPlugin);
  assert.equal(NotesPlugin.id, 'notes');
  assert.equal(NotesPlugin.tab, true);
  assert.equal(NotesPlugin.tabOrder, 6);
  assert.equal(NotesPlugin.summaryBlock, true);
  assert.equal(NotesPlugin.summaryOrder, 5);
  assert.equal(NotesPlugin.showInSummaryDefault, false);
  assert.deepEqual(NotesPlugin.defaultLabels, {
    tab: 'Notes',
    heading: 'Notes',
  });
});

test('NotesPlugin evaluateAccess handles active, frozen, and hidden roles', () => {
  // Assigned reviewer on non-frozen case gets edit
  assert.equal(
    NotesPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Allocated' }),
      roles: ['assignedReviewer'],
    }),
    'edit'
  );

  // Assigned reviewer on frozen cases gets read-only
  assert.equal(
    NotesPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Completed' }),
      roles: ['assignedReviewer'],
    }),
    'read-only'
  );
  assert.equal(
    NotesPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Void' }),
      roles: ['assignedReviewer'],
    }),
    'read-only'
  );

  // Hidden roles
  for (const role of ['none', 'responsibleParty', 'responsiblePartyManager']) {
    assert.equal(
      NotesPlugin.evaluateAccess({
        caseRow: /** @type {any} */ ({ status: 'Allocated' }),
        roles: [/** @type {any} */ (role)],
      }),
      'hidden'
    );
  }

  // Other reviewer / manager gets read-only
  assert.equal(
    NotesPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Allocated' }),
      roles: ['otherReviewer'],
    }),
    'read-only'
  );
  assert.equal(
    NotesPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Allocated' }),
      roles: ['reviewerManager'],
    }),
    'read-only'
  );
});

test('NotesPlugin view triggers save on field edit when access is edit', () => {
  /** @type {Array<[string, string]>} */
  const edits = [];
  const panelContext = /** @type {any} */ ({
    snapshot: {
      access: { notes: 'edit' },
      sectionLabels: { notes: { heading: 'Notes Heading' } },
    },
    caseRow: { notes: 'Old note', caseJustification: 'Old just' },
    config: {
      placeholders: { notes: 'Type notes' },
    },
    actions: {
      notes: {
        fieldEdited: (/** @type {string} */ f, /** @type {string} */ v) => {
          edits.push([f, v]);
        },
      },
    },
  });

  const node = /** @type {HTMLElement} */ (NotesPlugin.view(panelContext));
  const textareas = node.querySelectorAll('textarea');
  assert.equal(textareas.length, 2);

  textareas[0].value = 'New note text';
  fireEvent(textareas[0], 'input');

  assert.deepEqual(edits, [['notes', 'New note text']]);
});

test('NotesPlugin view renders read-only textareas when access is read-only', () => {
  const panelContext = /** @type {any} */ ({
    snapshot: {
      access: { notes: 'read-only' },
      sectionLabels: { notes: { heading: 'Notes Heading' } },
    },
    caseRow: { notes: 'Frozen note', caseJustification: 'Frozen just' },
    config: {},
    actions: {
      save: {
        fieldEdited: () => {},
      },
    },
  });

  const node = /** @type {HTMLElement} */ (NotesPlugin.view(panelContext));
  const textareas = node.querySelectorAll('textarea');
  assert.equal(textareas[0].readOnly, true);
  assert.equal(textareas[1].readOnly, true);
});

// --- Notes owns its own write ---

test('NotesPlugin declares exactly the two columns it edits', () => {
  // Data on the plugin, never a Case Type descriptor. The whole of what this
  // Section may persist, and the framework refuses the rest whatever is here.
  assert.deepEqual(NotesPlugin.writes, {
    fields: ['notes', 'caseJustification'],
  });
  assert.deepEqual(
    Object.keys(NotesPlugin.writes),
    ['fields'],
    'Notes merges no blob'
  );
  for (const field of ['status', 'assignedReviewer', 'responsibleParty']) {
    assert.ok(
      !NotesPlugin.writes.fields.includes(field),
      `${field} is not the Notes Section's to edit`
    );
  }
});

test('NotesPlugin actions are the persist seam, with nothing in between', () => {
  /** @type {any[]} */
  const persisted = [];
  const actions = NotesPlugin.createActions(
    /** @type {any} */ ({
      dispatch: () => {},
      sectionId: 'notes',
      persist: (/** @type {any} */ ...args) => persisted.push(args),
      persistBlob: () => {},
    })
  );

  actions.fieldEdited('caseJustification', 'Because.');
  assert.deepEqual(persisted, [['caseJustification', 'Because.']]);
});

test('NotesPlugin: the Reviewer freeze is at Completed and Void, not at reportable', () => {
  // Deliberately NOT `isFrozen`: the Assigned Reviewer keeps editing Notes
  // through Actions In Progress, which is the rule most likely to be lost in a
  // move like this one.
  const editable = [
    'To-allocate',
    'Allocated',
    'In-progress',
    'Actions In Progress',
  ];
  for (const status of editable) {
    assert.equal(
      NotesPlugin.evaluateAccess(
        /** @type {any} */ ({
          caseRow: { status },
          roles: ['assignedReviewer'],
        })
      ),
      'edit',
      status
    );
  }
  for (const status of ['Completed', 'Void']) {
    assert.equal(
      NotesPlugin.evaluateAccess(
        /** @type {any} */ ({
          caseRow: { status },
          roles: ['assignedReviewer'],
        })
      ),
      'read-only',
      status
    );
  }
});
