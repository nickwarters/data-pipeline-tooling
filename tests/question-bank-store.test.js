// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Set up a tiny document stub *before* importing the store so commit() sees it.
const focusLog = /** @type {any[]} */ ([]);
const setSelLog = /** @type {any[]} */ ([]);

/** @type {any} */
let activeStub = null;
/** @type {any} */
let lookupStub = null;

(/** @type {any} */ (globalThis)).document = {
  get activeElement() { return activeStub; },
  /** @param {string} sel */
  querySelector(sel) {
    if (lookupStub && sel.includes(lookupStub.key)) return lookupStub.el;
    return null;
  },
};
(/** @type {any} */ (globalThis)).CSS = { escape: (/** @type {string} */ s) => s };

const {
  cases, baseline, activeSlug, filters, drawerOpen, toastMsg,
  currentBank, baselineBank, isDirty, diffCounts,
  commit, setFilters, showToast, _resetStore,
} = await import('../src/question-bank-store.js');

function makeEl(key) {
  return {
    _attrs: { 'data-focus-key': key },
    getAttribute(k) { return this._attrs[k] ?? null; },
    focus() { focusLog.push(key); },
    setSelectionRange(a, b) { setSelLog.push([a, b]); },
    selectionStart: 0,
    selectionEnd: 0,
  };
}

test('initial state: hello-review is active, not dirty, no diffs', () => {
  _resetStore();
  assert.equal(activeSlug.get(), 'hello-review');
  assert.equal(isDirty.get(), false);
  assert.deepEqual(diffCounts.get(), { added: 0, changed: 0, deprecated: 0 });
  assert.ok(currentBank.get().label);
  assert.ok(baselineBank.get().label);
});

test('commit: mutates cases and marks dirty', () => {
  _resetStore();
  commit(types => { types['hello-review'].questions[0].text = 'CHANGED'; });
  assert.equal(isDirty.get(), true);
  assert.equal(currentBank.get().questions[0].text, 'CHANGED');
});

test('diffCounts: counts added / changed / deprecated', () => {
  _resetStore();
  commit(types => {
    const b = types['hello-review'];
    b.questions[0].text = 'edited';           // changed
    b.questions[1].deprecated = true;         // deprecated (from active)
    b.questions.push({ id: 'q-new', text: 'new', responseType: 'yes-no-na', deprecated: false }); // added
  });
  const d = diffCounts.get();
  assert.equal(d.added, 1);
  assert.equal(d.changed, 1);
  assert.equal(d.deprecated, 1);
});

test('diffCounts: handles a slug with no baseline questions array', () => {
  _resetStore();
  // Inject a fresh slug into cases that baseline does not know about.
  commit(types => {
    types['brand-new'] = {
      label: 'B', slug: 'brand-new', eligibleGroups: [],
      questions: [{ id: 'q-x', text: 'x', responseType: 'yes-no-na', deprecated: false }],
    };
  });
  const d = diffCounts.get();
  assert.equal(d.added, 1);
});

test('setFilters: merges patch', () => {
  _resetStore();
  setFilters({ category: 'Opening' });
  assert.equal(filters.get().category, 'Opening');
  setFilters({ conditionalOnly: true });
  assert.equal(filters.get().conditionalOnly, true);
  assert.equal(filters.get().category, 'Opening');
});

test('showToast: sets, then clears after timer', () => {
  _resetStore();
  /** @type {Function|null} */
  let pending = null;
  (/** @type {any} */ (globalThis)).setTimeout = (/** @type {Function} */ fn) => { pending = fn; return 0; };
  showToast('Saved');
  assert.equal(toastMsg.get(), 'Saved');
  pending?.();
  assert.equal(toastMsg.get(), '');
});

test('showToast: keeps current message if it changed before timer fired', () => {
  _resetStore();
  /** @type {Function[]} */
  const pending = [];
  (/** @type {any} */ (globalThis)).setTimeout = (/** @type {Function} */ fn) => { pending.push(fn); return 0; };
  showToast('A');
  showToast('B');
  // Fire the 'A' timer — should *not* clear because the message is 'B' now.
  pending[0]();
  assert.equal(toastMsg.get(), 'B');
  pending[1]();
  assert.equal(toastMsg.get(), '');
});

