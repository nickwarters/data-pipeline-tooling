// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== MINIMAL DOM STUBS (installed before importing the component) =====
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
    this.tabIndex = 0;
    this._focused = false;
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
  dispatchEvent(/** @type {any} */ e) {
    (this._listeners[e.type] ?? []).forEach((h) => h(e));
    return true;
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    this._attrs[k] = v;
  }
  getAttribute(/** @type {string} */ k) {
    return this._attrs[k] ?? null;
  }
  removeAttribute(/** @type {string} */ k) {
    delete this._attrs[k];
  }
  focus() {
    this._focused = true;
  }
  /** Fire a registered listener as if the user triggered it. */
  _fire(/** @type {string} */ ev, /** @type {any} */ payload) {
    (this._listeners[ev] ?? []).forEach((h) => h(payload));
  }
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).document = {
  /** @param {string} _tag @returns {StubEl} */
  createElement(_tag) {
    return new StubEl();
  },
  addEventListener() {},
  removeEventListener() {},
};
/** @type {Array<[string, any]>} */
const definedElements = [];
/** @type {any} */ (globalThis).customElements = {
  define(/** @type {string} */ name, /** @type {any} */ ctor) {
    definedElements.push([name, ctor]);
  },
};

class StubCustomEvent {
  /** @param {string} type @param {{ detail?: any, bubbles?: boolean }} [init] */
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail ?? null;
    this.bubbles = init?.bubbles ?? false;
  }
}
/** @type {any} */ (globalThis).CustomEvent = StubCustomEvent;

// ===== IMPORTS (after stubs) =====
const { CRTabs } = await import('../src/components/cr-tabs.js');

/**
 * Build a configured cr-tabs element and connect it.
 * @param {{ tabs: Array<{id: string, label: string, hidden?: boolean}>, selected?: string, panels?: Record<string, any> }} cfg
 */
function makeTabs(cfg) {
  const el = new CRTabs();
  el.tabs = cfg.tabs;
  if (cfg.selected !== undefined) el.selected = cfg.selected;
  if (cfg.panels) el.panels = cfg.panels;
  el.connectedCallback();
  return el;
}

/** @param {any} el @returns {any} the tablist node */
function tablist(el) {
  return el._children.find(
    (/** @type {any} */ c) => c._attrs['role'] === 'tablist'
  );
}
/** @param {any} el @returns {any[]} the rendered tab buttons */
function tabButtons(el) {
  return tablist(el)._children;
}
/** @param {any} el @returns {any[]} the rendered tabpanels */
function panels(el) {
  return el._children.filter(
    (/** @type {any} */ c) => c._attrs['role'] === 'tabpanel'
  );
}

const THREE = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Bravo' },
  { id: 'c', label: 'Charlie' },
];

test('CRTabs: renders one tab button per non-hidden tab', () => {
  const el = makeTabs({ tabs: THREE, selected: 'a' });
  const btns = tabButtons(el);
  assert.equal(btns.length, 3);
  assert.deepEqual(
    btns.map((/** @type {any} */ b) => b.textContent),
    ['Alpha', 'Bravo', 'Charlie']
  );
});

test('CRTabs: hidden tabs render neither a button nor a panel', () => {
  const el = makeTabs({
    tabs: [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Bravo', hidden: true },
      { id: 'c', label: 'Charlie' },
    ],
    selected: 'a',
  });
  assert.deepEqual(
    tabButtons(el).map((/** @type {any} */ b) => b.textContent),
    ['Alpha', 'Charlie']
  );
  assert.equal(panels(el).length, 2);
});

test('CRTabs: container has role tablist', () => {
  const el = makeTabs({ tabs: THREE, selected: 'a' });
  assert.ok(tablist(el), 'a role=tablist element should exist');
});

