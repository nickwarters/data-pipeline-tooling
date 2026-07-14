// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_dom-stub.js';

installDom();

const { mountUatBanner } = await import('../src/setup/uat-banner.js');
const { resolveEnvironment } = await import('../src/config/environment.js');

test('mountUatBanner: renders nothing on prod', () => {
  const appEl = new StubEl('div');
  const banner = mountUatBanner(
    resolveEnvironment('prod'),
    /** @type {any} */ (appEl)
  );
  assert.equal(banner, null);
  assert.equal(appEl._children.length, 0);
});

test('mountUatBanner: mounts a labelled banner on uat', () => {
  const appEl = new StubEl('div');
  const banner = /** @type {StubEl | null} */ (
    mountUatBanner(resolveEnvironment('uat'), /** @type {any} */ (appEl))
  );
  assert.ok(banner, 'banner is returned');
  assert.equal(appEl._children[0], banner, 'banner is mounted into appEl');
  assert.equal(banner.className, 'cora-uat-banner');
  assert.equal(banner.getAttribute('role'), 'note');
  assert.match(banner.textContent, /UAT environment/);
  assert.match(banner.textContent, /uat_\*/);
});
