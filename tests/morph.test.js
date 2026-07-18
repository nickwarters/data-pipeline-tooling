// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_dom-stub.js';

installDom();

const { h } = await import('../src/lib/html.js');
const { morph } = await import('../src/core/morph.js');

/** A fresh detached container to reconcile into. */
function container() {
  return /** @type {any} */ (globalThis).document.createElement('div');
}

/** Text of an element's direct children, for order assertions. */
function texts(/** @type {any} */ el) {
  return el.childNodes.map((/** @type {any} */ c) => c.textContent);
}

// ===== MOUNT + REFERENCE-EQUAL SKIP =====

test('morph: first render mounts the tree into an empty container', () => {
  const root = container();
  morph(root, h('p', {}, 'hello'));
  assert.equal(root.childNodes.length, 1);
  assert.equal(root.childNodes[0].tagName, 'P');
  assert.equal(root.childNodes[0].textContent, 'hello');
});

test('morph: null/false clears the container', () => {
  const root = container();
  morph(root, h('p', {}, 'hi'));
  morph(root, null);
  assert.equal(root.childNodes.length, 0);
  morph(root, h('p', {}, 'hi'));
  morph(root, false);
  assert.equal(root.childNodes.length, 0);
});

test('morph: a reference-equal subtree is skipped in O(1) without traversal', () => {
  const root = container();
  // A deep, unchanging subtree we will hand back by reference (as memo() would).
  const stableChild = h(
    'ul',
    { key: 'list' },
    h('li', { key: 'a' }, 'a'),
    h('li', { key: 'b' }, 'b'),
    h('li', { key: 'c' }, 'c')
  );
  morph(root, h('div', {}, stableChild, h('span', { key: 's' }, 'v1')));

  const stats = morph(
    root,
    // The ul is the *same object* — its 4 descendants must not be visited.
    h('div', {}, stableChild, h('span', { key: 's' }, 'v2'))
  );

  // Visited: the root <div>, the <ul> (ref-skip), the <span>, the span's text.
  // The ul's <li>s and their text nodes are never examined.
  assert.equal(stats.visited, 4);
  // Elements actually patched: root div + span. The memoised ul is not.
  assert.equal(stats.patchedElements, 2);
});

test('morph: an identical tree passed twice changes nothing', () => {
  const root = container();
  const tree = h('p', { class: 'x' }, 'same');
  morph(root, tree);
  const stats = morph(root, tree);
  assert.equal(stats.visited, 1);
  assert.ok(
    !stats.patchedElements,
    'ref-equal skip at the root, nothing patched'
  );
});

// ===== TEXT / ATTRIBUTE / CLASS PATCHING (node identity preserved) =====

test('morph: text content is patched on the same node', () => {
  const root = container();
  morph(root, h('p', {}, 'before'));
  const p = root.childNodes[0];
  const textNode = p.childNodes[0];
  morph(root, h('p', {}, 'after'));
  assert.equal(root.childNodes[0], p, 'element identity preserved');
  assert.equal(p.childNodes[0], textNode, 'text node identity preserved');
  assert.equal(p.textContent, 'after');
});

test('morph: unchanged text is left untouched', () => {
  const root = container();
  morph(root, h('p', {}, 'same'));
  const p = root.childNodes[0];
  const stats = morph(root, h('p', {}, 'same'));
  // p is patched (not ref-equal) but its text node needs no write.
  assert.equal(p.textContent, 'same');
  assert.equal(stats.patchedElements, 1);
});

test('morph: className is added, changed, and removed', () => {
  const root = container();
  morph(root, h('div', {}, h('p', {}, 'x')));
  const p = root.childNodes[0].childNodes[0];

  morph(root, h('div', {}, h('p', { class: 'one' }, 'x')));
  assert.equal(p.className, 'one');

  morph(root, h('div', {}, h('p', { class: 'two' }, 'x')));
  assert.equal(p.className, 'two');

  morph(root, h('div', {}, h('p', {}, 'x')));
  assert.equal(p.className, '');
});

