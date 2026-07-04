// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';

installDom();
/** @type {any} */ (globalThis).location = {
  hash: '',
  reload() {
    reloadCalls++;
  },
};
let reloadCalls = 0;

const { signal } = await import('../src/lib/signal.js');
const { CORAStatusBanner, StatusBanner } =
  await import('../src/components/cora-status-banner.js');

/**
 * @param {'saved'|'saving'|'reconnecting'|'conflict'} initial
 */
function makeQueue(initial = 'saved') {
  const s = signal(initial);
  return {
    status: s,
    set(/** @type {'saved'|'saving'|'reconnecting'|'conflict'} */ v) {
      s.set(v);
    },
  };
}

test('CORAStatusBanner: when status is saved, renders no banner', () => {
  const el = new CORAStatusBanner();
  el.saveQueue = /** @type {any} */ (makeQueue('saved'));
  el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 0);
});

test('StatusBanner: plain function returns no nodes for saved status', () => {
  const node = StatusBanner({
    saveQueue: /** @type {any} */ (makeQueue('saved')),
  });

  assert.deepEqual(node, []);
});

test('StatusBanner: plain function renders transient status without a class instance', () => {
  const node = /** @type {any} */ (
    StatusBanner({
      saveQueue: /** @type {any} */ (makeQueue('saving')),
    })
  );

  assert.equal(node.textContent, 'Saving…');
  assert.equal(node.className, 'cora-banner cora-banner-saving');
  assert.equal(node.role || node.getAttribute('role'), 'status');
});

test('CORAStatusBanner: when status is saving, renders a polite live indicator with text Saving…', () => {
  const el = new CORAStatusBanner();
  el.saveQueue = /** @type {any} */ (makeQueue('saving'));
  el.connectedCallback();

  const node = /** @type {any} */ (el)._children[0];
  assert.ok(node, 'banner content should exist');
  assert.equal(node.textContent, 'Saving…');
  assert.equal(node.role || node.getAttribute('role'), 'status');
  assert.equal(node.getAttribute('aria-live'), 'polite');
});

test('CORAStatusBanner: when status is reconnecting, renders gentler indicator', () => {
  const el = new CORAStatusBanner();
  el.saveQueue = /** @type {any} */ (makeQueue('reconnecting'));
  el.connectedCallback();

  const node = /** @type {any} */ (el)._children[0];
  assert.equal(node.textContent, 'Reconnecting…');
  assert.equal(node.className, 'cora-banner cora-banner-reconnecting');
});

test('CORAStatusBanner: when status is conflict, renders persistent assertive banner with Reload button', () => {
  const el = new CORAStatusBanner();
  el.saveQueue = /** @type {any} */ (makeQueue('conflict'));
  el.connectedCallback();

  const banner = /** @type {any} */ (el)._children[0];
  assert.equal(banner.className, 'cora-banner cora-banner-conflict');
  assert.equal(banner.role || banner.getAttribute('role'), 'alert');
  assert.equal(banner.getAttribute('aria-live'), 'assertive');

  const text = banner._children[0];
  assert.equal(
    text.textContent,
    'This Case was edited in another tab. Reload to continue.'
  );

  const btn = banner._children[1];
  assert.equal(btn.textContent, 'Reload');
  assert.equal(btn.className, 'cora-banner-reload');
});

test('CORAStatusBanner: clicking Reload invokes location.reload()', () => {
  const before = reloadCalls;
  const el = new CORAStatusBanner();
  el.saveQueue = /** @type {any} */ (makeQueue('conflict'));
  el.connectedCallback();

  const banner = /** @type {any} */ (el)._children[0];
  const btn = banner._children[1];
  btn._listeners['click'][0]();
  assert.equal(reloadCalls - before, 1);
});

test('CORAStatusBanner: status change from reconnecting to saved auto-clears the indicator', () => {
  const queue = makeQueue('reconnecting');
  const el = new CORAStatusBanner();
  el.saveQueue = /** @type {any} */ (queue);
  el.connectedCallback();
  assert.equal(/** @type {any} */ (el)._children.length, 1);

  queue.set('saved');
  assert.equal(
    /** @type {any} */ (el)._children.length,
    0,
    'banner should auto-dismiss when save recovers'
  );
});

test('CORAStatusBanner: conflict banner remains rendered when status updated again to conflict', () => {
  const queue = makeQueue('saving');
  const el = new CORAStatusBanner();
  el.saveQueue = /** @type {any} */ (queue);
  el.connectedCallback();

  queue.set('conflict');
  const banner = /** @type {any} */ (el)._children[0];
  assert.equal(banner.className, 'cora-banner cora-banner-conflict');
});

test('CORAStatusBanner: connectedCallback with null saveQueue is a no-op', () => {
  const el = new CORAStatusBanner();
  el.saveQueue = null;
  assert.doesNotThrow(() => el.connectedCallback());
  assert.equal(/** @type {any} */ (el)._children.length, 0);
});

test('CORAStatusBanner: connectedCallback positions host element as fixed so it never causes layout shift', () => {
  const el = new CORAStatusBanner();
  el.saveQueue = /** @type {any} */ (makeQueue('saved'));
  el.connectedCallback();
  const style = /** @type {any} */ (el).style;
  assert.equal(
    style.position,
    'fixed',
    'host element must be removed from document flow'
  );
});
