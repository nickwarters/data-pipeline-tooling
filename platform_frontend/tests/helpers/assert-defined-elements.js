// @ts-check
/**
 * Reusable page-test guard against the silent-failure mode this repo cares
 * most about: rendering a `<cora-x>` tag without a side-effect import of its
 * defining module. The browser (and the `_dom-stub.js` `customElements`
 * stub) happily create an inert element for an unknown tag name and never
 * throw, so without an explicit assertion a missing import shows up as a
 * blank patch of UI rather than a test failure.
 *
 * Walks every descendant of a mounted container and asserts that each
 * `cora-*` tag encountered is a registered custom element.
 */
import assert from 'node:assert/strict';

/**
 * @param {{ tagName?: string, _children?: any[], querySelectorAll?: (sel: string) => any[] }} root
 * @returns {string[]}
 */
function collectTagNames(root) {
  /** @type {string[]} */
  const tags = [];

  // Prefer the stub's own traversal helper when available; fall back to a
  // manual `_children` walk so this also works against real DOM nodes.
  if (typeof root.querySelectorAll === 'function') {
    for (const el of root.querySelectorAll('*')) {
      if (el.tagName) tags.push(el.tagName);
    }
    return tags;
  }

  /** @param {any} node */
  function walk(node) {
    for (const child of node._children ?? []) {
      if (child.tagName) tags.push(child.tagName);
      walk(child);
    }
  }
  walk(root);
  return tags;
}

/**
 * Assert every `cora-*` tag under `container` is a registered custom
 * element. Call after mounting a page (and flushing any pending renders) in
 * a page-level test.
 * @param {any} container
 */
export function assertAllCoraElementsDefined(container) {
  const tags = collectTagNames(container);
  const unregistered = new Set(
    tags
      .filter((tag) => tag.toLowerCase().startsWith('cora-'))
      .filter((tag) => customElements.get(tag.toLowerCase()) === undefined)
  );
  assert.deepEqual(
    [...unregistered],
    [],
    `Found <cora-*> tags with no registered custom element (missing a ` +
      `side-effect import of the defining module?): ${[...unregistered].join(', ')}`
  );
}
