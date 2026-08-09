// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { h, svg } = await import('../src/lib/html.js');
const { render } = await import('../src/core/render.js');

/** A fresh detached container to reconcile into. */
function container() {
  return /** @type {any} */ (globalThis).document.createElement('div');
}

/** Text of an element's direct children, for order assertions. */
function texts(/** @type {any} */ el) {
  return el.childNodes.map((/** @type {any} */ c) => c.textContent);
}

// ===== MOUNT + REFERENCE-EQUAL SKIP =====

test('render: first render mounts the tree into an empty container', () => {
  const root = container();
  render(root, h('p', {}, 'hello'));
  assert.equal(root.childNodes.length, 1);
  assert.equal(root.childNodes[0].tagName, 'P');
  assert.equal(root.childNodes[0].textContent, 'hello');
});

test('render: changing namespace replaces a same-tag node', () => {
  const root = container();
  render(root, h('div', {}, h('circle', { key: 'same' })));
  const htmlCircle = root.childNodes[0].childNodes[0];

  render(root, h('div', {}, svg('circle', { key: 'same' })));
  const svgCircle = root.childNodes[0].childNodes[0];
  assert.notEqual(svgCircle, htmlCircle);
  assert.equal(svgCircle.namespaceURI, 'http://www.w3.org/2000/svg');
});

test('render: null/false clears the container', () => {
  const root = container();
  render(root, h('p', {}, 'hi'));
  render(root, null);
  assert.equal(root.childNodes.length, 0);
  render(root, h('p', {}, 'hi'));
  render(root, false);
  assert.equal(root.childNodes.length, 0);
});

