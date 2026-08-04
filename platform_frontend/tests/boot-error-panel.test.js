// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_dom-stub.js';
import { captureConsoleError } from './_console.js';

installDom();
const { createBootErrorPanel, renderBootError } =
  await import('../src/lib/boot-error-panel.js');

/**
 * Render a boot error against a stubbed host page. The shared stub `document`
 * has neither `getElementById` nor `body`, so each call supplies both and puts
 * them back. `appRoot` is what `#app` resolves to — null models a host page
 * deployed without that root.
 *
 * @param {unknown} error
 * @param {any} appRoot
 * @returns {Promise<{ body: StubEl, logged: any[][] }>}
 */
async function renderInto(error, appRoot) {
  const G = /** @type {any} */ (globalThis);
  const hadGetElementById = 'getElementById' in G.document;
  const originalGetElementById = G.document.getElementById;
  const originalBody = G.document.body;
  const body = new StubEl('body');
  try {
    G.document.getElementById = () => appRoot;
    G.document.body = body;
    const { logged } = await captureConsoleError(() => renderBootError(error));
    return { body, logged };
  } finally {
    if (hadGetElementById) G.document.getElementById = originalGetElementById;
    else delete G.document.getElementById;
    if (originalBody === undefined) delete G.document.body;
    else G.document.body = originalBody;
  }
}

test('createBootErrorPanel: an alert div telling the user to reload', () => {
  const panel = createBootErrorPanel();
  assert.equal(panel.tagName, 'DIV');
  assert.equal(panel.className, 'cora-boot-error');
  assert.equal(panel.getAttribute('role'), 'alert');
  assert.match(panel.textContent, /failed to start/);
  assert.match(panel.textContent, /Reload/);
});

test('createBootErrorPanel: uses a supplied message', () => {
  const panel = createBootErrorPanel(
    'CORA failed to start: navigation could not load. Reload to retry.'
  );
  assert.match(panel.textContent, /navigation could not load/);
});

test('renderBootError: replaces #app with a panel that hides the raw error', async () => {
  const app = new StubEl('div');
  app.appendChild(new StubEl('p'));
  const { body } = await renderInto(new Error('boom'), app);
  assert.equal(app.childElementCount, 1);
  assert.equal(app.childNodes[0].className, 'cora-boot-error');
  assert.doesNotMatch(app.textContent, /boom/);
  assert.equal(body.childElementCount, 0);
});

test('renderBootError: logs the Error instance itself for whoever fixes it', async () => {
  const error = new Error('boom');
  const { logged } = await renderInto(error, new StubEl('div'));
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][0]), /Boot error/);
  assert.equal(logged[0][1], error);
});

test('renderBootError: falls back to the body when the host page has no #app', async () => {
  const { body } = await renderInto(new Error('boom'), null);
  assert.equal(body.childElementCount, 1);
  assert.equal(body.childNodes[0].className, 'cora-boot-error');
});
