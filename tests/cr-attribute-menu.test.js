// @ts-check
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass } from './_dom-stub.js';

installDom();

const docListeners = /** @type {any} */ (globalThis).document._listeners;

// ===== IMPORTS (after stubs) =====
const { AttributeMenu } =
  await import('../src/components/cr-attribute-menu.js');

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

/** @returns {{ key: string, preventDefault: () => void }} */
function keyEvent(/** @type {string} */ key) {
  return { key, preventDefault() {} };
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

// Each menu registers document-level listeners; clear them between tests so a
// prior test's (still-connected) menu can't fire on the shared stub document
// and pollute the assertions below.
beforeEach(() => {
  for (const key of Object.keys(docListeners)) delete docListeners[key];
});

// ===== TESTS =====

test('AttributeMenu: unset renders an Attribute trigger, no chip or clear, popover hidden', () => {
  const { host } = mount();

  assert.ok(
    findByClass(host, 'cr-attribute-trigger'),
    'trigger button rendered'
  );
  assert.equal(
    findByClass(host, 'cr-attribute-chip'),
    null,
    'no chip when unset'
  );
  assert.equal(
    findByClass(host, 'cr-attribute-clear'),
    null,
    'no clear when unset'
  );
  assert.equal(
    findByClass(host, 'cr-attribute-popover').hidden,
    true,
    'popover starts hidden'
  );
});

test('AttributeMenu: when set, renders a chip with the displayName and a clear button', () => {
  const { host } = mount({ attributedParty: PERSON });

  const chip = findByClass(host, 'cr-attribute-chip');
  assert.ok(chip, 'chip rendered when attributed');
  assert.equal(chip.textContent, 'Jane Smith');
  assert.ok(
    findByClass(host, 'cr-attribute-clear'),
    'clear button rendered when attributed'
  );
  assert.equal(
    findByClass(host, 'cr-attribute-trigger'),
    null,
    'plain trigger replaced by chip'
  );
});

test('AttributeMenu: clicking the chip opens the popover so the person can be changed', () => {
  const { host } = mount({ attributedParty: PERSON });

  findByClass(host, 'cr-attribute-chip')._fire('click');

  assert.equal(
    findByClass(host, 'cr-attribute-popover').hidden,
    false,
    'chip click opens the popover'
  );
  assert.equal(
    findByClass(host, 'cr-attribute-chip').getAttribute('aria-expanded'),
    'true'
  );
});

test('AttributeMenu: clicking the trigger opens the popover and reflects aria-expanded', () => {
  const { host } = mount();

  const trigger = findByClass(host, 'cr-attribute-trigger');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  trigger._fire('click');

  assert.equal(
    findByClass(host, 'cr-attribute-popover').hidden,
    false,
    'popover shown after click'
  );
  assert.equal(
    findByClass(host, 'cr-attribute-trigger').getAttribute('aria-expanded'),
    'true'
  );
});

test('AttributeMenu: clicking the trigger again closes the popover', () => {
  const { host } = mount();

  findByClass(host, 'cr-attribute-trigger')._fire('click');
  findByClass(host, 'cr-attribute-trigger')._fire('click');

  assert.equal(
    findByClass(host, 'cr-attribute-popover').hidden,
    true,
    'popover hidden after second click'
  );
});

test('AttributeMenu: shows a Responsible Party quick-pick when responsibleParty is set', () => {
  const { host } = mount({ responsibleParty: RESPONSIBLE });

  const quick = findByClass(host, 'cr-attribute-responsible');
  assert.ok(quick, 'responsible-party quick-pick rendered');
  assert.equal(quick.textContent, 'Responsible Party — rparty');
});

test('AttributeMenu: omits the Responsible Party quick-pick when none is set', () => {
  const { host } = mount({ responsibleParty: null });

  assert.equal(findByClass(host, 'cr-attribute-responsible'), null);
});

test('AttributeMenu: choosing the Responsible Party calls onChange and closes', () => {
  const { host, changes } = mount({ responsibleParty: RESPONSIBLE });
  findByClass(host, 'cr-attribute-trigger')._fire('click');

  findByClass(host, 'cr-attribute-responsible')._fire('click');

  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], RESPONSIBLE);
  assert.equal(
    findByClass(host, 'cr-attribute-popover').hidden,
    true,
    'popover closes after choosing'
  );
});

