// @ts-check
import { test } from 'node:test';
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
    this.disabled = false;
    this.tagName = '';
    /** @type {string | null} */
    this._scrollTarget = null;
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
  querySelector(/** @type {string} */ _sel) {
    return null;
  }
  scrollIntoView() {}
}

class StubCustomEvent {
  /** @param {string} type @param {{ detail?: any, bubbles?: boolean }} [init] */
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail ?? null;
    this.bubbles = init?.bubbles ?? false;
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
/** @type {any} */ (globalThis).customElements = { define() {} };
/** @type {any} */ (globalThis).CustomEvent = StubCustomEvent;

// ===== IMPORTS =====
const { CRSectionProgress, SectionProgress } =
  await import('../src/components/cr-section-progress.js');

/** @typedef {import('../src/evaluators/section-progress.js').SectionProgress} SectionProgress */

// ===== HELPERS =====

/** @param {SectionProgress[]} sections */
function render(sections) {
  const el = new CRSectionProgress();
  el.update(sections, []);
  return el;
}

// ===== TESTS =====

test('SectionProgress: plain function renders rows and jump button', () => {
  const nodes = SectionProgress({
    sections: [{ section: 'Opening', answered: 1, total: 2 }],
    unansweredQuestions: [],
    onSectionJump: () => {},
    onJumpUnanswered: () => {},
  });

  assert.equal(
    /** @type {any} */ (nodes[0]).className,
    'cr-section-progress-row'
  );
  assert.equal(
    /** @type {any} */ (nodes[1]).className,
    'cr-jump-unanswered-btn'
  );
});

test('CRSectionProgress: update renders one row per section', () => {
  const el = render([
    { section: 'Opening', answered: 1, total: 1 },
    { section: 'Discovery', answered: 0, total: 2 },
  ]);
  // children = section rows + jump button
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  const sectionRows = children.filter((c) =>
    c.className.includes('cr-section-progress-row')
  );
  assert.equal(sectionRows.length, 2);
});

test('CRSectionProgress: each row shows section name', () => {
  const el = render([{ section: 'Opening', answered: 0, total: 1 }]);
  const row = /** @type {any} */ (el)._children[0];
  const label = row._children[0];
  assert.equal(label.textContent, 'Opening');
});

test('CRSectionProgress: each row shows X/Y count', () => {
  const el = render([{ section: 'Opening', answered: 1, total: 3 }]);
  const row = /** @type {any} */ (el)._children[0];
  const count = row._children[1];
  assert.equal(count.textContent, '1/3');
});

test('CRSectionProgress: completed sections have a distinct class', () => {
  const el = render([
    { section: 'Done', answered: 2, total: 2 },
    { section: 'Pending', answered: 1, total: 3 },
  ]);
  const rows = /** @type {any} */ (el)._children;
  assert.ok(rows[0].className.includes('complete'));
  assert.ok(!rows[1].className.includes('complete'));
});

test('CRSectionProgress: clicking a row dispatches cr-section-jump with section name', () => {
  const el = new CRSectionProgress();
  /** @type {any[]} */
  const dispatched = [];
  /** @type {any} */ (el)._listeners = /** @type {any} */ (el)._listeners ?? {};
  /** @type {any} */ (el).dispatchEvent = (/** @type {any} */ ev) =>
    dispatched.push(ev);

  el.update([{ section: 'Opening', answered: 0, total: 1 }], []);
  const row = /** @type {any} */ (el)._children[0];
  row._listeners['click']?.[0]({ currentTarget: row });

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'cr-section-jump');
  assert.equal(dispatched[0].detail?.section, 'Opening');
});

test('CRSectionProgress: "Jump to next unanswered" button is rendered', () => {
  const el = new CRSectionProgress();
  el.update([{ section: 'Opening', answered: 0, total: 1 }], []);
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  // The jump button should be among the children (possibly first or last).
  const hasJumpBtn = children.some(
    (c) => c.textContent && c.textContent.includes('next unanswered')
  );
  assert.ok(hasJumpBtn, 'Jump to next unanswered button should be present');
});

test('CRSectionProgress: "Jump to next unanswered" dispatches cr-jump-unanswered', () => {
  const el = new CRSectionProgress();
  /** @type {any[]} */
  const dispatched = [];
  /** @type {any} */ (el).dispatchEvent = (/** @type {any} */ ev) =>
    dispatched.push(ev);

  el.update([{ section: 'Opening', answered: 0, total: 1 }], []);
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  const jumpBtn = children.find(
    (c) => c.textContent && c.textContent.includes('next unanswered')
  );
  jumpBtn._listeners['click']?.[0]({});

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'cr-jump-unanswered');
});

test('CRSectionProgress: update with empty sections renders no section rows', () => {
  const el = render([]);
  // Only the jump button should remain
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  const sectionRows = children.filter(
    (c) => c.textContent && !c.textContent.includes('next unanswered')
  );
  assert.equal(sectionRows.length, 0);
});
