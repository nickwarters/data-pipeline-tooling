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

test('StatusBanner: saving is a polite live status', () => {
  const node = /** @type {any} */ (StatusBanner({ status: 'saving' }));
  assert.equal(node.textContent, 'Saving…');
  assert.equal(node.getAttribute('role'), 'status');
  assert.equal(node.getAttribute('aria-live'), 'polite');
});

test('StatusBanner: reconnecting says SharePoint cannot be reached and the changes are kept', () => {
  const node = /** @type {any} */ (StatusBanner({ status: 'reconnecting' }));
  assert.equal(
    node.textContent,
    "Can't reach SharePoint. Retrying… Your changes are kept while this tab stays open."
  );
  assert.equal(node.getAttribute('role'), 'status');
  assert.equal(node.getAttribute('aria-live'), 'polite');
  assert.ok(node.className.includes('cora-banner-reconnecting'));
});

test('StatusBanner: a long outage adds a pointer to the connection and VPN', () => {
  const short = /** @type {any} */ (StatusBanner({ status: 'reconnecting' }));
  const long = /** @type {any} */ (
    StatusBanner({ status: 'reconnecting', longOutage: true })
  );
  assert.ok(!/VPN/i.test(short.textContent));
  assert.ok(long.textContent.startsWith(short.textContent));
  assert.match(long.textContent, /Check your connection or VPN\.$/);
});

test('StatusBanner: failed is an assertive alert listing each distinct message once', () => {
  const banner = /** @type {any} */ (
    StatusBanner({
      status: 'failed',
      messages: [
        'Notes were refused.',
        'Pat could not be added.',
        'Notes were refused.',
      ],
    })
  );
  assert.equal(banner.getAttribute('role'), 'alert');
  assert.equal(banner.getAttribute('aria-live'), 'assertive');
  assert.ok(banner.className.includes('cora-banner-failed'));
  const items = banner
    .querySelectorAll('li')
    .map((/** @type {any} */ li) => li.textContent);
  assert.deepEqual(items, ['Notes were refused.', 'Pat could not be added.']);
});

test('StatusBanner: a single failure reads as a paragraph, not a one-item list', () => {
  const banner = /** @type {any} */ (
    StatusBanner({ status: 'failed', messages: ['Notes were refused.'] })
  );
  assert.equal(banner.querySelectorAll('li').length, 0);
  assert.equal(banner.querySelector('p').textContent, 'Notes were refused.');
});

test('StatusBanner: failed offers Reload only when asked to, and Reload reloads', () => {
  const without = /** @type {any} */ (
    StatusBanner({ status: 'failed', messages: ['x'] })
  );
  assert.equal(without.querySelector('.cora-banner-reload'), null);

  const banner = /** @type {any} */ (
    StatusBanner({ status: 'failed', messages: ['x'], offerReload: true })
  );
  const before = reloadCalls;
  banner.querySelector('.cora-banner-reload').dispatchEvent({ type: 'click' });
  assert.equal(reloadCalls, before + 1);
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
