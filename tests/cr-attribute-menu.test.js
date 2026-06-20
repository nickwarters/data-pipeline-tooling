// @ts-check
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ===== MINIMAL DOM STUBS =====

class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    /** @type {Record<string, string>} */
    this._attrs = {};
    this.textContent = '';
    this.className = '';
    this.hidden = false;
    /** @type {string} */
    this._tagName = '';
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    this._children = cs;
  }
  appendChild(/** @type {StubEl} */ c) {
    this._children.push(c);
    return c;
  }
  append(/** @type {StubEl[]} */ ...cs) {
    this._children.push(...cs);
  }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    this._attrs[k] = v;
  }
  getAttribute(/** @type {string} */ k) {
    return this._attrs[k] ?? null;
  }
  dispatchEvent(/** @type {any} */ e) {
    (this._listeners[e.type] ?? []).forEach((h) => h(e));
    return true;
  }
  /** @param {string} ev fire a listener as if the user triggered it */
  _fire(/** @type {string} */ ev, /** @type {any} */ payload) {
    (this._listeners[ev] ?? []).forEach((h) => h(payload));
  }
}

class StubCustomEvent {
  /** @param {string} type @param {{ detail?: any, bubbles?: boolean }} [init] */
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail ?? null;
    this.bubbles = init?.bubbles ?? false;
  }
}

/** @type {Record<string, Function[]>} */
const docListeners = {};

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const el = new StubEl();
    el._tagName = tag;
    return el;
  },
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (docListeners[t] ??= []).push(h);
  },
  removeEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    docListeners[t] = (docListeners[t] ?? []).filter((fn) => fn !== h);
  },
  _fire(/** @type {string} */ t, /** @type {any} */ ev) {
    (docListeners[t] ?? []).forEach((h) => h(ev));
  },
};
/** @type {any} */ (globalThis).customElements = { define() {} };
/** @type {any} */ (globalThis).CustomEvent = StubCustomEvent;

// ===== IMPORTS (after stubs) =====
const { CRAttributeMenu } =
  await import('../src/components/cr-attribute-menu.js');

// ===== HELPERS =====

/** @param {any} root @param {string} cls @returns {any} */
function findByClass(root, cls) {
  for (const c of root._children ?? []) {
    if (c.className === cls) return c;
    const nested = findByClass(c, cls);
    if (nested) return nested;
  }
  return null;
}

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

// Each menu registers document-level listeners in connectedCallback; clear them
// between tests so a prior test's (still-connected) menu can't fire on the
// shared stub document and pollute the assertions below.
beforeEach(() => {
  for (const key of Object.keys(docListeners)) delete docListeners[key];
});

// ===== TESTS =====

test('CRAttributeMenu: unset renders an Attribute trigger, no chip or clear, popover hidden', () => {
  const el = new CRAttributeMenu();
  el.connectedCallback();

  assert.ok(findByClass(el, 'cr-attribute-trigger'), 'trigger button rendered');
  assert.equal(
    findByClass(el, 'cr-attribute-chip'),
    null,
    'no chip when unset'
  );
  assert.equal(
    findByClass(el, 'cr-attribute-clear'),
    null,
    'no clear when unset'
  );
  assert.equal(
    findByClass(el, 'cr-attribute-popover').hidden,
    true,
    'popover starts hidden'
  );
});

test('CRAttributeMenu: when set, renders a chip with the displayName and a clear button', () => {
  const el = new CRAttributeMenu();
  el.attributedParty = PERSON;
  el.connectedCallback();

  const chip = findByClass(el, 'cr-attribute-chip');
  assert.ok(chip, 'chip rendered when attributed');
  assert.equal(chip.textContent, 'Jane Smith');
  assert.ok(
    findByClass(el, 'cr-attribute-clear'),
    'clear button rendered when attributed'
  );
  assert.equal(
    findByClass(el, 'cr-attribute-trigger'),
    null,
    'plain trigger replaced by chip'
  );
});

