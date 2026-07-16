// @ts-check
import { walk } from '../_dom-stub.js';

/** @typedef {string | RegExp} NameMatcher */

/** @param {any} element */
function implicitRole(element) {
  if (element.tagName === 'BUTTON') return 'button';
  if (element.tagName === 'TEXTAREA') return 'textbox';
  if (element.tagName === 'SELECT') return 'combobox';
  if (element.tagName === 'TABLE') return 'table';
  if (element.tagName === 'THEAD' || element.tagName === 'TBODY')
    return 'rowgroup';
  if (element.tagName === 'TR') return 'row';
  if (element.tagName === 'TH') return 'columnheader';
  if (element.tagName === 'TD') return 'cell';
  if (element.tagName === 'HEADER') return 'banner';
  if (element.tagName !== 'INPUT') return null;

  const type = String(element.type || 'text').toLowerCase();
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (['button', 'reset', 'submit'].includes(type)) return 'button';
  return 'textbox';
}

/** @param {any} element */
export function textContent(element) {
  const parts = [element.textContent || ''];
  for (const child of element._children ?? []) parts.push(textContent(child));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** @param {any} element */
function accessibleName(element) {
  return (
    element.getAttribute?.('aria-label') ||
    textContent(element) ||
    element.getAttribute?.('title') ||
    ''
  );
}

/** @param {string} actual @param {NameMatcher | undefined} expected */
function nameMatches(actual, expected) {
  if (expected === undefined) return true;
  return typeof expected === 'string'
    ? actual === expected
    : expected.test(actual);
}

/**
 * Return descendants with the requested explicit or implicit ARIA role.
 * Tests can query controls by what a user perceives instead of by child index.
 *
 * @param {any} root
 * @param {string} role
 * @param {{ name?: NameMatcher }} [options]
 */
export function queryAllByRole(root, role, options = {}) {
  /** @type {any[]} */
  const matches = [];
  walk(root, (element) => {
    const actualRole = element.getAttribute?.('role') || implicitRole(element);
    if (
      actualRole === role &&
      nameMatches(accessibleName(element), options.name)
    ) {
      matches.push(element);
    }
  });
  return matches;
}

/**
 * @param {any} root
 * @param {string} role
 * @param {{ name?: NameMatcher }} [options]
 */
export function queryByRole(root, role, options = {}) {
  const matches = queryAllByRole(root, role, options);
  if (matches.length > 1) {
    throw new Error(`Found multiple elements with role "${role}"`);
  }
  return matches[0] ?? null;
}

/**
 * @param {any} root
 * @param {string} role
 * @param {{ name?: NameMatcher }} [options]
 */
export function getByRole(root, role, options = {}) {
  const match = queryByRole(root, role, options);
  if (!match) {
    const named = options.name ? ` and name "${String(options.name)}"` : '';
    throw new Error(`Unable to find an element with role "${role}"${named}`);
  }
  return match;
}

/**
 * Query custom elements and structural HTML landmarks without depending on
 * their position in a parent's child list.
 *
 * @param {any} root
 * @param {string} tag
 */
export function queryAllByTag(root, tag) {
  const wanted = tag.toUpperCase();
  /** @type {any[]} */
  const matches = [];
  walk(root, (element) => {
    if (wanted === '*' || element.tagName === wanted) matches.push(element);
  });
  return matches;
}

/** @param {any} root @param {string} tag */
export function queryByTag(root, tag) {
  const matches = queryAllByTag(root, tag);
  if (matches.length > 1) {
    throw new Error(`Found multiple elements with tag "${tag}"`);
  }
  return matches[0] ?? null;
}

/** @param {any} root @param {string} tag */
export function getByTag(root, tag) {
  const match = queryByTag(root, tag);
  if (!match) throw new Error(`Unable to find an element with tag "${tag}"`);
  return match;
}

/** @param {any} root @param {NameMatcher} expected */
export function queryAllByText(root, expected) {
  /** @type {any[]} */
  const matches = [];
  walk(root, (element) => {
    if (
      element.tagName !== '#text' &&
      nameMatches(textContent(element), expected)
    ) {
      matches.push(element);
    }
  });
  return matches;
}

/** @param {any} root @param {NameMatcher} expected */
export function getByText(root, expected) {
  const matches = queryAllByText(root, expected);
  const leaf = matches.find(
    (element) => !queryAllByText(element, expected).length
  );
  if (!leaf) throw new Error(`Unable to find text "${String(expected)}"`);
  return leaf;
}

/** @param {any} root @param {string} testId */
export function getByTestId(root, testId) {
  const matches = queryAllByTag(root, '*').filter(
    (element) => element.getAttribute?.('data-testid') === testId
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one element with data-testid "${testId}", found ${matches.length}`
    );
  }
  return matches[0];
}

/**
 * Dispatch an event through the public DOM API with browser-like defaults.
 *
 * @param {any} element
 * @param {string} type
 * @param {Record<string, any>} [init]
 */
export function fireEvent(element, type, init = {}) {
  const event = {
    ...init,
    type,
    bubbles: init.bubbles ?? true,
    target: init.target ?? element,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  element.dispatchEvent(event);
  return event;
}
