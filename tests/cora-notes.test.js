// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

// DOM stubs must be in place before any src import

const { CORANotes } = await import('../src/components/sections/cora-notes.js');

/**
 * @param {string} [caseId]
 */
function makeQueue(caseId = 'case-1') {
  /** @type {{ id: string, field: string, value: unknown }[]} */
  const enqueued = [];
  return {
    enqueued,
    enqueue(
      /** @type {string} */ id,
      /** @type {string} */ field,
      /** @type {unknown} */ value
    ) {
      enqueued.push({ id, field, value });
    },
  };
}

/**
 * Find a descendant element by its className.
 * @param {any} el
 * @param {string} className
 * @returns {any}
 */
function byClass(el, className) {
  return el._children.find((/** @type {any} */ c) => c.className === className);
}

/**
 * The general-note textarea.
 * @param {any} el
 */
const noteInput = (el) => byClass(el, 'cora-notes-input');

/**
 * The Case Justification textarea.
 * @param {any} el
 */
const justificationInput = (el) => byClass(el, 'cora-case-justification-input');

test('CORANotes: renders h2 Notes heading', () => {
  const el = new CORANotes();
  el.notes = '';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  const h2 = /** @type {any} */ (el)._children[0];
  assert.equal(h2.textContent, 'Notes');
});

test('CORANotes: general-note textarea carries existing notes value', () => {
  const el = new CORANotes();
  el.notes = 'Some existing notes';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  assert.equal(noteInput(el).value, 'Some existing notes');
});

test('CORANotes: general-note textarea has placeholder when notes is empty', () => {
  const el = new CORANotes();
  el.notes = '';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  assert.equal(noteInput(el).placeholder, 'Add notes…');
});

test('CORANotes: general-note textarea has cora-notes-input class', () => {
  const el = new CORANotes();
  el.notes = 'text';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  assert.ok(noteInput(el));
});

test('CORANotes: general-note input event enqueues save of notes field with current value', () => {
  const saveQueue = makeQueue('case-2');
  const el = new CORANotes();
  el.notes = '';
  el.saveQueue = /** @type {any} */ (saveQueue);
  el.caseId = 'case-2';
  el.connectedCallback();

  const textarea = noteInput(el);
  textarea.value = 'new notes content';
  textarea._listeners['input'][0]({ target: textarea });

  assert.equal(saveQueue.enqueued.length, 1);
  assert.equal(saveQueue.enqueued[0].id, 'case-2');
  assert.equal(saveQueue.enqueued[0].field, 'notes');
  assert.equal(saveQueue.enqueued[0].value, 'new notes content');
});

test('CORANotes: general-note input event does not throw when saveQueue is null', () => {
  const el = new CORANotes();
  el.notes = '';
  el.saveQueue = null;
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = noteInput(el);
  textarea.value = 'anything';
  assert.doesNotThrow(() => {
    textarea._listeners['input'][0]({ target: textarea });
  });
});

test('CORANotes: access read-only sets general-note readOnly and readonly attribute', () => {
  const el = new CORANotes();
  el.notes = 'some notes';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.access = 'read-only';
  el.connectedCallback();

  const textarea = noteInput(el);
  assert.equal(textarea.readOnly, true);
  assert.equal(textarea._attrs?.['readonly'], 'readonly');
});

test('CORANotes: read-only general-note input event does not enqueue a save', () => {
  const saveQueue = makeQueue('case-1');
  const el = new CORANotes();
  el.notes = 'text';
  el.saveQueue = /** @type {any} */ (saveQueue);
  el.caseId = 'case-1';
  el.access = 'read-only';
  el.connectedCallback();

  const textarea = noteInput(el);
  textarea.value = 'changed';
  textarea._listeners['input'][0]({ target: textarea });
  assert.equal(saveQueue.enqueued.length, 0);
});