test('CRAttributeMenu: clicking the chip opens the popover so the person can be changed', () => {
  const el = new CRAttributeMenu();
  el.attributedParty = PERSON;
  el.connectedCallback();

  findByClass(el, 'cr-attribute-chip')._fire('click');

  assert.equal(
    findByClass(el, 'cr-attribute-popover').hidden,
    false,
    'chip click opens the popover'
  );
  assert.equal(
    findByClass(el, 'cr-attribute-chip').getAttribute('aria-expanded'),
    'true'
  );
});

test('CRAttributeMenu: clicking the trigger opens the popover and reflects aria-expanded', () => {
  const el = new CRAttributeMenu();
  el.connectedCallback();

  const trigger = findByClass(el, 'cr-attribute-trigger');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  trigger._fire('click');

  assert.equal(
    findByClass(el, 'cr-attribute-popover').hidden,
    false,
    'popover shown after click'
  );
  assert.equal(
    findByClass(el, 'cr-attribute-trigger').getAttribute('aria-expanded'),
    'true'
  );
});

test('CRAttributeMenu: clicking the trigger again closes the popover', () => {
  const el = new CRAttributeMenu();
  el.connectedCallback();

  findByClass(el, 'cr-attribute-trigger')._fire('click');
  findByClass(el, 'cr-attribute-trigger')._fire('click');

  assert.equal(
    findByClass(el, 'cr-attribute-popover').hidden,
    true,
    'popover hidden after second click'
  );
});

test('CRAttributeMenu: shows a Responsible Party quick-pick when responsibleParty is set', () => {
  const el = new CRAttributeMenu();
  el.responsibleParty = RESPONSIBLE;
  el.connectedCallback();

  const quick = findByClass(el, 'cr-attribute-responsible');
  assert.ok(quick, 'responsible-party quick-pick rendered');
  assert.equal(quick.textContent, 'Responsible Party — rparty');
});

test('CRAttributeMenu: omits the Responsible Party quick-pick when none is set', () => {
  const el = new CRAttributeMenu();
  el.responsibleParty = null;
  el.connectedCallback();

  assert.equal(findByClass(el, 'cr-attribute-responsible'), null);
});

test('CRAttributeMenu: choosing the Responsible Party emits cr-attribute-change and closes', () => {
  const el = new CRAttributeMenu();
  el.responsibleParty = RESPONSIBLE;
  el.connectedCallback();
  findByClass(el, 'cr-attribute-trigger')._fire('click');

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cr-attribute-change', (/** @type {any} */ e) =>
    events.push(e)
  );

  findByClass(el, 'cr-attribute-responsible')._fire('click');

  assert.equal(events.length, 1);
  assert.equal(
    events[0].bubbles,
    false,
    'event does not bubble; parent re-dispatches with questionId'
  );
  assert.deepEqual(events[0].detail, { attributedParty: RESPONSIBLE });
  assert.equal(
    findByClass(el, 'cr-attribute-popover').hidden,
    true,
    'popover closes after choosing'
  );
});

test('CRAttributeMenu: embeds a people picker wired to the client', () => {
  const client = /** @type {any} */ ({
    async searchPeople() {
      return [];
    },
  });
  const el = new CRAttributeMenu();
  el.client = client;
  el.connectedCallback();

  const picker = findByTag(el, 'cr-people-picker');
  assert.ok(picker, 'people picker rendered');
  assert.equal(picker.client, client, 'picker receives the client');
});

test('CRAttributeMenu: selecting someone via search emits cr-attribute-change with that person', () => {
  const el = new CRAttributeMenu();
  el.client = /** @type {any} */ ({
    async searchPeople() {
      return [];
    },
  });
  el.connectedCallback();
  findByClass(el, 'cr-attribute-trigger')._fire('click');

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cr-attribute-change', (/** @type {any} */ e) =>
    events.push(e)
  );

  findByTag(el, 'cr-people-picker')._fire('cr-person-selected', {
    detail: PERSON,
  });

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail, { attributedParty: PERSON });
});