test('showToast: tolerates a missing setTimeout (no throw)', () => {
  _resetStore();
  (/** @type {any} */ (globalThis)).setTimeout = undefined;
  showToast('one-shot');
  assert.equal(toastMsg.get(), 'one-shot');
});

test('commit: with no active element, runs cleanly', () => {
  _resetStore();
  activeStub = null;
  lookupStub = null;
  commit(t => { t['hello-review'].label = 'x'; });
  assert.equal(currentBank.get().label, 'x');
});

test('commit: restores focus + selection on a re-found element', () => {
  _resetStore();
  focusLog.length = 0;
  setSelLog.length = 0;
  const old = makeEl('wording:q-welcome');
  old.selectionStart = 3;
  old.selectionEnd = 5;
  activeStub = old;
  const replacement = makeEl('wording:q-welcome');
  lookupStub = { key: 'wording:q-welcome', el: replacement };
  commit(t => { t['hello-review'].questions[0].text = 'edited'; });
  assert.deepEqual(focusLog, ['wording:q-welcome']);
  assert.deepEqual(setSelLog, [[3, 5]]);
});

test('commit: skips re-focus when same element is still active', () => {
  _resetStore();
  focusLog.length = 0;
  const stable = makeEl('wording:q-welcome');
  activeStub = stable;
  lookupStub = { key: 'wording:q-welcome', el: stable };
  commit(t => { t['hello-review'].questions[0].text = 'x'; });
  assert.deepEqual(focusLog, []);
});

test('commit: tolerates setSelectionRange throwing', () => {
  _resetStore();
  const old = makeEl('wording:q-welcome');
  activeStub = old;
  const replacement = makeEl('wording:q-welcome');
  replacement.setSelectionRange = () => { throw new Error('not applicable'); };
  lookupStub = { key: 'wording:q-welcome', el: replacement };
  commit(t => { t['hello-review'].label = 'y'; });
  // Should not throw.
});

test('commit: skips focus restore when no replacement is found', () => {
  _resetStore();
  focusLog.length = 0;
  const old = makeEl('wording:q-nonexistent');
  activeStub = old;
  lookupStub = null;
  commit(t => { t['hello-review'].label = 'z'; });
  assert.deepEqual(focusLog, []);
});

test('commit: uses native CSS.escape when available', () => {
  _resetStore();
  let escaped = '';
  (/** @type {any} */ (globalThis)).CSS = { escape: (s) => { escaped = s; return s; } };
  const old = makeEl('wording:q-welcome');
  activeStub = old;
  lookupStub = { key: 'wording:q-welcome', el: makeEl('wording:q-welcome') };
  commit(t => { t['hello-review'].label = 'q'; });
  assert.equal(escaped, 'wording:q-welcome');
});

test('commit: falls back when CSS.escape is missing', () => {
  _resetStore();
  (/** @type {any} */ (globalThis)).CSS = undefined;
  const old = makeEl('wording:q-welcome');
  activeStub = old;
  lookupStub = { key: 'wording:q-welcome', el: makeEl('wording:q-welcome') };
  commit(t => { t['hello-review'].label = 'r'; });
  // No throw means the fallback path was exercised.
});

test('commit: handles missing global document gracefully', () => {
  _resetStore();
  const savedDoc = (/** @type {any} */ (globalThis)).document;
  (/** @type {any} */ (globalThis)).document = undefined;
  commit(t => { t['hello-review'].label = 'p'; });
  (/** @type {any} */ (globalThis)).document = savedDoc;
  assert.equal(currentBank.get().label, 'p');
});

test('drawerOpen signal: settable', () => {
  _resetStore();
  drawerOpen.set(true);
  assert.equal(drawerOpen.get(), true);
});

test('baselineBank: reflects the active slug', () => {
  _resetStore();
  activeSlug.set('complaint-review');
  assert.equal(baselineBank.get().slug, 'complaint-review');
});

test('cases signal exported for downstream re-emit', () => {
  _resetStore();
  const v = cases.get();
  cases.set(v);
  assert.ok(cases.get() === v);
});