test('CORANotes: general-note input event does not throw when caseId is empty', () => {
  const saveQueue = makeQueue('');
  const el = new CORANotes();
  el.notes = '';
  el.saveQueue = /** @type {any} */ (saveQueue);
  el.caseId = '';
  el.connectedCallback();

  const textarea = noteInput(el);
  textarea.value = 'anything';
  assert.doesNotThrow(() => {
    textarea._listeners['input'][0]({ target: textarea });
  });
  assert.equal(saveQueue.enqueued.length, 0);
});

test('CORANotes: general-note input with null target value falls back to empty string', () => {
  const saveQueue = makeQueue('case-1');
  const el = new CORANotes();
  el.notes = '';
  el.saveQueue = /** @type {any} */ (saveQueue);
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = noteInput(el);
  // Simulate ev.target.value being null (covers the `?? ''` branch)
  textarea._listeners['input'][0]({ target: { value: null } });
  assert.equal(saveQueue.enqueued.length, 1);
  assert.equal(saveQueue.enqueued[0].value, '');
});

// --- Case Justification (issue #122) ---

test('CORANotes: renders a Case Justification box with its own label', () => {
  const el = new CORANotes();
  el.notes = '';
  el.caseJustification = '';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = justificationInput(el);
  assert.ok(textarea, 'Case Justification textarea should be rendered');
  assert.equal(textarea._attrs?.['aria-label'], 'Case Justification');
});

test('CORANotes: Case Justification textarea carries existing value', () => {
  const el = new CORANotes();
  el.notes = '';
  el.caseJustification = 'Existing justification';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  assert.equal(justificationInput(el).value, 'Existing justification');
});

test('CORANotes: Case Justification textarea has its own placeholder when empty', () => {
  const el = new CORANotes();
  el.notes = '';
  el.caseJustification = '';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  assert.equal(justificationInput(el).placeholder, 'Add Case Justification…');
});

test('CORANotes: Case Justification input enqueues save of caseJustification field independently', () => {
  const saveQueue = makeQueue('case-3');
  const el = new CORANotes();
  el.notes = '';
  el.caseJustification = '';
  el.saveQueue = /** @type {any} */ (saveQueue);
  el.caseId = 'case-3';
  el.connectedCallback();

  const textarea = justificationInput(el);
  textarea.value = 'Because policy X applies';
  textarea._listeners['input'][0]({ target: textarea });

  assert.equal(saveQueue.enqueued.length, 1);
  assert.equal(saveQueue.enqueued[0].id, 'case-3');
  assert.equal(saveQueue.enqueued[0].field, 'caseJustification');
  assert.equal(saveQueue.enqueued[0].value, 'Because policy X applies');
});

test('CORANotes: the two boxes autosave to different fields independently', () => {
  const saveQueue = makeQueue('case-4');
  const el = new CORANotes();
  el.notes = '';
  el.caseJustification = '';
  el.saveQueue = /** @type {any} */ (saveQueue);
  el.caseId = 'case-4';
  el.connectedCallback();

  const note = noteInput(el);
  note.value = 'a note';
  note._listeners['input'][0]({ target: note });

  const just = justificationInput(el);
  just.value = 'a justification';
  just._listeners['input'][0]({ target: just });

  assert.deepEqual(
    saveQueue.enqueued.map((e) => e.field),
    ['notes', 'caseJustification']
  );
  assert.equal(saveQueue.enqueued[0].value, 'a note');
  assert.equal(saveQueue.enqueued[1].value, 'a justification');
});

test('CORANotes: access read-only sets Case Justification readOnly', () => {
  const el = new CORANotes();
  el.notes = '';
  el.caseJustification = 'x';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.access = 'read-only';
  el.connectedCallback();

  const textarea = justificationInput(el);
  assert.equal(textarea.readOnly, true);
  assert.equal(textarea._attrs?.['readonly'], 'readonly');
});

test('CORANotes: read-only Case Justification input does not enqueue a save', () => {
  const saveQueue = makeQueue('case-1');
  const el = new CORANotes();
  el.notes = '';
  el.caseJustification = 'x';
  el.saveQueue = /** @type {any} */ (saveQueue);
  el.caseId = 'case-1';
  el.access = 'read-only';
  el.connectedCallback();

  const textarea = justificationInput(el);
  textarea.value = 'changed';
  textarea._listeners['input'][0]({ target: textarea });
  assert.equal(saveQueue.enqueued.length, 0);
});

