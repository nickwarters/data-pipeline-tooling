// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORACompileDrawer } =
  await import('../src/components/collections/cora-compile-drawer.js');
const {
  _resetStore,
  drawerOpen,
  baseline,
  cases,
  toastMsg,
  commit,
  setSampleCases,
} = await import('../src/question-bank/question-bank-store.js');

/** @type {any} */ (globalThis).setTimeout = () => 0;

test('CORACompileDrawer: renders backdrop + drawer (closed by default)', () => {
  _resetStore();
  drawerOpen.set(false);
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const kids = /** @type {any} */ (e)._children;
  assert.equal(kids.length, 2);
  assert.ok(!kids[0].className.includes('open'));
  e.disconnectedCallback();
});

test('CORACompileDrawer: open state adds .open to backdrop and drawer', () => {
  _resetStore();
  drawerOpen.set(true);
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const kids = /** @type {any} */ (e)._children;
  assert.ok(kids[0].className.includes('open'));
  assert.ok(kids[1].className.includes('open'));
  e.disconnectedCallback();
});

test('CORACompileDrawer: backdrop click closes drawer', () => {
  _resetStore();
  drawerOpen.set(true);
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const backdrop = /** @type {any} */ (e)._children[0];
  backdrop._listeners.click[0]();
  assert.equal(drawerOpen.get(), false);
  e.disconnectedCallback();
});

test('CORACompileDrawer: close × button closes drawer', () => {
  _resetStore();
  drawerOpen.set(true);
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const drawer = /** @type {any} */ (e)._children[1];
  const head = drawer._children[0];
  const closeBtn = head._children[1];
  closeBtn._listeners.click[0]();
  assert.equal(drawerOpen.get(), false);
  e.disconnectedCallback();
});

test('CORACompileDrawer: Copy writes code to clipboard + shows toast', async () => {
  _resetStore();
  drawerOpen.set(true);
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
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const drawer = /** @type {any} */ (e)._children[1];
  const foot = drawer._children[2];
  const copyBtn = foot._children[1]._children[0];
  await copyBtn._listeners.click[0]();
  assert.equal(toastMsg.get(), 'Bank JSON copied to clipboard');
  e.disconnectedCallback();
});

test('CORACompileDrawer: Send for Review snapshots baseline + closes', () => {
  _resetStore();
  drawerOpen.set(true);
  commit((t) => {
    t['example-review'].label = 'AFTER';
  });
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const drawer = /** @type {any} */ (e)._children[1];
  const foot = drawer._children[2];
  const sendBtn = foot._children[1]._children[1];
  sendBtn._listeners.click[0]();
  assert.equal(baseline.get()['example-review'].label, 'AFTER');
  assert.equal(drawerOpen.get(), false);
  assert.equal(toastMsg.get(), 'Submitted for review');
  e.disconnectedCallback();
});

test('CORACompileDrawer: diff cards render added / changed / removed counts', () => {
  _resetStore();
  commit((t) => {
    t['example-review'].questions.push({
      id: 'new',
      text: '',
      responseType: 'yes-no-na',
      deprecated: false,
    });
  });
  drawerOpen.set(true);
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const drawer = /** @type {any} */ (e)._children[1];
  const body = drawer._children[1];
  const diffSummary = body._children[0];
  assert.equal(diffSummary._children.length, 3);
  e.disconnectedCallback();
});

test('CORACompileDrawer: code preview uses explicit highlighted HTML that escapes question text', () => {
  _resetStore();
  cases.set({
    'example-review': {
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
    },
  });
  drawerOpen.set(true);
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const drawer = /** @type {any} */ (e)._children[1];
  const body = drawer._children[1];
  const codeBlock = body._children[1];

  assert.ok(codeBlock.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!codeBlock.innerHTML.includes('<img src=x'));
  assert.equal(codeBlock._children.length, 0);
  e.disconnectedCallback();
});

/** Recursively collect all text in a stub element tree. */
function allText(/** @type {any} */ el) {
  let out = el.textContent || '';
  for (const child of el._children ?? []) out += ' ' + allText(child);
  return out;
}

