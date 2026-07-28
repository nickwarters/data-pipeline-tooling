// @ts-check
// render() — the keyed DOM reconciler at the heart of the store-driven view
// architecture (ADR-0034 / Project Palimpsest CORE-2).
//
// Vocabulary (ADR-0039): a **view** produces a tree of nodes and touches
// nothing; **render** commits a tree into a live container. This file is the
// one primitive that does the committing. It was called `morph()` until
// ADR-0039 — the technique is the one morphdom and Idiomorph implement, and
// searching "DOM morphing" is still the way to read up on it.
//
// A view is a pure function `state -> h() tree` (see src/lib/html.js). Because
// h() builds *real* DOM nodes, a re-render produces a fresh detached tree.
// render() patches the live subtree to match that fresh tree, mutating existing
// nodes in place instead of replacing them — so input focus, caret/selection,
// and scroll position survive a render with **no** snapshot/restore machinery.
//
// The pieces that make that work:
//   - Keyed identity. A node carries a `key` (or `data-key`) attribute; keyed
//     children are matched across renders by key, so a reorder *moves* the same
//     DOM node rather than rebuilding it. Unkeyed children match by position.
//   - Controlled form props. `value`/`checked` are applied as properties and
//     only when the *authored* value actually changed — an unrelated re-render
//     never clobbers what a user is mid-way through typing.
//   - Prop diffing off recorded props. h() records the props it built each node
//     with (html.js getProps); render() diffs previous vs next authored props,
//     which is the only portable way to know which listener to remove or which
//     attribute to drop (the live DOM does not expose either).
//   - O(1) reference skip. If the new vnode is the *same object* as the live
//     node (what CORE-4 memo() returns for an unchanged card), render() returns
//     immediately without touching its subtree.
//   - Minimal moves. A longest-increasing-subsequence pass leaves nodes that
//     are already in relative order untouched, so reordering the siblings
//     around a focused input does not disturb the input.
//
// Hard rules honoured: no third-party code, no innerHTML for user data (all
// mutation is via DOM node APIs and html.js's applyProp/removeProp).

import { applyProp, removeProp, getProps, setProps } from '../lib/html.js';

/**
 * Instrumentation counters, mutated in place when a stats object is passed to
 * {@link render}. Used by tests to assert, e.g., that a reference-equal subtree
 * is skipped without traversal.
 * @typedef {Object} RenderStats
 * @property {number} [visited]         - node pairs examined by patch()
 * @property {number} [patchedElements] - elements patched in place (props/children)
 * @property {number} [createdNodes]    - fresh nodes inserted
 * @property {number} [removedNodes]    - live nodes removed
 * @property {number} [movedNodes]      - kept nodes moved to a new position
 */

/**
 * @param {RenderStats} stats
 * @param {keyof RenderStats} key
 */
function bump(stats, key) {
  stats[key] = (stats[key] || 0) + 1;
}

/**
 * The tag/kind of a node: `'#text'` for text nodes, the uppercase tag name for
 * elements. `nodeName` is defined on every node in both the real DOM and the
 * test stub, so it classifies both uniformly.
 * @param {any} node
 * @returns {string}
 */
function tagOf(node) {
  return node.nodeName;
}

/**
 * @param {any} node
 * @returns {boolean}
 */
function isText(node) {
  return tagOf(node) === '#text';
}

/**
 * The reconciliation key of a node, or `null` if it has none. Authors pass
 * `{ key }` (or `{ 'data-key': … }`) to h(); both land as attributes.
 * @param {any} node
 * @returns {string | null}
 */
function keyOf(node) {
  if (isText(node)) return null;
  const k = node.getAttribute('data-key');
  return k != null ? k : node.getAttribute('key');
}

/**
 * Two nodes are the "same" — and therefore patchable in place rather than
 * replaced — when they are both text, or both elements of the same tag *and*
 * the same key.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function sameType(a, b) {
  const ta = tagOf(a);
  if (ta !== tagOf(b)) return false;
  if (ta === '#text') return true;
  return keyOf(a) === keyOf(b);
}

/**
 * Diff the authored props of a kept element against the new element's props and
 * apply the difference in place. `value`/`checked` are handled separately as
 * controlled form props (see {@link patchFormProp}).
 * @param {any} oldEl
 * @param {any} newEl
 */
