// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_dom-stub.js';

installDom();
const { mountAppChrome } = await import('../src/setup/app-chrome.js');
const navModule = await import('../src/components/sections/cora-app-nav.js');

function capabilities() {
  return /** @type {any} */ ({
    isReviewer: true,
    listAccessCaseTypes: [],
    isAdviser: false,
    ownedCaseTypes: ['complaints'],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isVisitor: false,
  });
}

function fakePalette() {
  return {
    commandPaletteStore: {},
    mountCommandPalette(/** @type {StubEl} */ root) {
      root.appendChild(new StubEl('input'));
    },
  };
}

test('mountAppChrome: mounts pure nav and palette views into their containers', async () => {
  const app = new StubEl('div');
  const body = new StubEl('body');
  const ok = await mountAppChrome(/** @type {any} */ (app), capabilities(), {
    loadNav: async () => navModule,
    loadPalette: async () => fakePalette(),
    body: /** @type {any} */ (body),
    navigationTarget: new StubEl('window'),
    readHash: () => '#/dashboard',
  });
  assert.equal(ok, true);
  assert.ok(app.querySelector('.cora-app-nav-bar'));
  const palette = body.querySelector('.cora-command-palette');
  assert.ok(palette);
  const input = palette.querySelector('input');
  assert.ok(input);
  assert.equal(input.tagName, 'INPUT');
});

test('mountAppChrome: hash changes update active navigation state', async () => {
  const app = new StubEl('div');
  const target = new StubEl('window');
  let hash = '#/dashboard';
  await mountAppChrome(/** @type {any} */ (app), capabilities(), {
    loadNav: async () => navModule,
    loadPalette: async () => fakePalette(),
    body: /** @type {any} */ (new StubEl('body')),
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

test('mountAppChrome: palette failure is logged and non-fatal', async () => {
  const app = new StubEl('div');
  const body = new StubEl('body');
  const original = console.error;
  /** @type {any[]} */
  let logged = [];
  console.error = (...args) => {
    logged = args;
  };
  try {
    const ok = await mountAppChrome(/** @type {any} */ (app), capabilities(), {
      loadNav: async () => navModule,
      loadPalette: async () => {
        throw new Error('palette boom');
      },
      body: /** @type {any} */ (body),
      navigationTarget: new StubEl('window'),
      readHash: () => '#/',
    });
    assert.equal(ok, true);
    assert.equal(body.childElementCount, 0);
    assert.match(String(logged[0]), /command palette failed/);
  } finally {
    console.error = original;
  }
});

test('mountAppChrome: palette mount failure removes its empty root and stays non-fatal', async () => {
  const app = new StubEl('div');
  const body = new StubEl('body');
  const original = console.error;
  console.error = () => {};
  try {
    const ok = await mountAppChrome(/** @type {any} */ (app), capabilities(), {
      loadNav: async () => navModule,
      loadPalette: async () => ({
        commandPaletteStore: {},
        mountCommandPalette() {
          throw new Error('mount boom');
        },
      }),
      body: /** @type {any} */ (body),
      navigationTarget: new StubEl('window'),
      readHash: () => '#/',
    });
    assert.equal(ok, true);
    assert.equal(body.childElementCount, 0);
  } finally {
    console.error = original;
  }
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
      loadPalette: async () => fakePalette(),
      body: /** @type {any} */ (new StubEl('body')),
    });
    assert.equal(ok, false);
    assert.ok(app.querySelector('.cora-boot-error'));
    assert.match(app.textContent, /failed to start/);
  } finally {
    console.error = original;
  }
});

test('mountAppChrome: default loaders mount the real pure-view modules', async () => {
  const app = new StubEl('div');
  const body = new StubEl('body');
  const ok = await mountAppChrome(/** @type {any} */ (app), capabilities(), {
    body: /** @type {any} */ (body),
    navigationTarget: new StubEl('window'),
    readHash: () => '#/',
  });
  assert.equal(ok, true);
  assert.ok(app.querySelector('.cora-app-nav-bar'));
  assert.ok(body.querySelector('.cora-command-palette'));
});