test('CRTabs: each tab button has role tab and aria-controls pointing at its panel', () => {
  const el = makeTabs({ tabs: THREE, selected: 'a' });
  for (const btn of tabButtons(el)) {
    assert.equal(btn._attrs['role'], 'tab');
    const controls = btn._attrs['aria-controls'];
    assert.ok(controls, 'tab must declare aria-controls');
    const panel = panels(el).find(
      (/** @type {any} */ p) => p._attrs['id'] === controls
    );
    assert.ok(panel, 'aria-controls must reference a real panel id');
    assert.equal(
      panel._attrs['aria-labelledby'],
      btn._attrs['id'],
      'panel must point back at its tab via aria-labelledby'
    );
  }
});

test('CRTabs: selected tab has aria-selected true; others false', () => {
  const el = makeTabs({ tabs: THREE, selected: 'b' });
  const [a, b, c] = tabButtons(el);
  assert.equal(a._attrs['aria-selected'], 'false');
  assert.equal(b._attrs['aria-selected'], 'true');
  assert.equal(c._attrs['aria-selected'], 'false');
});

test('CRTabs: selected tab is focusable (tabindex 0); others removed from tab order (-1)', () => {
  const el = makeTabs({ tabs: THREE, selected: 'b' });
  const [a, b, c] = tabButtons(el);
  assert.equal(a._attrs['tabindex'], '-1');
  assert.equal(b._attrs['tabindex'], '0');
  assert.equal(c._attrs['tabindex'], '-1');
});

test('CRTabs: only the selected panel is visible; others hidden', () => {
  const el = makeTabs({ tabs: THREE, selected: 'b' });
  const ps = panels(el);
  const visible = ps.filter((/** @type {any} */ p) => !p.hidden);
  assert.equal(visible.length, 1);
  assert.equal(
    visible[0]._attrs['aria-labelledby'],
    tabButtons(el)[1]._attrs['id']
  );
});

test('CRTabs: panel content is taken from the panels map keyed by tab id', () => {
  const alphaContent = new StubEl();
  alphaContent.textContent = 'ALPHA-BODY';
  const el = makeTabs({
    tabs: THREE,
    selected: 'a',
    panels: { a: alphaContent },
  });
  const ps = panels(el);
  const alphaPanel = ps.find(
    (/** @type {any} */ p) =>
      p._attrs['aria-labelledby'] === tabButtons(el)[0]._attrs['id']
  );
  assert.ok(
    alphaPanel._children.includes(alphaContent),
    'panel should contain the supplied content node'
  );
});

test('CRTabs: clicking a tab selects it', () => {
  const el = makeTabs({ tabs: THREE, selected: 'a' });
  tabButtons(el)[2]._fire('click', {});
  assert.equal(el.selected, 'c');
  // re-render reflects the new selection
  assert.equal(tabButtons(el)[2]._attrs['aria-selected'], 'true');
});

test('CRTabs: clicking a tab emits cr-tab-change with the new id', () => {
  const el = makeTabs({ tabs: THREE, selected: 'a' });
  /** @type {any[]} */
  const events = [];
  el.addEventListener('cr-tab-change', (/** @type {any} */ e) =>
    events.push(e)
  );
  tabButtons(el)[1]._fire('click', {});
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.id, 'b');
  assert.equal(events[0].bubbles, true);
});

test('CRTabs: clicking the already-selected tab does not emit', () => {
  const el = makeTabs({ tabs: THREE, selected: 'a' });
  /** @type {any[]} */
  const events = [];
  el.addEventListener('cr-tab-change', (/** @type {any} */ e) =>
    events.push(e)
  );
  tabButtons(el)[0]._fire('click', {});
  assert.equal(events.length, 0);
});