// --- Typed text survives a re-render (issue #317) ---

/**
 * Minimal Case row carrying the two Notes fields (the single source of truth).
 * @param {{ notes?: string, caseJustification?: string }} [over]
 */
function makeCaseRow({ notes = '', caseJustification = '' } = {}) {
  return { id: 'case-1', notes, caseJustification };
}

test('CORANotes: renders general note from caseRow when provided', () => {
  const el = new CORANotes();
  el.caseRow = /** @type {any} */ (makeCaseRow({ notes: 'from row' }));
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  assert.equal(noteInput(el).value, 'from row');
});

test('CORANotes: input writes the typed value back onto the caseRow', () => {
  const caseRow = makeCaseRow({ notes: 'loaded' });
  const el = new CORANotes();
  el.caseRow = /** @type {any} */ (caseRow);
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = noteInput(el);
  textarea.value = 'typed';
  textarea._listeners['input'][0]({ target: textarea });

  assert.equal(caseRow.notes, 'typed');
});

test('CORANotes: typed general note survives a re-render (tab switch)', () => {
  const caseRow = makeCaseRow({ notes: 'loaded' });
  const saveQueue = makeQueue('case-1');
  const el = new CORANotes();
  el.caseRow = /** @type {any} */ (caseRow);
  el.saveQueue = /** @type {any} */ (saveQueue);
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = noteInput(el);
  textarea.value = 'typed but not yet saved';
  textarea._listeners['input'][0]({ target: textarea });

  // A tab switch reconnects the element, which re-renders it.
  el.connectedCallback();

  assert.equal(noteInput(el).value, 'typed but not yet saved');
  // Autosave semantics unchanged: the edit was still enqueued.
  assert.equal(saveQueue.enqueued.length, 1);
  assert.equal(saveQueue.enqueued[0].field, 'notes');
});

test('CORANotes: typed Case Justification survives a re-render (tab switch)', () => {
  const caseRow = makeCaseRow({ caseJustification: 'loaded' });
  const el = new CORANotes();
  el.caseRow = /** @type {any} */ (caseRow);
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = justificationInput(el);
  textarea.value = 'typed justification';
  textarea._listeners['input'][0]({ target: textarea });

  el.connectedCallback();

  assert.equal(justificationInput(el).value, 'typed justification');
});

test('CORANotes: typed note survives a controller re-assign from the same caseRow', () => {
  const caseRow = makeCaseRow({ notes: 'loaded' });
  const el = new CORANotes();
  el.caseRow = /** @type {any} */ (caseRow);
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = noteInput(el);
  textarea.value = 'typed';
  textarea._listeners['input'][0]({ target: textarea });

  // A full page re-render re-runs the controller, which re-assigns from the
  // (now mutated) caseRow before re-rendering.
  Object.assign(el, { notes: caseRow.notes, caseRow });
  el.connectedCallback();

  assert.equal(noteInput(el).value, 'typed');
});

test('CORANotes: read-only input does not mutate the caseRow', () => {
  const caseRow = makeCaseRow({ notes: 'loaded' });
  const el = new CORANotes();
  el.caseRow = /** @type {any} */ (caseRow);
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.access = 'read-only';
  el.connectedCallback();

  const textarea = noteInput(el);
  textarea.value = 'changed';
  textarea._listeners['input'][0]({ target: textarea });

  assert.equal(caseRow.notes, 'loaded');
});

test('CORANotes: each box has a visible label element', () => {
  const el = new CORANotes();
  el.notes = '';
  el.caseJustification = '';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  const labels = /** @type {any} */ (el)._children
    .map((/** @type {any} */ c) => c.textContent)
    .filter(Boolean);
  assert.ok(labels.includes('Case notes'));
  assert.ok(labels.includes('Case Justification'));
});