test('CRAttributeMenu: clicking clear emits cr-attribute-change with a null party', () => {
  const el = new CRAttributeMenu();
  el.attributedParty = PERSON;
  el.connectedCallback();

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cr-attribute-change', (/** @type {any} */ e) =>
    events.push(e)
  );

  findByClass(el, 'cr-attribute-clear')._fire('click');

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail, { attributedParty: null });
});

test('CRAttributeMenu: Escape closes the popover when open', () => {
  const el = new CRAttributeMenu();
  el.connectedCallback();
  findByClass(el, 'cr-attribute-trigger')._fire('click');
  assert.equal(findByClass(el, 'cr-attribute-popover').hidden, false);

  /** @type {any} */ (globalThis).document._fire('keydown', keyEvent('Escape'));

  assert.equal(
    findByClass(el, 'cr-attribute-popover').hidden,
    true,
    'Escape closes the popover'
  );
});

test('CRAttributeMenu: Escape is a no-op when the popover is closed', () => {
  const el = new CRAttributeMenu();
  el.connectedCallback();

  // Should not throw and should remain closed.
  /** @type {any} */ (globalThis).document._fire('keydown', keyEvent('Escape'));
  assert.equal(findByClass(el, 'cr-attribute-popover').hidden, true);
});

test('CRAttributeMenu: non-Escape keys are ignored', () => {
  const el = new CRAttributeMenu();
  el.connectedCallback();
  findByClass(el, 'cr-attribute-trigger')._fire('click');

  /** @type {any} */ (globalThis).document._fire('keydown', keyEvent('Enter'));
  assert.equal(
    findByClass(el, 'cr-attribute-popover').hidden,
    false,
    'popover stays open for other keys'
  );
});

test('CRAttributeMenu: an outside pointerdown closes an open popover', () => {
  const el = new CRAttributeMenu();
  el.connectedCallback();
  el.contains = () => false;
  findByClass(el, 'cr-attribute-trigger')._fire('click');

  /** @type {any} */ (globalThis).document._fire('mousedown', { target: {} });
  assert.equal(
    findByClass(el, 'cr-attribute-popover').hidden,
    true,
    'outside click closes'
  );
});

test('CRAttributeMenu: a pointerdown inside the menu leaves it open', () => {
  const el = new CRAttributeMenu();
  el.connectedCallback();
  el.contains = () => true;
  findByClass(el, 'cr-attribute-trigger')._fire('click');

  /** @type {any} */ (globalThis).document._fire('mousedown', { target: {} });
  assert.equal(
    findByClass(el, 'cr-attribute-popover').hidden,
    false,
    'inside click keeps it open'
  );
});

test('CRAttributeMenu: a pointerdown while closed is ignored', () => {
  const el = new CRAttributeMenu();
  el.connectedCallback();
  el.contains = () => false;

  // Closed: the handler returns before touching contains/close.
  /** @type {any} */ (globalThis).document._fire('mousedown', { target: {} });
  assert.equal(findByClass(el, 'cr-attribute-popover').hidden, true);
});

test('CRAttributeMenu: disconnectedCallback removes its document listeners', () => {
  const el = new CRAttributeMenu();
  el.connectedCallback();
  findByClass(el, 'cr-attribute-trigger')._fire('click');
  el.disconnectedCallback();

  // After disconnect, document events must not reach the (detached) element.
  /** @type {any} */ (globalThis).document._fire('keydown', keyEvent('Escape'));
  /** @type {any} */ (globalThis).document._fire('mousedown', { target: {} });
  // popover ref is stale but its hidden state should not have been flipped closed
  assert.equal(
    findByClass(el, 'cr-attribute-popover').hidden,
    false,
    'listeners detached'
  );
});
