// @ts-check
// TODO(simplify-ui): Rewrite these lifecycle-heavy tests around the
// future function-component API. Prefer asserting plain functions, h() output,
// reactive() updates, and route-shell behavior over manual connectedCallback()/
// disconnectedCallback() calls on custom element classes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// DOM stubs must be in place before any src import
class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    this.textContent = '';
    this.className = '';
    this.hidden = false;
    this.placeholder = '';
    this.value = '';
    this.readOnly = false;
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    this._children = cs;
  }
  appendChild(/** @type {StubEl} */ c) {
    this._children.push(c);
    return c;
  }
  append(/** @type {StubEl[]} */ ...cs) {
    this._children.push(...cs);
  }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    /** @type {any} */ (this)._attrs ??= {};
    /** @type {any} */ (this)._attrs[k] = v;
  }
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).document = {
  /** @param {string} _tag @returns {StubEl} */
  createElement(_tag) {
    return new StubEl();
  },
  addEventListener() {},
  removeEventListener() {},
};
/** @type {any} */ (globalThis).customElements = { define() {} };

const { CRNotes } = await import('../src/components/cr-notes.js');

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
const noteInput = (el) => byClass(el, 'cr-notes-input');

/**
 * The Case Justification textarea.
 * @param {any} el
 */
const justificationInput = (el) => byClass(el, 'cr-case-justification-input');

test('CRNotes: renders h2 Notes heading', () => {
  const el = new CRNotes();
  el.notes = '';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  const h2 = /** @type {any} */ (el)._children[0];
  assert.equal(h2.textContent, 'Notes');
});

test('CRNotes: general-note textarea carries existing notes value', () => {
  const el = new CRNotes();
  el.notes = 'Some existing notes';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  assert.equal(noteInput(el).value, 'Some existing notes');
});

test('CRNotes: general-note textarea has placeholder when notes is empty', () => {
  const el = new CRNotes();
  el.notes = '';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  assert.equal(noteInput(el).placeholder, 'Add notes…');
});

test('CRNotes: general-note textarea has cr-notes-input class', () => {
  const el = new CRNotes();
  el.notes = 'text';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  assert.ok(noteInput(el));
});

test('CRNotes: general-note input event enqueues save of notes field with current value', () => {
  const saveQueue = makeQueue('case-2');
  const el = new CRNotes();
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

test('CRNotes: general-note input event does not throw when saveQueue is null', () => {
  const el = new CRNotes();
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

test('CRNotes: access read-only sets general-note readOnly and readonly attribute', () => {
  const el = new CRNotes();
  el.notes = 'some notes';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.access = 'read-only';
  el.connectedCallback();

  const textarea = noteInput(el);
  assert.equal(textarea.readOnly, true);
  assert.equal(textarea._attrs?.['readonly'], 'readonly');
});

test('CRNotes: read-only general-note input event does not enqueue a save', () => {
  const saveQueue = makeQueue('case-1');
  const el = new CRNotes();
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

test('CRNotes: general-note input event does not throw when caseId is empty', () => {
  const saveQueue = makeQueue('');
  const el = new CRNotes();
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

test('CRNotes: general-note input with null target value falls back to empty string', () => {
  const saveQueue = makeQueue('case-1');
  const el = new CRNotes();
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

test('CRNotes: renders a Case Justification box with its own label', () => {
  const el = new CRNotes();
  el.notes = '';
  el.caseJustification = '';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = justificationInput(el);
  assert.ok(textarea, 'Case Justification textarea should be rendered');
  assert.equal(textarea._attrs?.['aria-label'], 'Case Justification');
});

test('CRNotes: Case Justification textarea carries existing value', () => {
  const el = new CRNotes();
  el.notes = '';
  el.caseJustification = 'Existing justification';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  assert.equal(justificationInput(el).value, 'Existing justification');
});

test('CRNotes: Case Justification textarea has its own placeholder when empty', () => {
  const el = new CRNotes();
  el.notes = '';
  el.caseJustification = '';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  assert.equal(justificationInput(el).placeholder, 'Add Case Justification…');
});

test('CRNotes: Case Justification input enqueues save of caseJustification field independently', () => {
  const saveQueue = makeQueue('case-3');
  const el = new CRNotes();
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

test('CRNotes: the two boxes autosave to different fields independently', () => {
  const saveQueue = makeQueue('case-4');
  const el = new CRNotes();
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

test('CRNotes: access read-only sets Case Justification readOnly', () => {
  const el = new CRNotes();
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

test('CRNotes: read-only Case Justification input does not enqueue a save', () => {
  const saveQueue = makeQueue('case-1');
  const el = new CRNotes();
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

test('CRNotes: each box has a visible label element', () => {
  const el = new CRNotes();
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