test('morph: attributes are added, changed, and removed', () => {
  const root = container();
  morph(root, h('div', {}, h('p', {}, 'x')));
  const p = root.childNodes[0].childNodes[0];

  morph(root, h('div', {}, h('p', { 'aria-label': 'first' }, 'x')));
  assert.equal(p.getAttribute('aria-label'), 'first');

  morph(root, h('div', {}, h('p', { 'aria-label': 'second' }, 'x')));
  assert.equal(p.getAttribute('aria-label'), 'second');

  morph(root, h('div', {}, h('p', {}, 'x')));
  assert.equal(p.getAttribute('aria-label'), null);
});

test('morph: a boolean property is patched and cleared', () => {
  const root = container();
  morph(root, h('div', {}, h('input', { disabled: true })));
  const input = root.childNodes[0].childNodes[0];
  assert.equal(input.disabled, true);

  morph(root, h('div', {}, h('input', {})));
  assert.equal(input.disabled, false);
});

// ===== CONTROLLED FORM PROPERTIES =====

test('morph: input value is a property, and an in-flight edit is never clobbered', () => {
  const root = container();
  morph(root, h('div', {}, h('input', { key: 'q', value: '' })));
  const input = root.childNodes[0].childNodes[0];

  // User types — the live value diverges from the last rendered (intended) value.
  input.value = 'hel';

  // An unrelated re-render (same intended value '') must NOT overwrite the edit.
  morph(root, h('div', {}, h('input', { key: 'q', value: '' })));
  assert.equal(input.value, 'hel', 'uncommitted value preserved');
});

test('morph: a genuine value change is reflected to the input', () => {
  const root = container();
  morph(root, h('div', {}, h('input', { key: 'q', value: 'a' })));
  const input = root.childNodes[0].childNodes[0];
  morph(root, h('div', {}, h('input', { key: 'q', value: 'b' })));
  assert.equal(input.value, 'b');
});

test('morph: an intended value change already matching the live value writes nothing extra', () => {
  const root = container();
  morph(root, h('div', {}, h('input', { key: 'q', value: 'a' })));
  const input = root.childNodes[0].childNodes[0];
  // Simulate the live value already being 'b' (e.g. user typed exactly it).
  input.value = 'b';
  let writes = 0;
  Object.defineProperty(input, 'value', {
    get() {
      return this._value;
    },
    set(v) {
      writes++;
      this._value = v;
    },
  });
  morph(root, h('div', {}, h('input', { key: 'q', value: 'b' })));
  assert.equal(
    writes,
    0,
    'no redundant write when live already equals intended'
  );
});

test('morph: value control removed resets the field', () => {
  const root = container();
  morph(root, h('div', {}, h('input', { key: 'q', value: 'x' })));
  const input = root.childNodes[0].childNodes[0];
  morph(root, h('div', {}, h('input', { key: 'q' })));
  assert.equal(input.value, '');
});

test('morph: checkbox checked is a controlled property, added/changed/removed', () => {
  const root = container();
  morph(root, h('div', {}, h('input', { key: 'c', type: 'checkbox' })));
  const box = root.childNodes[0].childNodes[0];

  morph(
    root,
    h('div', {}, h('input', { key: 'c', type: 'checkbox', checked: true }))
  );
  assert.equal(box.checked, true);

  morph(
    root,
    h('div', {}, h('input', { key: 'c', type: 'checkbox', checked: false }))
  );
  assert.equal(box.checked, false);

  // Live toggled true, intended stays false → unchanged intended, left alone.
  box.checked = true;
  morph(
    root,
    h('div', {}, h('input', { key: 'c', type: 'checkbox', checked: false }))
  );
  assert.equal(box.checked, true, 'unchanged intended does not fight the user');

  // Control removed → reset to false.
  morph(root, h('div', {}, h('input', { key: 'c', type: 'checkbox' })));
  assert.equal(box.checked, false);
});