test('render: a reference-equal subtree is skipped in O(1) without traversal', () => {
  const root = container();
  // A deep, unchanging subtree we will hand back by reference (as memo() would).
  const stableChild = h(
    'ul',
    { key: 'list' },
    h('li', { key: 'a' }, 'a'),
    h('li', { key: 'b' }, 'b'),
    h('li', { key: 'c' }, 'c')
  );
  render(root, h('div', {}, stableChild, h('span', { key: 's' }, 'v1')));

  const stats = render(
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

test('render: an identical tree passed twice changes nothing', () => {
  const root = container();
  const tree = h('p', { className: 'x' }, 'same');
  render(root, tree);
  const stats = render(root, tree);
  assert.equal(stats.visited, 1);
  assert.ok(
    !stats.patchedElements,
    'ref-equal skip at the root, nothing patched'
  );
});

// ===== TEXT / ATTRIBUTE / CLASS PATCHING (node identity preserved) =====

test('render: text content is patched on the same node', () => {
  const root = container();
  render(root, h('p', {}, 'before'));
  const p = root.childNodes[0];
  const textNode = p.childNodes[0];
  render(root, h('p', {}, 'after'));
  assert.equal(root.childNodes[0], p, 'element identity preserved');
  assert.equal(p.childNodes[0], textNode, 'text node identity preserved');
  assert.equal(p.textContent, 'after');
});

test('render: unchanged text is left untouched', () => {
  const root = container();
  render(root, h('p', {}, 'same'));
  const p = root.childNodes[0];
  const stats = render(root, h('p', {}, 'same'));
  // p is patched (not ref-equal) but its text node needs no write.
  assert.equal(p.textContent, 'same');
  assert.equal(stats.patchedElements, 1);
});

test('render: className is added, changed, and removed', () => {
  const root = container();
  render(root, h('div', {}, h('p', {}, 'x')));
  const p = root.childNodes[0].childNodes[0];

  render(root, h('div', {}, h('p', { className: 'one' }, 'x')));
  assert.equal(p.className, 'one');

  render(root, h('div', {}, h('p', { className: 'two' }, 'x')));
  assert.equal(p.className, 'two');

  render(root, h('div', {}, h('p', {}, 'x')));
  assert.equal(p.className, '');
});

test('render: attributes are added, changed, and removed', () => {
  const root = container();
  render(root, h('div', {}, h('p', {}, 'x')));
  const p = root.childNodes[0].childNodes[0];

  render(root, h('div', {}, h('p', { 'aria-label': 'first' }, 'x')));
  assert.equal(p.getAttribute('aria-label'), 'first');

  render(root, h('div', {}, h('p', { 'aria-label': 'second' }, 'x')));
  assert.equal(p.getAttribute('aria-label'), 'second');

  render(root, h('div', {}, h('p', {}, 'x')));
  assert.equal(p.getAttribute('aria-label'), null);
});

test('render: patches SVG attributes and listeners in place', () => {
  const root = container();
  let firstCalls = 0;
  let secondCalls = 0;
  const first = () => (firstCalls += 1);
  const second = () => (secondCalls += 1);

  render(
    root,
    h(
      'div',
      {},
      svg(
        'svg',
        { key: 'chart', className: 'one', onclick: first },
        svg('rect', { key: 'bar', width: 10, fill: 'red' })
      )
    )
  );
  const chart = root.childNodes[0].childNodes[0];
  const bar = chart.childNodes[0];

  render(
    root,
    h(
      'div',
      {},
      svg(
        'svg',
        { key: 'chart', className: 'two', onclick: second },
        svg('rect', { key: 'bar', width: 20, fill: 'blue' })
      )
    )
  );
  assert.equal(root.childNodes[0].childNodes[0], chart);
  assert.equal(chart.childNodes[0], bar);
  assert.equal(chart.getAttribute('class'), 'two');
  assert.equal(bar.getAttribute('width'), '20');
  assert.equal(bar.getAttribute('fill'), 'blue');
  chart.dispatchEvent(new G.CustomEvent('click'));
  assert.equal(firstCalls, 0);
  assert.equal(secondCalls, 1);

  render(
    root,
    h('div', {}, svg('svg', { key: 'chart' }, svg('rect', { key: 'bar' })))
  );
  assert.equal(root.childNodes[0].childNodes[0], chart);
  assert.equal(chart.getAttribute('class'), null);
  assert.equal(bar.getAttribute('width'), null);
  chart.dispatchEvent(new G.CustomEvent('click'));
  assert.equal(secondCalls, 1);
});

test('render: SVG value and checked stay attributes through changes and removal', () => {
  const root = container();
  render(
    root,
    svg('svg', {}, svg('rect', { key: 'bar', value: 'first', checked: true }))
  );
  const bar = root.childNodes[0].childNodes[0];

  render(
    root,
    svg('svg', {}, svg('rect', { key: 'bar', value: 'second', checked: false }))
  );
  assert.equal(bar.getAttribute('value'), 'second');
  assert.equal(bar.getAttribute('checked'), 'false');

  render(root, svg('svg', {}, svg('rect', { key: 'bar' })));
  assert.equal(bar.getAttribute('value'), null);
  assert.equal(bar.getAttribute('checked'), null);
});

test('render: a boolean property is patched and cleared', () => {
  const root = container();
  render(root, h('div', {}, h('input', { disabled: true })));
  const input = root.childNodes[0].childNodes[0];
  assert.equal(input.disabled, true);

  render(root, h('div', {}, h('input', {})));
  assert.equal(input.disabled, false);
});

// ===== CONTROLLED FORM PROPERTIES =====

test('render: input value is a property, and an in-flight edit is never clobbered', () => {
  const root = container();
  render(root, h('div', {}, h('input', { key: 'q', value: '' })));
  const input = root.childNodes[0].childNodes[0];

  // User types — the live value diverges from the last rendered (intended) value.
  input.value = 'hel';

  // An unrelated re-render (same intended value '') must NOT overwrite the edit.
  render(root, h('div', {}, h('input', { key: 'q', value: '' })));
  assert.equal(input.value, 'hel', 'uncommitted value preserved');
});

test('render: a genuine value change is reflected to the input', () => {
  const root = container();
  render(root, h('div', {}, h('input', { key: 'q', value: 'a' })));
  const input = root.childNodes[0].childNodes[0];
  render(root, h('div', {}, h('input', { key: 'q', value: 'b' })));
  assert.equal(input.value, 'b');
});

test('render: an intended value change already matching the live value writes nothing extra', () => {
  const root = container();
  render(root, h('div', {}, h('input', { key: 'q', value: 'a' })));
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
  render(root, h('div', {}, h('input', { key: 'q', value: 'b' })));
  assert.equal(
    writes,
    0,
    'no redundant write when live already equals intended'
  );
});

test('render: value control removed resets the field', () => {
  const root = container();
  render(root, h('div', {}, h('input', { key: 'q', value: 'x' })));
  const input = root.childNodes[0].childNodes[0];
  render(root, h('div', {}, h('input', { key: 'q' })));
  assert.equal(input.value, '');
});

test('render: checkbox checked is a controlled property, added/changed/removed', () => {
  const root = container();
  render(root, h('div', {}, h('input', { key: 'c', type: 'checkbox' })));
  const box = root.childNodes[0].childNodes[0];

  render(
    root,
    h('div', {}, h('input', { key: 'c', type: 'checkbox', checked: true }))
  );
  assert.equal(box.checked, true);

  render(
    root,
    h('div', {}, h('input', { key: 'c', type: 'checkbox', checked: false }))
  );
  assert.equal(box.checked, false);

  // Live toggled true, intended stays false → unchanged intended, left alone.
  box.checked = true;
  render(
    root,
    h('div', {}, h('input', { key: 'c', type: 'checkbox', checked: false }))
  );
  assert.equal(box.checked, true, 'unchanged intended does not fight the user');

  // Control removed → reset to false.
  render(root, h('div', {}, h('input', { key: 'c', type: 'checkbox' })));
  assert.equal(box.checked, false);
});

test('render: checked change already matching the live state writes nothing extra', () => {
  const root = container();
  render(
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
  render(
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

test('render: replacing a listener removes the old one (no leak)', () => {
  const root = container();
  let a = 0;
  let b = 0;
  const fn1 = () => (a += 1);
  const fn2 = () => (b += 1);
  render(root, h('div', {}, h('button', { onclick: fn1 }, 'go')));
  const btn = root.childNodes[0].childNodes[0];

  render(root, h('div', {}, h('button', { onclick: fn2 }, 'go')));
  click(btn);
  assert.equal(a, 0, 'old handler no longer bound');
  assert.equal(b, 1, 'exactly the new handler fires');
});

test('render: a referentially-stable listener fires exactly once (no accumulation)', () => {
  const root = container();
  let calls = 0;
  const fn = () => (calls += 1);
  render(root, h('div', {}, h('button', { onclick: fn }, 'go')));
  const btn = root.childNodes[0].childNodes[0];
  // Re-render several times with the same handler; it must not stack up.
  render(root, h('div', {}, h('button', { onclick: fn }, 'go')));
  render(root, h('div', {}, h('button', { onclick: fn }, 'go')));
  click(btn);
  assert.equal(calls, 1, 'one handler, fired once');
});

test('render: a removed listener is unbound', () => {
  const root = container();
  let calls = 0;
  const fn = () => (calls += 1);
  render(root, h('div', {}, h('button', { onclick: fn }, 'go')));
  const btn = root.childNodes[0].childNodes[0];
  render(root, h('div', {}, h('button', {}, 'go')));
  click(btn);
  assert.equal(calls, 0, 'handler gone after removal');
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

test('render: keyed insert keeps existing nodes and inserts the new one in place', () => {
  const root = container();
  render(root, list(['a', 'c']));
  const ul = root.childNodes[0];
  const a = ul.childNodes[0];
  const c = ul.childNodes[1];

  render(root, list(['a', 'b', 'c']));
  assert.deepEqual(texts(ul), ['a', 'b', 'c']);
  assert.equal(ul.childNodes[0], a, 'a reused');
  assert.equal(ul.childNodes[2], c, 'c reused');
});

test('render: keyed remove drops the right node and keeps the rest', () => {
  const root = container();
  render(root, list(['a', 'b', 'c']));
  const ul = root.childNodes[0];
  const a = ul.childNodes[0];
  const c = ul.childNodes[2];

  render(root, list(['a', 'c']));
  assert.deepEqual(texts(ul), ['a', 'c']);
  assert.equal(ul.childNodes[0], a);
  assert.equal(ul.childNodes[1], c);
});

test('render: keyed reorder moves the same DOM nodes rather than rebuilding', () => {
  const root = container();
  render(root, list(['a', 'b', 'c']));
  const ul = root.childNodes[0];
  const [a, b, c] = ul.childNodes;

  render(root, list(['c', 'a', 'b']));
  assert.deepEqual(texts(ul), ['c', 'a', 'b']);
  assert.equal(ul.childNodes[0], c, 'c is the same node, moved');
  assert.equal(ul.childNodes[1], a);
  assert.equal(ul.childNodes[2], b);
});

test('render: a partial reorder moves only the out-of-place nodes (minimal moves)', () => {
  const root = container();
  render(root, list(['a', 'b', 'c', 'd']));
  const ul = root.childNodes[0];
  const a = ul.childNodes[0];
  const d = ul.childNodes[3];

  // a, c, d stay in relative order; only b moves.
  const stats = render(root, list(['a', 'c', 'b', 'd']));
  assert.deepEqual(texts(ul), ['a', 'c', 'b', 'd']);
  assert.equal(ul.childNodes[0], a);
  assert.equal(ul.childNodes[3], d);
  assert.equal(stats.movedNodes, 1, 'only one node moved');
});

test('render: reorder-while-editing preserves focus, caret, and the uncommitted value', () => {
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

  render(root, view(['a', 'edit', 'b', 'c'], ''));
  const ul = root.childNodes[0];
  const editLi = ul.childNodes[1];
  const input = editLi.childNodes[0];

  // User focuses the input, moves the caret, and types — none of this is in the store yet.
  input.focus();
  input.value = 'draft text';
  input.setSelectionRange(4, 4);

  // The *surrounding* rows reorder around the (still-empty-in-state) edit row.
  render(root, view(['b', 'a', 'edit', 'c'], ''));

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

test('render: a tag change replaces the subtree', () => {
  const root = container();
  render(root, h('div', {}, h('p', {}, 'x')));
  const p = root.childNodes[0].childNodes[0];
  render(root, h('div', {}, h('section', {}, 'x')));
  const replaced = root.childNodes[0].childNodes[0];
  assert.notEqual(replaced, p, 'a new node, not the old one');
  assert.equal(replaced.tagName, 'SECTION');
});

test('render: a key change replaces the node even when the tag matches', () => {
  const root = container();
  render(root, h('ul', {}, h('li', { key: 'a' }, 'x')));
  const ul = root.childNodes[0];
  const first = ul.childNodes[0];
  render(root, h('ul', {}, h('li', { key: 'z' }, 'x')));
  assert.notEqual(ul.childNodes[0], first, 'different key → different node');
  assert.equal(ul.childNodes[0].getAttribute('key'), 'z');
});

test('render: unkeyed children patch by position, replacing on type mismatch', () => {
  const root = container();
  render(root, h('div', {}, h('span', {}, 'one'), h('span', {}, 'two')));
  const div = root.childNodes[0];
  const firstSpan = div.childNodes[0];

  // Position 0 stays a span (patched); position 1 becomes a <b> (replaced).
  render(root, h('div', {}, h('span', {}, 'ONE'), h('b', {}, 'two')));
  assert.equal(
    div.childNodes[0],
    firstSpan,
    'same-type position patched in place'
  );
  assert.equal(div.childNodes[0].textContent, 'ONE');
  assert.equal(div.childNodes[1].tagName, 'B', 'mismatched position replaced');
});

// ===== ROOT SHAPES =====

test('render: an array of root nodes is reconciled', () => {
  const root = container();
  render(root, [h('p', { key: 'p' }, 'one'), h('p', { key: 'q' }, 'two')]);
  assert.deepEqual(
    root.childNodes.map((/** @type {any} */ c) => c.textContent),
    ['one', 'two']
  );
  // Nested arrays and falsy entries flatten away.
  render(root, [
    [h('p', { key: 'p' }, 'ONE')],
    null,
    h('p', { key: 'q' }, 'two'),
  ]);
  assert.deepEqual(
    root.childNodes.map((/** @type {any} */ c) => c.textContent),
    ['ONE', 'two']
  );
});

test('render: a fragment-like root spreads its childNodes', () => {
  const root = container();
  const frag = {
    tagName: undefined,
    nodeName: '#document-fragment',
    childNodes: [h('p', { key: 'a' }, 'a'), h('p', { key: 'b' }, 'b')],
  };
  render(root, frag);
  assert.deepEqual(texts(root), ['a', 'b']);
});

test('render: rejects a string root with an actionable error', () => {
  const root = container();
  assert.throws(
    () => render(root, 'text'),
    /render\(\): view returned a string; wrap it in an element/
  );
});

test('render: rejects a string nested in a root array', () => {
  const root = container();
  assert.throws(
    () => render(root, [h('p', {}, 'valid'), ['text']]),
    /render\(\): view returned a string; wrap it in an element/
  );
});

// ===== LIS COVERAGE: a reorder exercising multi-length increasing runs =====

test('render: a complex reorder lands in the right order with minimal disruption', () => {
  const root = container();
  render(root, list(['a', 'b', 'c', 'd', 'e']));
  const ul = root.childNodes[0];
  const nodes = Object.fromEntries(
    ul.childNodes.map((/** @type {any} */ c) => [c.getAttribute('key'), c])
  );

  // e to the front, rest shift back: a,b,c,d keep relative order (the LIS).
  const stats = render(root, list(['e', 'a', 'b', 'c', 'd']));
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

test('render: a keyed node whose tag changed is replaced, not patched', () => {
  const root = container();
  render(root, h('ul', {}, h('li', { key: 'a' }, 'x')));
  const ul = root.childNodes[0];
  const first = ul.childNodes[0];
  // Same key 'a', different tag — cannot patch a <li> into a <span>.
  render(root, h('ul', {}, h('span', { key: 'a' }, 'x')));
  assert.notEqual(ul.childNodes[0], first);
  assert.equal(ul.childNodes[0].tagName, 'SPAN');
});

test('render: a duplicate key in the new list makes the second a fresh node', () => {
  const root = container();
  render(root, list(['a', 'b']));
  const ul = root.childNodes[0];
  const a = ul.childNodes[0];
  // Two children claim key 'a': the first reuses the node, the second is new.
  render(root, list(['a', 'a']));
  assert.equal(ul.childNodes.length, 2);
  assert.equal(ul.childNodes[0], a, 'first keeps the original node');
  assert.notEqual(ul.childNodes[1], a, 'second is a fresh node');
});

test('render: unkeyed children beyond the old count are inserted', () => {
  const root = container();
  render(root, h('div', {}, h('span', {}, 'one')));
  const div = root.childNodes[0];
  const first = div.childNodes[0];
  render(root, h('div', {}, h('span', {}, 'one'), h('span', {}, 'two')));
  assert.equal(div.childNodes[0], first, 'existing position patched');
  assert.deepEqual(texts(div), ['one', 'two']);
});

test('render: a form control that gains a value control on a later render reflects it', () => {
  const root = container();
  render(root, h('div', {}, h('input', { key: 'q' })));
  const input = root.childNodes[0].childNodes[0];
  render(root, h('div', {}, h('input', { key: 'q', value: 'now-controlled' })));
  assert.equal(input.value, 'now-controlled');
});

test('render: tolerates reconciling over a foreign (non-h) node as the old node', () => {
  const root = container();
  // A pre-existing DOM node render() did not build (no recorded props).
  const raw = /** @type {any} */ (globalThis).document.createElement('p');
  root.appendChild(raw);
  render(root, h('p', { className: 'x' }, 'hello'));
  assert.equal(root.childNodes[0], raw, 'the foreign node is patched in place');
  assert.equal(raw.className, 'x');
  assert.equal(raw.textContent, 'hello');
});

test('render: tolerates a foreign (non-h) node in the new tree', () => {
  const root = container();
  render(root, h('p', { className: 'x' }, 'hello'));
  const old = root.childNodes[0];
  const raw = /** @type {any} */ (globalThis).document.createElement('p');
  render(root, raw);
  assert.equal(root.childNodes[0], old, 'same-type node patched in place');
  assert.equal(
    old.className,
    '',
    'foreign node carries no props → class cleared'
  );
});

test('render: a caller-supplied stats object is populated and returned', () => {
  const root = container();
  const stats = /** @type {any} */ ({});
  const returned = render(root, h('p', {}, 'x'), stats);
  assert.equal(returned, stats, 'the same object is returned');
  assert.equal(stats.createdNodes, 1);
});

test('render: a checkbox that gains a checked control on a later render reflects it', () => {
  const root = container();
  render(root, h('div', {}, h('input', { key: 'c', type: 'checkbox' })));
  const box = root.childNodes[0].childNodes[0];
  render(
    root,
    h('div', {}, h('input', { key: 'c', type: 'checkbox', checked: true }))
  );
  assert.equal(box.checked, true);
});
