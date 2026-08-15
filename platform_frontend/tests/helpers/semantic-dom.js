// @ts-check
import { walk } from '../_dom-stub.js';

/** @typedef {string | RegExp} NameMatcher */

/** @param {any} element */
function implicitRole(element) {
  if (/^H[1-6]$/.test(element.tagName)) return 'heading';
  if (element.tagName === 'UL' || element.tagName === 'OL') return 'list';
  if (element.tagName === 'LI') return 'listitem';
  if (element.tagName === 'OPTION') return 'option';
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
  if (element.tagName === 'FIELDSET') return 'group';
  if (element.tagName !== 'INPUT') return null;

  const type = String(element.type || 'text').toLowerCase();
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (['button', 'reset', 'submit'].includes(type)) return 'button';
  return 'textbox';
}

/**
 * Accessible-name-style text of an element: leaf/text nodes contribute their
 * own text; a node with children contributes its children's text, space-joined
 * (so sibling contributions read as separate words). The stub now models text
 * as real `#text` child nodes, so we recurse into children rather than reading
 * a node's aggregated `.textContent` (which would double-count).
 * @param {any} element
 * @returns {string}
 */
export function textContent(element) {
  const kids = element._children ?? [];
  if (kids.length === 0) {
    return String(element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const parts = [];
  for (const child of kids) parts.push(textContent(child));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** @param {any} element */
function accessibleName(element) {
  const wrappingLabel =
    element.parentNode?.tagName === 'LABEL' ? element.parentNode : null;
  const labelText = wrappingLabel
    ? textContent(
        wrappingLabel._children?.find(
          (/** @type {any} */ child) => child !== element
        ) ?? wrappingLabel
      )
    : '';
  // A grouping element's own text is every control inside it, which names
  // nothing useful; its `<legend>` is the caption a user reads.
  const legend = element._children?.find(
    (/** @type {any} */ child) => child.tagName === 'LEGEND'
  );
  return (
    element.getAttribute?.('aria-label') ||
    labelText ||
    (legend ? textContent(legend) : '') ||
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

/**
 * Return the definition associated with one exact term in a definition list.
 * Both the requested term and rendered term use the same whitespace
 * normalisation as the other semantic helpers.
 *
 * @param {any} root
 * @param {string} term
 */
export function definitionFor(root, term) {
  const expected = term.replace(/\s+/g, ' ').trim();
  const matches = queryAllByTag(root, 'dt').filter(
    (candidate) => textContent(candidate) === expected
  );
  if (matches.length === 0) {
    throw new Error(`Unable to find definition term "${expected}"`);
  }
  if (matches.length > 1) {
    throw new Error(`Found multiple definition terms "${expected}"`);
  }

  const termNode = matches[0];
  const list = termNode.parentNode;
  const siblings = list?.childNodes ?? [];
  const index = siblings.indexOf(termNode);
  const definition =
    index >= 0
      ? (siblings
          .slice(index + 1)
          .find(
            (/** @type {any} */ sibling) =>
              sibling.tagName !== '#text' || textContent(sibling) !== ''
          ) ?? null)
      : null;
  if (list?.tagName !== 'DL' || definition?.tagName !== 'DD') {
    throw new Error(
      `Definition term "${expected}" must be followed by a DD in the same DL`
    );
  }
  return definition;
}

/**
 * The rendered column contract for a table: heading text, `aria-sort`, and
 * whether the header renders an interactive control, in document order.
 *
 * The third element is what makes the contract load-bearing. `data-table.js`
 * derives `aria-sort` from the active sort key alone, independent of
 * `sortable`; `sortable` only decides whether the heading is a `<button>` or
 * bare text, and the text is identical either way. Without the control check,
 * dropping `sortable` from a shared descriptor renders a dead, unclickable
 * header that the first two elements happily accept.
 *
 * @param {any} root
 * @returns {[string, string, boolean][]}
 */
export function tableHeaders(root) {
  return queryAllByTag(root, 'th').map((th) => [
    th.textContent,
    th.getAttribute('aria-sort') ?? 'none',
    !!th.querySelector('button'),
  ]);
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