test('morph: checked change already matching the live state writes nothing extra', () => {
  const root = container();
  morph(
    root,
    h('div', {}, h('input', { key: 'c', type: 'checkbox', checked: false }))
  );
  const box = root.childNodes[0].childNodes[0];
  box.checked = true; // live already matches the next intended
  let writes = 0;
  let backing = true;
  Object.defineProperty(box, 'checked', {
    get() {
      return backing;
    },
    set(v) {
      writes++;
      backing = v;
    },
  });
  morph(
    root,
    h('div', {}, h('input', { key: 'c', type: 'checkbox', checked: true }))
  );
  assert.equal(writes, 0);
});

// ===== EVENT HANDLER REPLACEMENT WITHOUT LEAKS =====
//
// Asserted behaviourally through dispatchEvent (a public API) rather than by
// inspecting the stub's listener registry: after a swap, only the new handler
// fires — a leaked old listener would fire too.

const G = /** @type {any} */ (globalThis);

/** Dispatch a bubbling click at `el`. */
function click(/** @type {any} */ el) {
  el.dispatchEvent(new G.CustomEvent('click', { bubbles: true }));
}

test('morph: replacing a listener removes the old one (no leak)', () => {
  const root = container();
  let a = 0;
  let b = 0;
  const fn1 = () => (a += 1);
  const fn2 = () => (b += 1);
  morph(root, h('div', {}, h('button', { onClick: fn1 }, 'go')));
  const btn = root.childNodes[0].childNodes[0];

  morph(root, h('div', {}, h('button', { onClick: fn2 }, 'go')));
  click(btn);
  assert.equal(a, 0, 'old handler no longer bound');
  assert.equal(b, 1, 'exactly the new handler fires');
});

test('morph: a referentially-stable listener fires exactly once (no accumulation)', () => {
  const root = container();
  let calls = 0;
  const fn = () => (calls += 1);
  morph(root, h('div', {}, h('button', { onClick: fn }, 'go')));
  const btn = root.childNodes[0].childNodes[0];
  // Re-render several times with the same handler; it must not stack up.
  morph(root, h('div', {}, h('button', { onClick: fn }, 'go')));
  morph(root, h('div', {}, h('button', { onClick: fn }, 'go')));
  click(btn);
  assert.equal(calls, 1, 'one handler, fired once');
});

test('morph: a removed listener is unbound', () => {
  const root = container();
  let calls = 0;
  const fn = () => (calls += 1);
  morph(root, h('div', {}, h('button', { onClick: fn }, 'go')));
  const btn = root.childNodes[0].childNodes[0];
  morph(root, h('div', {}, h('button', {}, 'go')));
  click(btn);
  assert.equal(calls, 0, 'handler gone after removal');
});

test('morph: a component-callback property handler is reassigned then cleared', () => {
  class Host extends StubEl {
    constructor() {
      super('cora-morph-host');
      /** @type {any} */
      this.onCommit = null;
    }
  }
  /** @type {any} */ (globalThis).customElements.define(
    'cora-morph-host',
    Host
  );
  const root = container();
  const a = () => {};
  const b = () => {};
  morph(root, h('div', {}, h('cora-morph-host', { onCommit: a })));
  const host = root.childNodes[0].childNodes[0];
  assert.equal(host.onCommit, a);
  morph(root, h('div', {}, h('cora-morph-host', { onCommit: b })));
  assert.equal(host.onCommit, b);
  morph(root, h('div', {}, h('cora-morph-host', {})));
  assert.equal(host.onCommit, null);
});

// ===== KEYED LIST: INSERT / REMOVE / REORDER =====

/** Build a keyed list container view from an array of keys. */
function list(/** @type {string[]} */ keys) {
  return h(
    'ul',
    {},
    ...keys.map((/** @type {string} */ k) => h('li', { key: k }, k))
  );
}

test('morph: keyed insert keeps existing nodes and inserts the new one in place', () => {
  const root = container();
  morph(root, list(['a', 'c']));
  const ul = root.childNodes[0];
  const a = ul.childNodes[0];
  const c = ul.childNodes[1];

  morph(root, list(['a', 'b', 'c']));
  assert.deepEqual(texts(ul), ['a', 'b', 'c']);
  assert.equal(ul.childNodes[0], a, 'a reused');
  assert.equal(ul.childNodes[2], c, 'c reused');
});