test('CRTabs: ArrowRight moves selection to the next visible tab', () => {
  const el = makeTabs({ tabs: THREE, selected: 'a' });
  /** @type {any[]} */
  const events = [];
  el.addEventListener('cr-tab-change', (/** @type {any} */ e) =>
    events.push(e)
  );
  let prevented = false;
  tabButtons(el)[0]._fire('keydown', {
    key: 'ArrowRight',
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(el.selected, 'b');
  assert.equal(events[0].detail.id, 'b');
  assert.equal(prevented, true, 'arrow key should be consumed');
});

test('CRTabs: ArrowLeft moves selection to the previous visible tab', () => {
  const el = makeTabs({ tabs: THREE, selected: 'b' });
  tabButtons(el)[1]._fire('keydown', { key: 'ArrowLeft', preventDefault() {} });
  assert.equal(el.selected, 'a');
});

test('CRTabs: ArrowRight wraps from last to first', () => {
  const el = makeTabs({ tabs: THREE, selected: 'c' });
  tabButtons(el)[2]._fire('keydown', {
    key: 'ArrowRight',
    preventDefault() {},
  });
  assert.equal(el.selected, 'a');
});

test('CRTabs: ArrowLeft wraps from first to last', () => {
  const el = makeTabs({ tabs: THREE, selected: 'a' });
  tabButtons(el)[0]._fire('keydown', { key: 'ArrowLeft', preventDefault() {} });
  assert.equal(el.selected, 'c');
});

test('CRTabs: arrow navigation skips hidden tabs', () => {
  const el = makeTabs({
    tabs: [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Bravo', hidden: true },
      { id: 'c', label: 'Charlie' },
    ],
    selected: 'a',
  });
  tabButtons(el)[0]._fire('keydown', {
    key: 'ArrowRight',
    preventDefault() {},
  });
  assert.equal(
    el.selected,
    'c',
    'should jump straight to the next visible tab'
  );
});

test('CRTabs: newly-selected tab receives focus after arrow navigation', () => {
  const el = makeTabs({ tabs: THREE, selected: 'a' });
  tabButtons(el)[0]._fire('keydown', {
    key: 'ArrowRight',
    preventDefault() {},
  });
  // after re-render, the now-selected tab button should be focused
  assert.equal(tabButtons(el)[1]._focused, true);
});

test('CRTabs: non-arrow keys are ignored', () => {
  const el = makeTabs({ tabs: THREE, selected: 'a' });
  let prevented = false;
  tabButtons(el)[0]._fire('keydown', {
    key: 'Enter',
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(el.selected, 'a');
  assert.equal(prevented, false);
});

test('CRTabs: with no selection, defaults to the first visible tab', () => {
  const el = makeTabs({ tabs: THREE });
  assert.equal(tabButtons(el)[0]._attrs['aria-selected'], 'true');
  assert.equal(
    panels(el).filter((/** @type {any} */ p) => !p.hidden).length,
    1
  );
});

test('CRTabs: a selected id that is hidden falls back to the first visible tab', () => {
  const el = makeTabs({
    tabs: [
      { id: 'a', label: 'Alpha', hidden: true },
      { id: 'b', label: 'Bravo' },
    ],
    selected: 'a',
  });
  assert.equal(tabButtons(el)[0]._attrs['aria-selected'], 'true');
  assert.equal(tabButtons(el)[0].textContent, 'Bravo');
});

test('CRTabs: with no tabs at all, renders an empty tablist and no panels', () => {
  const el = makeTabs({ tabs: [] });
  assert.equal(tabButtons(el).length, 0);
  assert.equal(panels(el).length, 0);
});

test('CRTabs: arrow navigation with no visible tabs is a no-op', () => {
  const el = makeTabs({ tabs: [] });
  // Drive the keyboard handler directly since there are no buttons to fire on.
  assert.doesNotThrow(() =>
    el._onKeydown(
      /** @type {any} */ ({ key: 'ArrowRight', preventDefault() {} })
    )
  );
  assert.equal(el.selected, '');
});

test('CRTabs: setting tabs after connect re-renders', () => {
  const el = makeTabs({ tabs: THREE, selected: 'a' });
  el.tabs = [{ id: 'x', label: 'Xray' }];
  el.selected = 'x';
  const tree = el.render();
  el.replaceChildren(...(Array.isArray(tree) ? tree : [tree]));
  assert.deepEqual(
    tabButtons(el).map((/** @type {any} */ b) => b.textContent),
    ['Xray']
  );
});

test('CRTabs: registers itself as the cr-tabs custom element', () => {
  const entry = definedElements.find(([name]) => name === 'cr-tabs');
  assert.ok(entry, 'should define cr-tabs');
  assert.equal(entry[1], CRTabs, 'should register the CRTabs constructor');
});
