// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass } from './_dom-stub.js';

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
    onChange: (party) => changes.push(party),
    ...props,
  });
  return { host: /** @type {any} */ (host), changes };
}

// ===== TESTS =====

test('AttributeMenu: renders the inline "Attribute failure to" title', () => {
  const { host } = mount();

  const title = findByClass(host, 'cora-attribute-title');
  assert.ok(title, 'title rendered');
  assert.equal(title.textContent, 'Attribute failure to');
});

test('AttributeMenu: unset shows the picker inline, no chip or clear', () => {
  const { host } = mount({
    client: /** @type {any} */ ({
      async searchPeople() {
        return [];
      },
    }),
  });

  assert.ok(
    findByTag(host, 'cora-people-picker'),
    'people picker shown inline'
  );
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

test('AttributeMenu: choosing the Responsible Party calls onChange', () => {
  const { host, changes } = mount({ responsibleParty: RESPONSIBLE });

  findByClass(host, 'cora-attribute-responsible')._fire('click');

  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], RESPONSIBLE);
});

test('AttributeMenu: embeds a people picker wired to the client', () => {
  const client = /** @type {any} */ ({
    async searchPeople() {
      return [];
    },
  });
  const { host } = mount({ client });

  const picker = findByTag(host, 'cora-people-picker');
  assert.ok(picker, 'people picker rendered');
  assert.equal(picker.client, client, 'picker receives the client');
});

test('AttributeMenu: selecting someone via search calls onChange with that person', () => {
  const { host, changes } = mount({
    client: /** @type {any} */ ({
      async searchPeople() {
        return [];
      },
    }),
  });

  findByTag(host, 'cora-people-picker')._fire('cora-person-selected', {
    detail: PERSON,
  });

  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], PERSON);
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
  assert.equal(
    findByTag(host, 'cora-people-picker'),
    null,
    'picker hidden once attributed; clear to re-attribute'
  );
  assert.equal(
    findByClass(host, 'cora-attribute-responsible'),
    null,
    'quick-pick hidden once attributed'
  );
});

test('AttributeMenu: clicking clear calls onChange with a null party', () => {
  const { host, changes } = mount({ attributedParty: PERSON });

  findByClass(host, 'cora-attribute-clear')._fire('click');

  assert.equal(changes.length, 1);
  assert.equal(changes[0], null);
});