test('morph: keyed remove drops the right node and keeps the rest', () => {
  const root = container();
  morph(root, list(['a', 'b', 'c']));
  const ul = root.childNodes[0];
  const a = ul.childNodes[0];
  const c = ul.childNodes[2];

  morph(root, list(['a', 'c']));
  assert.deepEqual(texts(ul), ['a', 'c']);
  assert.equal(ul.childNodes[0], a);
  assert.equal(ul.childNodes[1], c);
});

test('morph: keyed reorder moves the same DOM nodes rather than rebuilding', () => {
  const root = container();
  morph(root, list(['a', 'b', 'c']));
  const ul = root.childNodes[0];
  const [a, b, c] = ul.childNodes;

  morph(root, list(['c', 'a', 'b']));
  assert.deepEqual(texts(ul), ['c', 'a', 'b']);
  assert.equal(ul.childNodes[0], c, 'c is the same node, moved');
  assert.equal(ul.childNodes[1], a);
  assert.equal(ul.childNodes[2], b);
});

test('morph: a partial reorder moves only the out-of-place nodes (minimal moves)', () => {
  const root = container();
  morph(root, list(['a', 'b', 'c', 'd']));
  const ul = root.childNodes[0];
  const a = ul.childNodes[0];
  const d = ul.childNodes[3];

  // a, c, d stay in relative order; only b moves.
  const stats = morph(root, list(['a', 'c', 'b', 'd']));
  assert.deepEqual(texts(ul), ['a', 'c', 'b', 'd']);
  assert.equal(ul.childNodes[0], a);
  assert.equal(ul.childNodes[3], d);
  assert.equal(stats.movedNodes, 1, 'only one node moved');
});

test('morph: reorder-while-editing preserves focus, caret, and the uncommitted value', () => {
  const root = container();
  // A row with a keyed, focusable input, surrounded by sibling rows.
  const view = (/** @type {string[]} */ order, /** @type {string} */ draft) =>
    h(
      'ul',
      {},
      ...order.map((/** @type {string} */ k) =>
        k === 'edit'
          ? h(
              'li',
              { key: 'edit' },
              h('input', { key: 'edit-input', value: draft })
            )
          : h('li', { key: k }, k)
      )
    );

  morph(root, view(['a', 'edit', 'b', 'c'], ''));
  const ul = root.childNodes[0];
  const editLi = ul.childNodes[1];
  const input = editLi.childNodes[0];

  // User focuses the input, moves the caret, and types — none of this is in the store yet.
  input.focus();
  input.value = 'draft text';
  input.setSelectionRange(4, 4);

  // The *surrounding* rows reorder around the (still-empty-in-state) edit row.
  morph(root, view(['b', 'a', 'edit', 'c'], ''));

  const G = /** @type {any} */ (globalThis);
  const movedEditLi = ul.childNodes.find(
    (/** @type {any} */ c) => c.getAttribute('key') === 'edit'
  );
  const movedInput = movedEditLi.childNodes[0];
  assert.equal(movedInput, input, 'the input is the same DOM node');
  assert.equal(movedInput.value, 'draft text', 'uncommitted value preserved');
  assert.equal(movedInput.selectionStart, 4, 'caret preserved');
  assert.equal(movedInput._focused, true, 'still focused');
  assert.equal(G.document.activeElement, input, 'focus not lost');
});

// ===== SUBTREE REPLACEMENT =====

test('morph: a tag change replaces the subtree', () => {
  const root = container();
  morph(root, h('div', {}, h('p', {}, 'x')));
  const p = root.childNodes[0].childNodes[0];
  morph(root, h('div', {}, h('section', {}, 'x')));
  const replaced = root.childNodes[0].childNodes[0];
  assert.notEqual(replaced, p, 'a new node, not the old one');
  assert.equal(replaced.tagName, 'SECTION');
});

