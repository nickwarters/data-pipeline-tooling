// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';

installDom();

// ===== IMPORTS (after stubs) =====
const { AttributeMenu } =
  await import('../src/components/sections/cora-attribute-menu.js');

// ===== HELPERS =====

/** @param {any} root @param {string} tag @returns {any} */
function findByTag(root, tag) {
  for (const c of root._children ?? []) {
    if (c._tagName === tag) return c;
    const nested = findByTag(c, tag);
    if (nested) return nested;
  }
  return null;
}

const RESPONSIBLE = { loginName: 'rparty', displayName: 'rparty' };
const PERSON = { loginName: 'jsmith', displayName: 'Jane Smith' };

/**
 * @param {Parameters<typeof AttributeMenu>[0]} [props]
 * @returns {{ host: any, changes: Array<any> }}
 */
function mount(props = {}) {
  /** @type {any[]} */
  const changes = [];
  const host = AttributeMenu({
    onSelect: (party) => changes.push(party),
    onClear: () => changes.push(null),
    ...props,
  });
  return { host: /** @type {any} */ (host), changes };
}

// ===== TESTS =====

test('AttributeMenu: root is a plain classed div, not an unregistered custom element', () => {
  const { host } = mount();

  // A `cora-*` element tag without a customElements.define() trips the
  // dev-mode warning in lib/html.js. The menu is a plain view function, so
  // its root must be an ordinary div carrying the class for styling.
  assert.equal(host._tagName, 'div');
  assert.equal(host.className, 'cora-attribute-menu');
});

test('AttributeMenu: renders the inline "Attribute failure to" title', () => {
  const { host } = mount();

  const title = findByClass(host, 'cora-attribute-title');
  assert.ok(title, 'title rendered');
  assert.equal(title.textContent, 'Attribute failure to');
});

test('AttributeMenu: unset renders the PeoplePicker combobox directly, no chip or clear', () => {
  const { host } = mount();

  // The picker is a classed div wrapper, never a `cora-people-picker`
  // element — the class is the CSS hook, the element type is not.
  assert.equal(findByTag(host, 'cora-people-picker'), null);
  assert.ok(
    findByClass(host, 'cora-people-picker'),
    'picker wrapper rendered so its results list has a containing block'
  );
  assert.ok(host.querySelector('[role="combobox"]'), 'combobox shown inline');
  assert.equal(
    findByClass(host, 'cora-attribute-current'),
    null,
    'no current-party chip when unset'
  );
  assert.equal(
    findByClass(host, 'cora-attribute-clear'),
    null,
    'no clear when unset'
  );
});

test('AttributeMenu: shows the Responsible Party quick-pick when set and unattributed', () => {
  const { host } = mount({ responsibleParty: RESPONSIBLE });

  const quick = findByClass(host, 'cora-attribute-responsible');
  assert.ok(quick, 'responsible-party quick-pick rendered');
  assert.equal(quick.textContent, 'Responsible Party — rparty');
});

test('AttributeMenu: omits the Responsible Party quick-pick when none is set', () => {
  const { host } = mount({ responsibleParty: null });

  assert.equal(findByClass(host, 'cora-attribute-responsible'), null);
});

test('AttributeMenu: choosing the Responsible Party calls onSelect', () => {
  const { host, changes } = mount({ responsibleParty: RESPONSIBLE });

  findByClass(host, 'cora-attribute-responsible')._fire('click');

  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], RESPONSIBLE);
});

test('AttributeMenu: renders the pure picker input and results list', () => {
  const { host } = mount();

  assert.ok(host.querySelector('[role="combobox"]'));
  assert.ok(host.querySelector('[role="listbox"]'));
});

test('AttributeMenu: renders supplied results and reports controlled input and selection', () => {
  /** @type {string[]} */
  const inputs = [];
  /** @type {any[]} */
  const selections = [];
  const { host } = mount({
    query: 'Jane',
    people: [PERSON],
    onQueryInput: (/** @type {string} */ value) => inputs.push(value),
    onSelect: (/** @type {any} */ person) => selections.push(person),
  });

  const input = host.querySelector('[role="combobox"]');
  assert.equal(input.value, 'Jane');
  assert.equal(
    host.querySelector('[role="option"]')?.textContent,
    'Jane Smith — jsmith'
  );
  input.value = 'Janet';
  fireEvent(input, 'input');
  fireEvent(host.querySelector('[role="option"]'), 'click');

  assert.deepEqual(inputs, ['Janet']);
  assert.deepEqual(selections, [PERSON]);
});

test('AttributeMenu: when set, shows the attributed person and a clear button, no picker', () => {
  const { host } = mount({ attributedParty: PERSON });

  const current = findByClass(host, 'cora-attribute-current');
  assert.ok(current, 'current party shown when attributed');
  assert.equal(current.textContent, 'Jane Smith');
  assert.ok(
    findByClass(host, 'cora-attribute-clear'),
    'clear button rendered when attributed'
  );
  assert.equal(findByTag(host, 'cora-people-picker'), null);
  assert.equal(
    findByClass(host, 'cora-people-picker'),
    null,
    'picker hidden once attributed; clear to re-attribute'
  );
  assert.equal(
    findByClass(host, 'cora-attribute-responsible'),
    null,
    'quick-pick hidden once attributed'
  );
});

test('AttributeMenu: clicking clear calls onClear', () => {
  const { host, changes } = mount({ attributedParty: PERSON });

  findByClass(host, 'cora-attribute-clear')._fire('click');

  assert.equal(changes.length, 1);
  assert.equal(changes[0], null);
});
