// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_dom-stub.js';

installDom();

const { mountAppChrome } = await import('../src/setup/app-chrome.js');

/** @type {any} */ (globalThis).document.body = new StubEl('body');

test('mountAppChrome: mounts cora-app-nav into appEl with capabilities set', async () => {
  const appEl = new StubEl('div');
  const capabilities = /** @type {any} */ ({ canReview: true });

  const ok = await mountAppChrome(/** @type {any} */ (appEl), capabilities, {
    loadNav: /** @type {any} */ (async () => ({})),
    loadPalette: /** @type {any} */ (async () => ({})),
    body: /** @type {any} */ (new StubEl('body')),
  });

  assert.equal(ok, true);
  const nav = appEl._children.find((c) => c._tagName === 'cora-app-nav');
  assert.ok(nav, 'cora-app-nav appended to appEl');
  assert.equal(/** @type {any} */ (nav).capabilities, capabilities);
});

test('mountAppChrome: palette failure is logged, non-fatal, and appends nothing to body', async () => {
  const appEl = new StubEl('div');
  const body = new StubEl('body');
  const capabilities = /** @type {any} */ ({});
  const origError = console.error;
  let loggedErr;
  console.error = (/** @type {any} */ ...args) => {
    loggedErr = args;
  };

  try {
    const ok = await mountAppChrome(/** @type {any} */ (appEl), capabilities, {
      loadNav: /** @type {any} */ (async () => ({})),
      loadPalette: /** @type {any} */ (
        async () => {
          throw new Error('palette boom');
        }
      ),
      body: /** @type {any} */ (body),
    });
    assert.equal(ok, true);
    assert.equal(body._children.length, 0, 'no palette appended');
    assert.ok(loggedErr, 'console.error was called');
  } finally {
    console.error = origError;
  }
});

test('mountAppChrome: palette success appends cora-command-palette to body', async () => {
  const appEl = new StubEl('div');
  const body = new StubEl('body');
  const capabilities = /** @type {any} */ ({});

  const ok = await mountAppChrome(/** @type {any} */ (appEl), capabilities, {
    loadNav: /** @type {any} */ (async () => ({})),
    loadPalette: /** @type {any} */ (async () => ({})),
    body: /** @type {any} */ (body),
  });

  assert.equal(ok, true);
  const palette = body._children.find(
    (c) => c._tagName === 'cora-command-palette'
  );
  assert.ok(palette, 'cora-command-palette appended to body');
});

test('mountAppChrome: default loaders resolve the real nav and palette modules', async () => {
  const appEl = new StubEl('div');
  const capabilities = /** @type {any} */ ({});

  const ok = await mountAppChrome(/** @type {any} */ (appEl), capabilities);

  assert.equal(ok, true);
  const nav = appEl._children.find((c) => c._tagName === 'cora-app-nav');
  assert.ok(nav, 'cora-app-nav appended to appEl via the real default loader');
  const body = /** @type {any} */ (globalThis).document.body;
  const palette = body._children.find(
    (/** @type {any} */ c) => c._tagName === 'cora-command-palette'
  );
  assert.ok(
    palette,
    'cora-command-palette appended to body via the real default loader'
  );
});

test('mountAppChrome: nav failure renders cora-boot-error into appEl and returns false', async () => {
  const appEl = new StubEl('div');
  const body = new StubEl('body');
  const capabilities = /** @type {any} */ ({});
  const origError = console.error;
  let loggedErr;
  console.error = (/** @type {any} */ ...args) => {
    loggedErr = args;
  };

  try {
    const ok = await mountAppChrome(/** @type {any} */ (appEl), capabilities, {
      loadNav: /** @type {any} */ (
        async () => {
          throw new Error('nav boom');
        }
      ),
      loadPalette: /** @type {any} */ (async () => ({})),
      body: /** @type {any} */ (body),
    });
    assert.equal(ok, false);
    assert.equal(appEl._children.length, 1);
    const panel = appEl._children[0];
    assert.equal(panel.className, 'cora-boot-error');
    assert.match(panel.textContent, /CORA failed to start/);
    assert.ok(loggedErr, 'console.error was called');
  } finally {
    console.error = origError;
  }
});
