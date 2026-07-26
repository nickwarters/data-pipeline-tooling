// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, flush } from './_dom-stub.js';
import { freshExampleReviewBank } from './_example-review-fixture.js';
import {
  fireEvent,
  getByRole,
  getByTag,
  getByText,
} from './helpers/semantic-dom.js';
installDom();

const { CompileDrawer } =
  await import('../src/pages/question-bank/compile-drawer.js');
const { compileBank, highlight } =
  await import('../src/pages/question-bank/question-bank-compile.js');

/**
 * Render the pure compile drawer with props + spies (no store).
 * @param {{ open?: boolean, bank?: any, diff?: any, highlight?: any, hashCode?: any, simulatePanel?: any }} [over]
 */
function mount(over = {}) {
  const calls = { closed: 0, copied: 0, published: 0 };
  const e = /** @type {any} */ (document.createElement('div'));
  e.replaceChildren(
    ...CompileDrawer({
      open: over.open ?? false,
      bank: over.bank ?? freshExampleReviewBank(),
      diff: over.diff ?? { added: 0, changed: 0, deprecated: 0 },
      compile: compileBank,
      highlight: 'highlight' in over ? over.highlight : highlight,
      hashCode: 'hashCode' in over ? over.hashCode : async () => 'deadbeef',
      simulatePanel: over.simulatePanel ?? null,
      onClose: () => {
        calls.closed += 1;
      },
      onCopied: () => {
        calls.copied += 1;
      },
      onPublish: () => {
        calls.published += 1;
      },
    })
  );
  e.disconnectedCallback = () => {};
  return { e, calls };
}

test('CORACompileDrawer: renders backdrop + drawer (closed by default)', () => {
  const { e } = mount();
  assert.equal(e.childElementCount, 2);
  assert.ok(!e.querySelector('.drawer-backdrop').className.includes('open'));
  assert.equal(getByTag(e, 'aside').className, 'drawer');
  e.disconnectedCallback();
});

test('CompileDrawer: closed state does not compile, hash, highlight, or simulate', () => {
  const calls = { compile: 0, hash: 0, highlight: 0, simulate: 0 };
  const root = document.createElement('div');
  root.replaceChildren(
    ...CompileDrawer({
      open: false,
      bank: freshExampleReviewBank(),
      diff: { added: 0, changed: 0, deprecated: 0 },
      compile: () => {
        calls.compile += 1;
        return '{}';
      },
      hashCode: async () => {
        calls.hash += 1;
        return 'hash';
      },
      highlight: (code) => {
        calls.highlight += 1;
        return code;
      },
      simulatePanel: () => {
        calls.simulate += 1;
        return document.createElement('div');
      },
      onClose() {},
      onCopied() {},
      onPublish() {},
    })
  );
  assert.deepEqual(calls, { compile: 0, hash: 0, highlight: 0, simulate: 0 });
  assert.equal(root.childElementCount, 2);
});

test('CORACompileDrawer: open signal adds .open to backdrop and drawer', () => {
  const { e } = mount({ open: true });
  assert.ok(e.querySelector('.drawer-backdrop').className.includes('open'));
  assert.ok(getByTag(e, 'aside').className.includes('open'));
  e.disconnectedCallback();
});

test('CompileDrawer: open state is supplied by the route render', () => {
  const closed = mount({ open: false }).e;
  const open = mount({ open: true }).e;
  assert.ok(
    !closed.querySelector('.drawer-backdrop').className.includes('open')
  );
  assert.ok(open.querySelector('.drawer-backdrop').className.includes('open'));
});

test('CORACompileDrawer: backdrop click and × button call onClose', () => {
  const { e, calls } = mount({ open: true });
  fireEvent(e.querySelector('.drawer-backdrop'), 'click');
  assert.equal(calls.closed, 1);
  fireEvent(getByRole(e, 'button', { name: '×' }), 'click');
  assert.equal(calls.closed, 2);
  e.disconnectedCallback();
});

