// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

// ===== IMPORTS =====
const { CORASectionProgress, SectionProgress } =
  await import('../src/components/cora-section-progress.js');

/** @typedef {import('../src/evaluators/section-progress.js').SectionProgress} SectionProgress */

// ===== HELPERS =====

/** @param {SectionProgress[]} sections */
function render(sections) {
  const el = new CORASectionProgress();
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
    'cora-section-progress-row'
  );
  assert.equal(
    /** @type {any} */ (nodes[1]).className,
    'cora-jump-unanswered-btn'
  );
});

test('CORASectionProgress: update renders one row per section', () => {
  const el = render([
    { section: 'Opening', answered: 1, total: 1 },
    { section: 'Discovery', answered: 0, total: 2 },
  ]);
  // children = section rows + jump button
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  const sectionRows = children.filter((c) =>
    c.className.includes('cora-section-progress-row')
  );
  assert.equal(sectionRows.length, 2);
});

test('CORASectionProgress: each row shows section name', () => {
  const el = render([{ section: 'Opening', answered: 0, total: 1 }]);
  const row = /** @type {any} */ (el)._children[0];
  const label = row._children[0];
  assert.equal(label.textContent, 'Opening');
});

test('CORASectionProgress: each row shows X/Y count', () => {
  const el = render([{ section: 'Opening', answered: 1, total: 3 }]);
  const row = /** @type {any} */ (el)._children[0];
  const count = row._children[1];
  assert.equal(count.textContent, '1/3');
});

test('CORASectionProgress: completed sections have a distinct class', () => {
  const el = render([
    { section: 'Done', answered: 2, total: 2 },
    { section: 'Pending', answered: 1, total: 3 },
  ]);
  const rows = /** @type {any} */ (el)._children;
  assert.ok(rows[0].className.includes('complete'));
  assert.ok(!rows[1].className.includes('complete'));
});

test('CORASectionProgress: clicking a row dispatches cora-section-jump with section name', () => {
  const el = new CORASectionProgress();
  /** @type {any[]} */
  const dispatched = [];
  /** @type {any} */ (el)._listeners = /** @type {any} */ (el)._listeners ?? {};
  /** @type {any} */ (el).dispatchEvent = (/** @type {any} */ ev) =>
    dispatched.push(ev);

  el.update([{ section: 'Opening', answered: 0, total: 1 }], []);
  const row = /** @type {any} */ (el)._children[0];
  row._listeners['click']?.[0]({ currentTarget: row });

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'cora-section-jump');
  assert.equal(dispatched[0].detail?.section, 'Opening');
});

test('CORASectionProgress: "Jump to next unanswered" button is rendered', () => {
  const el = new CORASectionProgress();
  el.update([{ section: 'Opening', answered: 0, total: 1 }], []);
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  // The jump button should be among the children (possibly first or last).
  const hasJumpBtn = children.some(
    (c) => c.textContent && c.textContent.includes('next unanswered')
  );
  assert.ok(hasJumpBtn, 'Jump to next unanswered button should be present');
});

test('CORASectionProgress: "Jump to next unanswered" dispatches cora-jump-unanswered', () => {
  const el = new CORASectionProgress();
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
  assert.equal(dispatched[0].type, 'cora-jump-unanswered');
});

test('CORASectionProgress: update with empty sections renders no section rows', () => {
  const el = render([]);
  // Only the jump button should remain
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  const sectionRows = children.filter(
    (c) => c.textContent && !c.textContent.includes('next unanswered')
  );
  assert.equal(sectionRows.length, 0);
});
