// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();
let reloadCalls = 0;
/** @type {any} */ (globalThis).location = {
  reload() {
    reloadCalls++;
  },
};
const { StatusBanner } =
  await import('../src/components/base/cora-status-banner.js');

test('StatusBanner: saved status renders no nodes', () => {
  assert.deepEqual(StatusBanner({ status: 'saved' }), []);
});

test('StatusBanner: saving and reconnecting are polite live statuses', () => {
  for (const [status, message] of [
    ['saving', 'Saving…'],
    ['reconnecting', 'Reconnecting…'],
  ]) {
    const node = /** @type {any} */ (
      StatusBanner({ status: /** @type {any} */ (status) })
    );
    assert.equal(node.textContent, message);
    assert.equal(node.getAttribute('role'), 'status');
    assert.equal(node.getAttribute('aria-live'), 'polite');
  }
});

test('StatusBanner: conflict is assertive and Reload invokes location.reload', () => {
  const banner = /** @type {any} */ (StatusBanner({ status: 'conflict' }));
  assert.equal(banner.getAttribute('role'), 'alert');
  assert.equal(banner.getAttribute('aria-live'), 'assertive');
  assert.match(banner.textContent, /edited in another tab/);
  const before = reloadCalls;
  banner.querySelector('.cora-banner-reload').dispatchEvent({ type: 'click' });
  assert.equal(reloadCalls, before + 1);
});