test('AttributeMenu: embeds a people picker wired to the client', () => {
  const client = /** @type {any} */ ({
    async searchPeople() {
      return [];
    },
  });
  const { host } = mount({ client });

  const picker = findByTag(host, 'cr-people-picker');
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
  findByClass(host, 'cr-attribute-trigger')._fire('click');

  findByTag(host, 'cr-people-picker')._fire('cr-person-selected', {
    detail: PERSON,
  });

  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], PERSON);
});

test('AttributeMenu: clicking clear calls onChange with a null party', () => {
  const { host, changes } = mount({ attributedParty: PERSON });

  findByClass(host, 'cr-attribute-clear')._fire('click');

  assert.equal(changes.length, 1);
  assert.equal(changes[0], null);
});

test('AttributeMenu: Escape closes the popover when open', () => {
  const { host } = mount();
  findByClass(host, 'cr-attribute-trigger')._fire('click');
  assert.equal(findByClass(host, 'cr-attribute-popover').hidden, false);

  /** @type {any} */ (globalThis).document._fire('keydown', keyEvent('Escape'));

  assert.equal(
    findByClass(host, 'cr-attribute-popover').hidden,
    true,
    'Escape closes the popover'
  );
});

test('AttributeMenu: Escape is a no-op when the popover is closed', () => {
  const { host } = mount();

  // Should not throw and should remain closed.
  /** @type {any} */ (globalThis).document._fire('keydown', keyEvent('Escape'));
  assert.equal(findByClass(host, 'cr-attribute-popover').hidden, true);
});

test('AttributeMenu: non-Escape keys are ignored', () => {
  const { host } = mount();
  findByClass(host, 'cr-attribute-trigger')._fire('click');

  /** @type {any} */ (globalThis).document._fire('keydown', keyEvent('Enter'));
  assert.equal(
    findByClass(host, 'cr-attribute-popover').hidden,
    false,
    'popover stays open for other keys'
  );
});

test('AttributeMenu: an outside pointerdown closes an open popover', () => {
  const { host } = mount();
  host.contains = () => false;
  findByClass(host, 'cr-attribute-trigger')._fire('click');

  /** @type {any} */ (globalThis).document._fire('mousedown', { target: {} });
  assert.equal(
    findByClass(host, 'cr-attribute-popover').hidden,
    true,
    'outside click closes'
  );
});

test('AttributeMenu: a pointerdown inside the menu leaves it open', () => {
  const { host } = mount();
  host.contains = () => true;
  findByClass(host, 'cr-attribute-trigger')._fire('click');

  /** @type {any} */ (globalThis).document._fire('mousedown', { target: {} });
  assert.equal(
    findByClass(host, 'cr-attribute-popover').hidden,
    false,
    'inside click keeps it open'
  );
});

test('AttributeMenu: a pointerdown while closed is ignored', () => {
  const { host } = mount();
  host.contains = () => false;

  // Closed: the handler returns before touching contains/close.
  /** @type {any} */ (globalThis).document._fire('mousedown', { target: {} });
  assert.equal(findByClass(host, 'cr-attribute-popover').hidden, true);
});

test('AttributeMenu: disconnect removes its document listeners', () => {
  const { host } = mount();
  host.contains = () => false;
  findByClass(host, 'cr-attribute-trigger')._fire('click');
  // Grab the open popover before disconnect tears the view down.
  const popover = findByClass(host, 'cr-attribute-popover');
  assert.equal(popover.hidden, false);

  host.disconnectedCallback();

  // After disconnect, document events must not reach the (detached) menu.
  /** @type {any} */ (globalThis).document._fire('keydown', keyEvent('Escape'));
  /** @type {any} */ (globalThis).document._fire('mousedown', { target: {} });
  // The detached popover's state must not have been flipped by those events.
  assert.equal(popover.hidden, false, 'listeners detached');
});
