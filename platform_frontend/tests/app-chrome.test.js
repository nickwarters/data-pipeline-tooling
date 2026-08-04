// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_dom-stub.js';
import { makePermissions } from './helpers/fixtures.js';

installDom();
const { mountAppChrome } = await import('../src/setup/app-chrome.js');
const navModule = await import('../src/components/sections/cora-app-nav.js');

// Owning a Case Type is what puts the Question Bank link in the nav, which the
// active-item assertions below rely on.
function capabilities() {
  return makePermissions({ ownedCaseTypes: ['complaints'] });
}

test('mountAppChrome: mounts the pure nav view into its container', async () => {
  const app = new StubEl('div');
  const ok = await mountAppChrome(/** @type {any} */ (app), capabilities(), {
    loadNav: async () => navModule,
    navigationTarget: new StubEl('window'),
    readHash: () => '#/dashboard',
  });
  assert.equal(ok, true);
  assert.ok(app.querySelector('.cora-app-nav-bar'));
});

test('mountAppChrome: hash changes update active navigation state', async () => {
  const app = new StubEl('div');
  const target = new StubEl('window');
  let hash = '#/dashboard';
  await mountAppChrome(/** @type {any} */ (app), capabilities(), {
    loadNav: async () => navModule,
    navigationTarget: target,
    readHash: () => hash,
  });
  hash = '#/question-bank/editor';
  target.dispatchEvent({ type: 'hashchange' });
  const bank = app
    .querySelectorAll('.cora-app-nav-item')
    .find((item) => item.href === '#/question-bank');
  assert.ok(bank);
  assert.equal(bank.getAttribute('aria-current'), 'page');
});

test('mountAppChrome: nav failure renders a fatal text-only boot error', async () => {
  const app = new StubEl('div');
  const original = console.error;
  console.error = () => {};
  try {
    const ok = await mountAppChrome(/** @type {any} */ (app), capabilities(), {
      loadNav: async () => {
        throw new Error('nav boom');
      },
    });
    assert.equal(ok, false);
    const panel = app.querySelector('.cora-boot-error');
    assert.ok(panel);
    assert.equal(panel.getAttribute('role'), 'alert');
    assert.match(app.textContent, /failed to start/);
  } finally {
    console.error = original;
  }
});

test('mountAppChrome: the default loader mounts the real pure-view module', async () => {
  const app = new StubEl('div');
  const ok = await mountAppChrome(/** @type {any} */ (app), capabilities(), {
    navigationTarget: new StubEl('window'),
    readHash: () => '#/',
  });
  assert.equal(ok, true);
  assert.ok(app.querySelector('.cora-app-nav-bar'));
});