test('morph: a key change replaces the node even when the tag matches', () => {
  const root = container();
  morph(root, h('ul', {}, h('li', { key: 'a' }, 'x')));
  const ul = root.childNodes[0];
  const first = ul.childNodes[0];
  morph(root, h('ul', {}, h('li', { key: 'z' }, 'x')));
  assert.notEqual(ul.childNodes[0], first, 'different key → different node');
  assert.equal(ul.childNodes[0].getAttribute('key'), 'z');
});

test('morph: unkeyed children patch by position, replacing on type mismatch', () => {
  const root = container();
  morph(root, h('div', {}, h('span', {}, 'one'), h('span', {}, 'two')));
  const div = root.childNodes[0];
  const firstSpan = div.childNodes[0];

  // Position 0 stays a span (patched); position 1 becomes a <b> (replaced).
  morph(root, h('div', {}, h('span', {}, 'ONE'), h('b', {}, 'two')));
  assert.equal(
    div.childNodes[0],
    firstSpan,
    'same-type position patched in place'
  );
  assert.equal(div.childNodes[0].textContent, 'ONE');
  assert.equal(div.childNodes[1].tagName, 'B', 'mismatched position replaced');
});

test('morph: data-key is honoured as the key attribute', () => {
  const root = container();
  morph(
    root,
    h(
      'ul',
      {},
      h('li', { 'data-key': '1' }, 'a'),
      h('li', { 'data-key': '2' }, 'b')
    )
  );
  const ul = root.childNodes[0];
  const [one, two] = ul.childNodes;
  morph(
    root,
    h(
      'ul',
      {},
      h('li', { 'data-key': '2' }, 'b'),
      h('li', { 'data-key': '1' }, 'a')
    )
  );
  assert.equal(ul.childNodes[0], two);
  assert.equal(ul.childNodes[1], one);
});

// ===== ROOT SHAPES =====

test('morph: an array of root nodes is reconciled', () => {
  const root = container();
  morph(root, [h('p', { key: 'p' }, 'one'), h('p', { key: 'q' }, 'two')]);
  assert.deepEqual(
    root.childNodes.map((/** @type {any} */ c) => c.textContent),
    ['one', 'two']
  );
  // Nested arrays and falsy entries flatten away.
  morph(root, [
    [h('p', { key: 'p' }, 'ONE')],
    null,
    h('p', { key: 'q' }, 'two'),
  ]);
  assert.deepEqual(
    root.childNodes.map((/** @type {any} */ c) => c.textContent),
    ['ONE', 'two']
  );
});

test('morph: a fragment-like root spreads its childNodes', () => {
  const root = container();
  const frag = {
    tagName: undefined,
    nodeName: '#document-fragment',
    childNodes: [h('p', { key: 'a' }, 'a'), h('p', { key: 'b' }, 'b')],
  };
  morph(root, frag);
  assert.deepEqual(texts(root), ['a', 'b']);
});

test('morph: rejects a string root with an actionable error', () => {
  const root = container();
  assert.throws(
    () => morph(root, 'text'),
    /morph\(\): view returned a string; wrap it in an element/
  );
});

test('morph: rejects a string nested in a root array', () => {
  const root = container();
  assert.throws(
    () => morph(root, [h('p', {}, 'valid'), ['text']]),
    /morph\(\): view returned a string; wrap it in an element/
  );
});

// ===== LIS COVERAGE: a reorder exercising multi-length increasing runs =====

test('morph: a complex reorder lands in the right order with minimal disruption', () => {
  const root = container();
  morph(root, list(['a', 'b', 'c', 'd', 'e']));
  const ul = root.childNodes[0];
  const nodes = Object.fromEntries(
    ul.childNodes.map((/** @type {any} */ c) => [c.getAttribute('key'), c])
  );

  // e to the front, rest shift back: a,b,c,d keep relative order (the LIS).
  const stats = morph(root, list(['e', 'a', 'b', 'c', 'd']));
  assert.deepEqual(texts(ul), ['e', 'a', 'b', 'c', 'd']);
  for (const k of ['a', 'b', 'c', 'd', 'e']) {
    assert.equal(
      ul.childNodes.find((/** @type {any} */ c) => c.getAttribute('key') === k),
      nodes[k],
      `${k} is the same node`
    );
  }
  assert.equal(stats.movedNodes, 1, 'only e moved');
});