function patchProps(oldEl, newEl) {
  const oldProps = getProps(oldEl) || {};
  const newProps = getProps(newEl) || {};
  const keys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
  for (const key of keys) {
    // value/checked are controlled form properties, reconciled below against
    // the *authored* value so an unrelated re-render can't clobber an in-flight
    // edit. They are only ever authored on form controls in this codebase.
    if (key === 'value' || key === 'checked') continue;
    let ov = oldProps[key];
    if (ov == null) ov = undefined;
    let nv = newProps[key];
    if (nv == null) nv = undefined;
    if (ov === nv) continue; // unchanged, incl. a referentially-stable handler
    if (ov !== undefined) removeProp(oldEl, key, ov);
    if (nv !== undefined) applyProp(oldEl, key, nv);
  }
  patchFormProp(oldEl, oldProps, newProps, 'value');
  patchFormProp(oldEl, oldProps, newProps, 'checked');
  setProps(oldEl, newProps);
}

/**
 * Reconcile a controlled form property (`value` or `checked`) on a kept
 * element. The rule that preserves an in-flight edit: compare the *authored*
 * (intended) values, not the live DOM value. If the intended value did not
 * change between renders, the live value is left completely alone — so a
 * re-render triggered by something else never overwrites what the user is
 * typing. When the intended value genuinely changed, it is reflected, and even
 * then only if it actually differs from what is already on screen (so the caret
 * is not disturbed needlessly).
 * @param {any} oldEl
 * @param {Record<string, any>} oldProps
 * @param {Record<string, any>} newProps
 * @param {'value' | 'checked'} name
 */
function patchFormProp(oldEl, oldProps, newProps, name) {
  const has = newProps[name] != null;
  const had = oldProps[name] != null;
  if (!has && !had) return;
  if (!has) {
    // The prop was controlled last render and is not any more — reset.
    if (name === 'checked') oldEl.checked = false;
    else oldEl.value = '';
    return;
  }
  if (name === 'checked') {
    const nb = !!newProps.checked;
    const ob = had ? !!oldProps.checked : undefined;
    if (nb === ob) return;
    if (oldEl.checked !== nb) oldEl.checked = nb;
  } else {
    const nv = newProps.value;
    const ov = had ? oldProps.value : undefined;
    if (nv === ov) return; // intended value unchanged → keep the user's edit
    if (oldEl.value !== String(nv)) oldEl.value = nv;
  }
}

/**
 * Patch a single matched node in place. Callers only invoke this for nodes that
 * already satisfy {@link sameType}; replacement of mismatched nodes happens in
 * {@link patchChildren}. Returns the node that now occupies the slot (always
 * the kept `oldNode`).
 * @param {any} oldNode
 * @param {any} newNode
 * @param {RenderStats} stats
 * @returns {any}
 */
function patch(oldNode, newNode, stats) {
  bump(stats, 'visited');
  // Reference-equal skip: the new vnode is literally the live node (what
  // memo() returns for an unchanged subtree). Nothing to do, and crucially we
  // do not descend — this is the O(1) fast path CORE-4 relies on.
  if (oldNode === newNode) return oldNode;
  if (isText(oldNode)) {
    if (oldNode.textContent !== newNode.textContent) {
      oldNode.textContent = newNode.textContent;
    }
    return oldNode;
  }
  bump(stats, 'patchedElements');
  patchProps(oldNode, newNode);
  patchChildren(oldNode, Array.from(newNode.childNodes), stats);
  return oldNode;
}

/**
 * Keyed reconciliation of a parent's children against a new child list.
 * Matches keyed children by key and unkeyed children by position, patches the
 * survivors in place, removes the rest, and places everything in the new order
 * with the fewest possible moves.
 * @param {any} parent
 * @param {any[]} newChildren - real DOM nodes (elements/text) from the new tree
 * @param {RenderStats} stats
 */
function patchChildren(parent, newChildren, stats) {
  const oldNodes = Array.from(parent.childNodes);
  const oldIndex = new Map(oldNodes.map((node, index) => [node, index]));

  /** @type {Map<string, any>} */
  const oldByKey = new Map();
  /** @type {any[]} */
  const unkeyedOld = [];
  for (const o of oldNodes) {
    const k = keyOf(o);
    if (k != null) oldByKey.set(k, o);
    else unkeyedOld.push(o);
  }

  const used = new Set();
  /** @type {any[]} */
  const result = new Array(newChildren.length);
  // source[i] = index of result[i] within oldNodes, or -1 if it is fresh.
  /** @type {number[]} */
  const source = new Array(newChildren.length);
  let unkeyedPtr = 0;

  for (let i = 0; i < newChildren.length; i++) {
    const nv = newChildren[i];
    const k = keyOf(nv);
    let match = null;
    if (k != null) {
      const cand = oldByKey.get(k);
      if (cand && !used.has(cand) && sameType(cand, nv)) match = cand;
    } else if (unkeyedPtr < unkeyedOld.length) {
      const cand = unkeyedOld[unkeyedPtr++];
      if (sameType(cand, nv)) match = cand;
      // else: positional type mismatch → cand is removed below, nv is fresh.
    }
    if (match) {
      used.add(match);
      result[i] = patch(match, nv, stats);
      source[i] = /** @type {number} */ (oldIndex.get(match));
    } else {
      result[i] = nv;
      source[i] = -1;
    }
  }

  for (const o of oldNodes) {
    if (!used.has(o)) {
      parent.removeChild(o);
      bump(stats, 'removedNodes');
    }
  }

  placeChildren(parent, result, source, stats);
}