test('CORACompileDrawer: Copy writes code to clipboard + reports onCopied', async () => {
  /** @type {any} */
  let written = null;
  try {
    /** @type {any} */ (globalThis).navigator = {
      clipboard: {
        writeText: async (/** @type {string} */ s) => {
          written = s;
        },
      },
    };
  } catch {
    /* read-only navigator on some runtimes */
  }
  const bank = freshExampleReviewBank();
  const { e, calls } = mount({ open: true, bank });
  fireEvent(getByRole(e, 'button', { name: 'Copy' }), 'click');
  await flush();
  assert.equal(calls.copied, 1);
  if (written !== null) assert.equal(written, compileBank(bank));
  e.disconnectedCallback();
});

test('CORACompileDrawer: Send for Review calls onPublish', () => {
  const { e, calls } = mount({ open: true });
  fireEvent(getByRole(e, 'button', { name: 'Send for Review' }), 'click');
  assert.equal(calls.published, 1);
  e.disconnectedCallback();
});

test('CORACompileDrawer: diff cards render the counts from the diff signal', () => {
  const { e } = mount({
    open: true,
    diff: { added: 1, changed: 2, deprecated: 3 },
  });
  assert.equal(e.querySelectorAll('.diff-card').length, 3);
  assert.equal(getByText(e, '1').textContent, '1');
  assert.equal(getByText(e, '2').textContent, '2');
  assert.equal(getByText(e, '3').textContent, '3');
  e.disconnectedCallback();
});

test('CORACompileDrawer: code preview uses explicit highlighted HTML that escapes question text', () => {
  const bank = {
    label: 'Example',
    slug: 'example-review',
    questions: [
      {
        id: 'q-danger',
        text: '<img src=x onerror=alert(1)>',
        responseType: 'yes-no-na',
        deprecated: false,
      },
    ],
  };
  const { e } = mount({ open: true, bank });
  const codeBlock = e.querySelector('.code-block');

  assert.ok(codeBlock.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!codeBlock.innerHTML.includes('<img src=x'));
  assert.equal(codeBlock.childElementCount, 0);
  e.disconnectedCallback();
});

test('CORACompileDrawer: without a highlighter the code renders as plain text', () => {
  const { e } = mount({ open: true, highlight: null });
  const codeBlock = e.querySelector('.code-block');
  assert.equal(codeBlock.innerHTML, '');
  assert.ok(codeBlock.textContent.includes('"slug"'));
  e.disconnectedCallback();
});

test('CORACompileDrawer: hash meta reflects hashCode; missing hashCode says unavailable', async () => {
  const { e } = mount({ open: true });
  await flush();
  assert.ok(getByTag(e, 'small').textContent.startsWith('sha256:deadbeef'));
  e.disconnectedCallback();

  const { e: e2 } = mount({ open: true, hashCode: null });
  await flush();
  assert.equal(getByTag(e2, 'small').textContent, 'hash: unavailable');
  e2.disconnectedCallback();
});

test('CORACompileDrawer: renders the simulate panel the page supplies', () => {
  /** @type {any[]} */
  const askedBanks = [];
  const bank = freshExampleReviewBank();
  const { e } = mount({
    open: true,
    bank,
    simulatePanel: (/** @type {any} */ b) => {
      askedBanks.push(b);
      const el = /** @type {any} */ (
        globalThis.document.createElement('section')
      );
      el.className = 'sim-panel';
      return el;
    },
  });
  assert.equal(e.querySelector('.sim-panel').className, 'sim-panel');
  assert.deepEqual(askedBanks, [bank]);
  e.disconnectedCallback();
});

test('CORACompileDrawer: no simulate panel when the page passes none', () => {
  const { e } = mount({ open: true });
  assert.equal(e.querySelector('.sim-panel'), null);
  e.disconnectedCallback();
});