// ===== EDGE CASES =====

test('morph: a keyed node whose tag changed is replaced, not patched', () => {
  const root = container();
  morph(root, h('ul', {}, h('li', { key: 'a' }, 'x')));
  const ul = root.childNodes[0];
  const first = ul.childNodes[0];
  // Same key 'a', different tag — cannot patch a <li> into a <span>.
  morph(root, h('ul', {}, h('span', { key: 'a' }, 'x')));
  assert.notEqual(ul.childNodes[0], first);
  assert.equal(ul.childNodes[0].tagName, 'SPAN');
});

test('morph: a duplicate key in the new list makes the second a fresh node', () => {
  const root = container();
  morph(root, list(['a', 'b']));
  const ul = root.childNodes[0];
  const a = ul.childNodes[0];
  // Two children claim key 'a': the first reuses the node, the second is new.
  morph(root, list(['a', 'a']));
  assert.equal(ul.childNodes.length, 2);
  assert.equal(ul.childNodes[0], a, 'first keeps the original node');
  assert.notEqual(ul.childNodes[1], a, 'second is a fresh node');
});

test('morph: unkeyed children beyond the old count are inserted', () => {
  const root = container();
  morph(root, h('div', {}, h('span', {}, 'one')));
  const div = root.childNodes[0];
  const first = div.childNodes[0];
  morph(root, h('div', {}, h('span', {}, 'one'), h('span', {}, 'two')));
  assert.equal(div.childNodes[0], first, 'existing position patched');
  assert.deepEqual(texts(div), ['one', 'two']);
});

test('morph: a form control that gains a value control on a later render reflects it', () => {
  const root = container();
  morph(root, h('div', {}, h('input', { key: 'q' })));
  const input = root.childNodes[0].childNodes[0];
  morph(root, h('div', {}, h('input', { key: 'q', value: 'now-controlled' })));
  assert.equal(input.value, 'now-controlled');
});

test('morph: tolerates reconciling over a foreign (non-h) node as the old node', () => {
  const root = container();
  // A pre-existing DOM node morph did not build (no recorded props).
  const raw = /** @type {any} */ (globalThis).document.createElement('p');
  root.appendChild(raw);
  morph(root, h('p', { class: 'x' }, 'hello'));
  assert.equal(root.childNodes[0], raw, 'the foreign node is patched in place');
  assert.equal(raw.className, 'x');
  assert.equal(raw.textContent, 'hello');
});

test('morph: tolerates a foreign (non-h) node in the new tree', () => {
  const root = container();
  morph(root, h('p', { class: 'x' }, 'hello'));
  const old = root.childNodes[0];
  const raw = /** @type {any} */ (globalThis).document.createElement('p');
  morph(root, raw);
  assert.equal(root.childNodes[0], old, 'same-type node patched in place');
  assert.equal(
    old.className,
    '',
    'foreign node carries no props → class cleared'
  );
});

test('morph: a caller-supplied stats object is populated and returned', () => {
  const root = container();
  const stats = /** @type {any} */ ({});
  const returned = morph(root, h('p', {}, 'x'), stats);
  assert.equal(returned, stats, 'the same object is returned');
  assert.equal(stats.createdNodes, 1);
});

test('morph: a checkbox that gains a checked control on a later render reflects it', () => {
  const root = container();
  morph(root, h('div', {}, h('input', { key: 'c', type: 'checkbox' })));
  const box = root.childNodes[0].childNodes[0];
  morph(
    root,
    h('div', {}, h('input', { key: 'c', type: 'checkbox', checked: true }))
  );
  assert.equal(box.checked, true);
});
