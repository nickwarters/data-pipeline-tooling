// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, flush } from './_dom-stub.js';
import { freshExampleReviewBank } from './_example-review-fixture.js';
installDom();

const { CORACompileDrawer } =
  await import('../src/components/collections/cora-compile-drawer.js');
const { signal } = await import('../src/lib/signal.js');
const { compileBank, highlight } =
  await import('../src/question-bank/question-bank-compile.js');

/**
 * Mount a CORACompileDrawer with props + spies (no store).
 * @param {{ open?: boolean, bank?: any, diff?: any, highlight?: any, hashCode?: any, simulatePanel?: any }} [over]
 */
function mount(over = {}) {
  const e = /** @type {any} */ (new CORACompileDrawer());
  e.open = signal(over.open ?? false);
  e.bank = signal(over.bank ?? freshExampleReviewBank());
  e.diff = signal(over.diff ?? { added: 0, changed: 0, deprecated: 0 });
  e.compile = compileBank;
  e.highlight = 'highlight' in over ? over.highlight : highlight;
  e.hashCode = 'hashCode' in over ? over.hashCode : async () => 'deadbeef';
  e.simulatePanel = over.simulatePanel ?? null;
  const calls = { closed: 0, copied: 0, submitted: 0 };
  e.onClose = () => {
    calls.closed += 1;
  };
  e.onCopied = () => {
    calls.copied += 1;
  };
  e.onSubmit = () => {
    calls.submitted += 1;
  };
  e.connectedCallback();
  return { e, calls };
}

test('CORACompileDrawer: renders backdrop + drawer (closed by default)', () => {
  const { e } = mount();
  const kids = e._children;
  assert.equal(kids.length, 2);
  assert.ok(!kids[0].className.includes('open'));
  e.disconnectedCallback();
});

test('CORACompileDrawer: open signal adds .open to backdrop and drawer', () => {
  const { e } = mount({ open: true });
  const kids = e._children;
  assert.ok(kids[0].className.includes('open'));
  assert.ok(kids[1].className.includes('open'));
  e.disconnectedCallback();
});

test('CORACompileDrawer: re-renders when the open signal flips', () => {
  const { e } = mount({ open: false });
  e.open.set(true);
  assert.ok(e._children[0].className.includes('open'));
  e.disconnectedCallback();
});

test('CORACompileDrawer: backdrop click and × button call onClose', () => {
  const { e, calls } = mount({ open: true });
  const backdrop = e._children[0];
  backdrop._listeners.click[0]();
  assert.equal(calls.closed, 1);
  const drawer = e._children[1];
  const head = drawer._children[0];
  const closeBtn = head._children[1];
  closeBtn._listeners.click[0]();
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
  const drawer = e._children[1];
  const foot = drawer._children[2];
  const copyBtn = foot._children[1]._children[0];
  await copyBtn._listeners.click[0]();
  assert.equal(calls.copied, 1);
  if (written !== null) assert.equal(written, compileBank(bank));
  e.disconnectedCallback();
});

test('CORACompileDrawer: Send for Review calls onSubmit', () => {
  const { e, calls } = mount({ open: true });
  const drawer = e._children[1];
  const foot = drawer._children[2];
  const sendBtn = foot._children[1]._children[1];
  sendBtn._listeners.click[0]();
  assert.equal(calls.submitted, 1);
  e.disconnectedCallback();
});

test('CORACompileDrawer: diff cards render the counts from the diff signal', () => {
  const { e } = mount({
    open: true,
    diff: { added: 1, changed: 2, deprecated: 3 },
  });
  const body = e._children[1]._children[1];
  const diffSummary = body._children[0];
  assert.equal(diffSummary._children.length, 3);
  assert.equal(diffSummary._children[0]._children[0].textContent, '1');
  assert.equal(diffSummary._children[1]._children[0].textContent, '2');
  assert.equal(diffSummary._children[2]._children[0].textContent, '3');
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
  const body = e._children[1]._children[1];
  const codeBlock = body._children[1];

  assert.ok(codeBlock.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!codeBlock.innerHTML.includes('<img src=x'));
  assert.equal(codeBlock._children.length, 0);
  e.disconnectedCallback();
});

test('CORACompileDrawer: without a highlighter the code renders as plain text', () => {
  const { e } = mount({ open: true, highlight: null });
  const body = e._children[1]._children[1];
  const codeBlock = body._children[1];
  assert.equal(codeBlock.innerHTML, '');
  assert.ok(codeBlock.textContent.includes('"slug"'));
  e.disconnectedCallback();
});

test('CORACompileDrawer: hash meta reflects hashCode; missing hashCode says unavailable', async () => {
  const { e } = mount({ open: true });
  await flush();
  const foot = e._children[1]._children[2];
  assert.ok(foot._children[0].textContent.startsWith('sha256:deadbeef'));
  e.disconnectedCallback();

  const { e: e2 } = mount({ open: true, hashCode: null });
  await flush();
  const foot2 = e2._children[1]._children[2];
  assert.equal(foot2._children[0].textContent, 'hash: unavailable');
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
  const body = e._children[1]._children[1];
  assert.equal(body._children[1].className, 'sim-panel');
  assert.deepEqual(askedBanks, [bank]);
  e.disconnectedCallback();
});

test('CORACompileDrawer: no simulate panel when the page passes none', () => {
  const { e } = mount({ open: true });
  const body = e._children[1]._children[1];
  assert.ok(
    body._children.every(
      (/** @type {any} */ child) => child.className !== 'sim-panel'
    )
  );
  e.disconnectedCallback();
});
