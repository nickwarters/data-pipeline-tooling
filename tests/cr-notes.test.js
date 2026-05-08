// @ts-check
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
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) { this._children = cs; }
  appendChild(/** @type {StubEl} */ c) { this._children.push(c); return c; }
  append(/** @type {StubEl[]} */ ...cs) { this._children.push(...cs); }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
}

(/** @type {any} */ (globalThis)).HTMLElement = StubEl;
(/** @type {any} */ (globalThis)).document = {
  /** @param {string} _tag @returns {StubEl} */
  createElement(_tag) { return new StubEl(); },
  addEventListener() {},
  removeEventListener() {},
};
(/** @type {any} */ (globalThis)).customElements = { define() {} };

const { CRNotes } = await import('../src/cr-notes.js');

/**
 * @param {string} [caseId]
 */
function makeQueue(caseId = 'case-1') {
  /** @type {{ id: string, field: string, value: unknown }[]} */
  const enqueued = [];
  return {
    enqueued,
    enqueue(/** @type {string} */ id, /** @type {string} */ field, /** @type {unknown} */ value) {
      enqueued.push({ id, field, value });
    },
  };
}

test('CRNotes: renders h2 Notes heading', () => {
  const el = new CRNotes();
  el.notes = '';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  const h2 = (/** @type {any} */ (el))._children[0];
  assert.equal(h2.textContent, 'Notes');
});

test('CRNotes: textarea carries existing notes value', () => {
  const el = new CRNotes();
  el.notes = 'Some existing notes';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = (/** @type {any} */ (el))._children[1];
  assert.equal(textarea.value, 'Some existing notes');
});

test('CRNotes: textarea has placeholder when notes is empty', () => {
  const el = new CRNotes();
  el.notes = '';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = (/** @type {any} */ (el))._children[1];
  assert.equal(textarea.placeholder, 'Add notes…');
});

test('CRNotes: textarea has cr-notes-input class', () => {
  const el = new CRNotes();
  el.notes = 'text';
  el.saveQueue = /** @type {any} */ (makeQueue());
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = (/** @type {any} */ (el))._children[1];
  assert.equal(textarea.className, 'cr-notes-input');
});

test('CRNotes: input event enqueues save of notes field with current value', () => {
  const saveQueue = makeQueue('case-2');
  const el = new CRNotes();
  el.notes = '';
  el.saveQueue = /** @type {any} */ (saveQueue);
  el.caseId = 'case-2';
  el.connectedCallback();

  const textarea = (/** @type {any} */ (el))._children[1];
  textarea.value = 'new notes content';
  (/** @type {any} */ (textarea))._listeners['input'][0]({ target: textarea });

  assert.equal(saveQueue.enqueued.length, 1);
  assert.equal(saveQueue.enqueued[0].id, 'case-2');
  assert.equal(saveQueue.enqueued[0].field, 'notes');
  assert.equal(saveQueue.enqueued[0].value, 'new notes content');
});

test('CRNotes: input event does not throw when saveQueue is null', () => {
  const el = new CRNotes();
  el.notes = '';
  el.saveQueue = null;
  el.caseId = 'case-1';
  el.connectedCallback();

  const textarea = (/** @type {any} */ (el))._children[1];
  textarea.value = 'anything';
  assert.doesNotThrow(() => {
    (/** @type {any} */ (textarea))._listeners['input'][0]({ target: textarea });
  });
});

test('CRNotes: input event does not throw when caseId is empty', () => {
  const saveQueue = makeQueue('');
  const el = new CRNotes();
  el.notes = '';
  el.saveQueue = /** @type {any} */ (saveQueue);
  el.caseId = '';
  el.connectedCallback();

  const textarea = (/** @type {any} */ (el))._children[1];
  textarea.value = 'anything';
  assert.doesNotThrow(() => {
    (/** @type {any} */ (textarea))._listeners['input'][0]({ target: textarea });
  });
  assert.equal(saveQueue.enqueued.length, 0);
});