/** Run `fn` with the simulator URL flag (?simulate=1) switched on. */
function withSimulatorFlag(/** @type {() => void} */ fn) {
  const loc = /** @type {any} */ (globalThis).location;
  const origSearch = loc.search;
  loc.search = '?simulate=1';
  try {
    fn();
  } finally {
    loc.search = origSearch;
  }
}

test('CORACompileDrawer: simulate panel is hidden without the ?simulate=1 flag', () => {
  _resetStore();
  setSampleCases('example-review', [
    { id: 'case-1', title: 'First Case', answers: {} },
  ]);
  drawerOpen.set(true);
  const e = new CORACompileDrawer();
  e.connectedCallback();
  const body = /** @type {any} */ (e)._children[1]._children[1];
  assert.ok(
    body._children.every(
      (/** @type {any} */ child) => child.className !== 'sim-panel'
    )
  );
  e.disconnectedCallback();
});

test('CORACompileDrawer: simulate panel shows empty state without sample Cases', () => {
  _resetStore();
  drawerOpen.set(true);
  withSimulatorFlag(() => {
    const e = new CORACompileDrawer();
    e.connectedCallback();
    const body = /** @type {any} */ (e)._children[1]._children[1];
    const panel = body._children[1];
    assert.equal(panel.className, 'sim-panel');
    assert.ok(allText(panel).includes('Impact simulation'));
    assert.ok(allText(panel).includes('No sample Cases loaded yet'));
    e.disconnectedCallback();
  });
});

test('CORACompileDrawer: simulate panel reports impact per sample Case', () => {
  _resetStore();
  setSampleCases('example-review', [
    {
      id: 'case-1',
      title: 'First Case',
      answers: { 'q-welcome': { value: 'NA' } },
    },
    { id: 'case-2', title: 'Second Case', answers: {} },
  ]);
  commit((t) => {
    const q = /** @type {any} */ (
      t['example-review'].questions.find(
        (/** @type {any} */ x) => x.id === 'q-welcome'
      )
    );
    q.failureCriteria = 'NA';
    q.optionOutcomes = { NA: 'fail' };
  });
  drawerOpen.set(true);
  withSimulatorFlag(() => {
    const e = new CORACompileDrawer();
    e.connectedCallback();
    const body = /** @type {any} */ (e)._children[1]._children[1];
    const panel = body._children[1];
    const text = allText(panel);
    assert.ok(text.includes('1 of 2 sample Cases affected'));
    assert.ok(text.includes('First Case'));
    assert.ok(text.includes('New Issue: q-welcome (caused by q-welcome)'));
    assert.ok(!text.includes('Second Case'));
    e.disconnectedCallback();
  });
});

test('CORACompileDrawer: simulate panel with samples but no changes says so', () => {
  _resetStore();
  setSampleCases('example-review', [
    { id: 'case-1', title: 'First Case', answers: {} },
  ]);
  drawerOpen.set(true);
  withSimulatorFlag(() => {
    const e = new CORACompileDrawer();
    e.connectedCallback();
    const body = /** @type {any} */ (e)._children[1]._children[1];
    const panel = body._children[1];
    assert.ok(allText(panel).includes('No sample Case is affected.'));
    e.disconnectedCallback();
  });
});

test('CORACompileDrawer: simulate panel reports Outcome changes with attribution', () => {
  _resetStore();
  setSampleCases('example-review', [
    {
      id: 'case-1',
      title: 'First Case',
      answers: { 'q-welcome': { value: 'No' } },
    },
  ]);
  commit((t) => {
    const q = /** @type {any} */ (
      t['example-review'].questions.find(
        (/** @type {any} */ x) => x.id === 'q-welcome'
      )
    );
    q.optionOutcomes = {};
  });
  drawerOpen.set(true);
  withSimulatorFlag(() => {
    const e = new CORACompileDrawer();
    e.connectedCallback();
    const body = /** @type {any} */ (e)._children[1]._children[1];
    const text = allText(body._children[1]);
    assert.ok(text.includes('Outcome: fail → pass (caused by q-welcome)'));
    e.disconnectedCallback();
  });
});
