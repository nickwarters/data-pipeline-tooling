// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    this.textContent = '';
    this.className = '';
    this.role = '';
    this.hidden = false;
    /** @type {Record<string, string>} */
    this._attrs = {};
    /** @type {Record<string, string>} */
    this.style = {};
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) { this._children = cs; }
  appendChild(/** @type {StubEl} */ c) { this._children.push(c); return c; }
  append(/** @type {StubEl[]} */ ...cs) { this._children.push(...cs); }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this._attrs[k] = v; }
  getAttribute(/** @type {string} */ k) { return this._attrs[k] ?? null; }
}

(/** @type {any} */ (globalThis)).HTMLElement = StubEl;
(/** @type {any} */ (globalThis)).document = {
  /** @param {string} _tag @returns {StubEl} */
  createElement(_tag) { return new StubEl(); },
  addEventListener() {},
  removeEventListener() {},
};
(/** @type {any} */ (globalThis)).customElements = { define() {} };
(/** @type {any} */ (globalThis)).location = { hash: '', reload() { reloadCalls++; } };
let reloadCalls = 0;

const { signal } = await import('../src/lib/signal.js');
const { CRStatusBanner } = await import('../src/components/cr-status-banner.js');

/**
 * @param {'saved'|'saving'|'reconnecting'|'conflict'} initial
 */
function makeQueue(initial = 'saved') {
  const s = signal(initial);
  return {
    status: s,
    set(/** @type {'saved'|'saving'|'reconnecting'|'conflict'} */ v) { s.set(v); },
  };
}

test('CRStatusBanner: when status is saved, renders no banner', () => {
  const el = new CRStatusBanner();
  el.saveQueue = /** @type {any} */ (makeQueue('saved'));
  el.connectedCallback();
  assert.equal((/** @type {any} */ (el))._children.length, 0);
});

test('CRStatusBanner: when status is saving, renders a polite live indicator with text Saving…', () => {
  const el = new CRStatusBanner();
  el.saveQueue = /** @type {any} */ (makeQueue('saving'));
  el.connectedCallback();

  const node = (/** @type {any} */ (el))._children[0];
  assert.ok(node, 'banner content should exist');
  assert.equal(node.textContent, 'Saving…');
  assert.equal(node._attrs['role'], 'status');
  assert.equal(node._attrs['aria-live'], 'polite');
});

test('CRStatusBanner: when status is reconnecting, renders gentler indicator', () => {
  const el = new CRStatusBanner();
  el.saveQueue = /** @type {any} */ (makeQueue('reconnecting'));
  el.connectedCallback();

  const node = (/** @type {any} */ (el))._children[0];
  assert.equal(node.textContent, 'Reconnecting…');
  assert.equal(node.className, 'cr-banner cr-banner-reconnecting');
});

test('CRStatusBanner: when status is conflict, renders persistent assertive banner with Reload button', () => {
  const el = new CRStatusBanner();
  el.saveQueue = /** @type {any} */ (makeQueue('conflict'));
  el.connectedCallback();

  const banner = (/** @type {any} */ (el))._children[0];
  assert.equal(banner.className, 'cr-banner cr-banner-conflict');
  assert.equal(banner._attrs['role'], 'alert');
  assert.equal(banner._attrs['aria-live'], 'assertive');

  const text = banner._children[0];
  assert.equal(text.textContent, 'This Case was edited in another tab. Reload to continue.');

  const btn = banner._children[1];
  assert.equal(btn.textContent, 'Reload');
  assert.equal(btn.className, 'cr-banner-reload');
});

test('CRStatusBanner: clicking Reload invokes location.reload()', () => {
  const before = reloadCalls;
  const el = new CRStatusBanner();
  el.saveQueue = /** @type {any} */ (makeQueue('conflict'));
  el.connectedCallback();

  const banner = (/** @type {any} */ (el))._children[0];
  const btn = banner._children[1];
  btn._listeners['click'][0]();
  assert.equal(reloadCalls - before, 1);
});

test('CRStatusBanner: status change from reconnecting to saved auto-clears the indicator', () => {
  const queue = makeQueue('reconnecting');
  const el = new CRStatusBanner();
  el.saveQueue = /** @type {any} */ (queue);
  el.connectedCallback();
  assert.equal((/** @type {any} */ (el))._children.length, 1);

  queue.set('saved');
  assert.equal((/** @type {any} */ (el))._children.length, 0,
    'banner should auto-dismiss when save recovers');
});

test('CRStatusBanner: conflict banner remains rendered when status updated again to conflict', () => {
  const queue = makeQueue('saving');
  const el = new CRStatusBanner();
  el.saveQueue = /** @type {any} */ (queue);
  el.connectedCallback();

  queue.set('conflict');
  const banner = (/** @type {any} */ (el))._children[0];
  assert.equal(banner.className, 'cr-banner cr-banner-conflict');
});

test('CRStatusBanner: connectedCallback with null saveQueue is a no-op', () => {
  const el = new CRStatusBanner();
  el.saveQueue = null;
  assert.doesNotThrow(() => el.connectedCallback());
  assert.equal((/** @type {any} */ (el))._children.length, 0);
});

test('CRStatusBanner: connectedCallback positions host element as fixed so it never causes layout shift', () => {
  const el = new CRStatusBanner();
  el.saveQueue = /** @type {any} */ (makeQueue('saved'));
  el.connectedCallback();
  const style = /** @type {any} */ (el).style;
  assert.equal(style.position, 'fixed', 'host element must be removed from document flow');
});