/**
 * Put `result` into `parent` in order, moving as few kept nodes as possible.
 * Nodes whose old positions already form an increasing run (the LIS of
 * `source`) are left where they are; everything else is inserted before its
 * already-placed successor. Walking right-to-left means `result[i + 1]` is
 * always the correct, already-final reference node.
 * @param {any} parent
 * @param {any[]} result
 * @param {number[]} source
 * @param {RenderStats} stats
 */
function placeChildren(parent, result, source, stats) {
  const stable = longestIncreasingSubsequence(source);
  for (let i = result.length - 1; i >= 0; i--) {
    const node = result[i];
    const ref = i + 1 < result.length ? result[i + 1] : null;
    if (source[i] === -1) {
      parent.insertBefore(node, ref);
      bump(stats, 'createdNodes');
    } else if (!stable.has(i)) {
      parent.insertBefore(node, ref);
      bump(stats, 'movedNodes');
    }
    // else: part of the stable run — already in the right place, don't move it.
  }
}

/**
 * Indices `i` (into `source`) whose values form a longest strictly-increasing
 * subsequence, ignoring `-1` (fresh) entries. These are the kept nodes that are
 * already in relative order and need not move. Patience-sorting LIS with
 * predecessor links.
 * @param {number[]} source
 * @returns {Set<number>}
 */
function longestIncreasingSubsequence(source) {
  /** @type {number[]} */
  const positions = []; // result-indices under consideration, in order
  /** @type {number[]} */
  const values = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== -1) {
      positions.push(i);
      values.push(source[i]);
    }
  }

  /** @type {Set<number>} */
  const keep = new Set();
  const n = values.length;
  if (n === 0) return keep;

  /** @type {number[]} */
  const piles = []; // piles[p] = index (into values) of the top of pile p
  /** @type {number[]} */
  const tops = []; // tops[p] = value at the top of pile p
  const prev = new Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const v = values[i];
    let lo = 0;
    let hi = piles.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = piles[lo - 1];
    piles[lo] = i;
    tops[lo] = v;
  }

  let k = piles[piles.length - 1];
  while (k !== -1) {
    keep.add(positions[k]);
    k = prev[k];
  }
  return keep;
}

/**
 * Normalise whatever a view returned into a flat list of child nodes to
 * reconcile: a single node, an array of nodes, a DocumentFragment, or nothing.
 * @param {any} tree
 * @returns {any[]}
 */
function normalizeRoot(tree) {
  if (tree == null || tree === false) return [];
  if (typeof tree === 'string') {
    throw new TypeError(
      'render(): view returned a string; wrap it in an element'
    );
  }
  if (Array.isArray(tree)) {
    /** @type {any[]} */
    const out = [];
    for (const t of tree) out.push(...normalizeRoot(t));
    return out;
  }
  // A DocumentFragment reports nodeName '#document-fragment' — reconcile against
  // its childNodes rather than treating the fragment itself as a node.
  if (tree.nodeName === '#document-fragment') {
    return Array.from(tree.childNodes);
  }
  return [tree];
}

/**
 * Patch `parent`'s children in place to match `tree`, the freshly-built h()
 * output of a pure view. Existing DOM nodes are mutated rather than replaced
 * wherever the two trees line up, so focus, caret, selection, and scroll
 * survive the render.
 * @param {any} parent - the live container whose children are reconciled
 * @param {any} tree - a node, array of nodes, fragment, or null/false
 * @param {RenderStats} [stats] - optional instrumentation, mutated in place
 * @returns {RenderStats} the stats object (a fresh one if none was passed)
 */
export function render(parent, tree, stats) {
  const s = stats || {};
  patchChildren(parent, normalizeRoot(tree), s);
  return s;
}
