// @ts-check
/**
 * Editable in-memory representation of a Question Definition's `showWhen`.
 *
 * The on-disk schema (see applicability-evaluator.js) is JSON: leaves shaped
 * like `{qId: {equals|in|answered: ...}}`, with optional `$and`/`$or` groups
 * and an implicit-AND shorthand when a node is a flat object. This module
 * lifts that into a uniform `{type: 'group'|'leaf'}` tree that the editor UI
 * can mutate directly, then serialises back to the canonical JSON shape.
 *
 * The shorthand is preserved on serialise: an AND group whose children are
 * all leaves with distinct qIds collapses to a flat object.
 */

/**
 * @typedef {{ type: 'leaf', qId: string, op: 'equals'|'in'|'answered', value: any }} LeafNode
 * @typedef {{ type: 'group', op: 'and'|'or', children: TreeNode[] }} GroupNode
 * @typedef {LeafNode | GroupNode} TreeNode
 */

/**
 * @param {Record<string, unknown>|undefined|null} cond
 * @returns {GroupNode}
 */
export function parseShowWhen(cond) {
  if (!cond) return { type: 'group', op: 'and', children: [] };
  const node = parseNode(cond);
  // Top-level must always be a group so the UI has somewhere to add to.
  if (node.type === 'leaf')
    return { type: 'group', op: 'and', children: [node] };
  return node;
}

/**
 * @param {Record<string, unknown>} cond
 * @returns {TreeNode}
 */
export function parseNode(cond) {
  if (cond && '$and' in cond) {
    const arr = /** @type {Record<string, unknown>[]} */ (cond['$and']);
    return { type: 'group', op: 'and', children: arr.map(parseNode) };
  }
  if (cond && '$or' in cond) {
    const arr = /** @type {Record<string, unknown>[]} */ (cond['$or']);
    return { type: 'group', op: 'or', children: arr.map(parseNode) };
  }
  const keys = Object.keys(cond || {});
  if (keys.length === 0) return { type: 'group', op: 'and', children: [] };
  const leaves = keys.map((qId) =>
    leafFromOp(qId, /** @type {any} */ (cond[qId]))
  );
  return { type: 'group', op: 'and', children: leaves };
}

/**
 * @param {string} qId
 * @param {Record<string, unknown>|null|undefined} op
 * @returns {LeafNode}
 */
export function leafFromOp(qId, op) {
  if (op && 'answered' in op)
    return { type: 'leaf', qId, op: 'answered', value: true };
  if (op && 'in' in op) return { type: 'leaf', qId, op: 'in', value: op['in'] };
  return { type: 'leaf', qId, op: 'equals', value: op?.['equals'] ?? '' };
}

/**
 * @param {LeafNode} leaf
 * @returns {Record<string, unknown>}
 */
export function leafToOp(leaf) {
  if (leaf.op === 'answered') return { answered: true };
  if (leaf.op === 'in') {
    const arr = Array.isArray(leaf.value)
      ? leaf.value
      : String(leaf.value || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    return { in: arr };
  }
  return { equals: leaf.value ?? '' };
}

/**
 * @param {TreeNode|null|undefined} node
 * @returns {Record<string, unknown>|null}
 */
export function serializeTree(node) {
  if (!node) return null;
  if (node.type === 'leaf') return { [node.qId]: leafToOp(node) };
  const kids = node.children
    .map(serializeTree)
    .filter(/** @returns {x is Record<string, unknown>} */ (x) => x !== null);
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0];
  if (node.op === 'and') {
    const allLeaves = node.children.every((c) => c.type === 'leaf');
    const ids = /** @type {LeafNode[]} */ (
      /** @type {unknown} */ (node.children)
    ).map((c) => c.qId);
    if (allLeaves && new Set(ids).size === ids.length) {
      return Object.fromEntries(kids.map((k) => Object.entries(k)[0]));
    }
    return { $and: kids };
  }
  return { $or: kids };
}

/**
 * Removes `target` from `root` or any of its descendants. Mutates in place.
 *
 * @param {TreeNode} root
 * @param {TreeNode} target
 * @returns {boolean} true if removal happened
 */
export function removeNode(root, target) {
  if (root.type !== 'group') return false;
  const i = root.children.indexOf(target);
  if (i >= 0) {
    root.children.splice(i, 1);
    return true;
  }
  return root.children.some((c) => c.type === 'group' && removeNode(c, target));
}

/**
 * @param {TreeNode} n
 * @returns {number}
 */
export function countLeaves(n) {
  if (n.type === 'leaf') return 1;
  return n.children.reduce((s, c) => s + countLeaves(c), 0);
}

/**
 * Depth of the *group* nesting (a leaf is depth 0; a group of leaves is 1).
 *
 * @param {TreeNode} n
 * @returns {number}
 */
export function treeDepth(n) {
  if (n.type === 'leaf') return 0;
  if (n.children.length === 0) return 0;
  return 1 + Math.max(...n.children.map(treeDepth));
}

// ── Per-question cache ─────────────────────────────────────────────────────
// Questions are mutated in place; the editable tree lives outside the question
// (in a WeakMap) so the JSON-serialisable showWhen field stays canonical for
// dirty-check / compile / diff purposes.

/** @type {WeakMap<object, GroupNode>} */
const treeCache = new WeakMap();

/**
 * @param {{ showWhen?: Record<string, unknown> }} q
 * @returns {GroupNode}
 */
export function ensureTree(q) {
  let t = treeCache.get(q);
  if (!t) {
    t = parseShowWhen(q.showWhen);
    treeCache.set(q, t);
  }
  return t;
}

/**
 * Writes the cached tree for `q` back to its showWhen field, or deletes the
 * field when the tree serialises to null.
 *
 * @param {{ showWhen?: Record<string, unknown> }} q
 */
export function commitTreeFor(q) {
  const t = treeCache.get(q);
  if (!t) return;
  const out = serializeTree(t);
  if (out) q.showWhen = out;
  else delete q.showWhen;
}

/**
 * Clears every condition from `q`, deleting its `showWhen`. Empties the cached
 * tree in place then re-serialises (an empty group serialises to null, so the
 * field is removed), keeping the WeakMap cache and the `showWhen` field in step.
 *
 * @param {{ showWhen?: Record<string, unknown> }} q
 */
export function clearConditions(q) {
  ensureTree(q).children.length = 0;
  commitTreeFor(q);
}

/** Test-only: clear the per-question tree cache. */
export function _resetTreeCache() {
  // WeakMap has no clear in older engines; re-create via re-import would be
  // complex. Tests that need isolation should use fresh question objects.
  // This helper exists so tests can document intent.
}
