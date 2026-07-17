// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, waitForRender } from './_dom-stub.js';
import { initRouter, routeRegistrationSpy } from './helpers/router.js';

installDom();

/** @type {Record<string, Function[]>} */
const windowListeners = {};
/** @type {any} */ (globalThis).window = {
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (windowListeners[t] ??= []).push(h);
  },
};

const { Router } = await import('../src/lib/router.js');
const { register } = await import('../src/routes/conversation.js');

/** @param {{ caseRow?: any }} [opts] */
function makeContext(opts = {}) {
  const caseRow = 'caseRow' in opts ? opts.caseRow : null;
  return {
    client: /** @type {any} */ ({
      async getCase() {
        return caseRow;
      },
    }),
    saveQueue: /** @type {any} */ ({}),
    currentUser: /** @type {any} */ ({ id: 'u1' }),
  };
}

test('conversation route: register calls router.register with #/conversation/:id', () => {
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    /** @type {any} */ (makeContext())
  );
  assert.equal(registration.has('#/conversation/:id'), true);
});

test('conversation route: registers source-key conversation route', () => {
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    /** @type {any} */ (makeContext())
  );
  assert.equal(registration.has('#/conversation/:caseType/:id'), true);
});

test('conversation route: unmount is a no-op (does not throw)', () => {
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    /** @type {any} */ (makeContext())
  );
  assert.doesNotThrow(() =>
    registration.handlerFor('#/conversation/:id').unmount()
  );
});

test('conversation route: mount renders ConversationView output into the container', async () => {
  const client = {
    async getCase(/** @type {string} */ id) {
      return { id, title: 'Case Title', conversation: [] };
    },
  };
  const saveQueue = {};
  const currentUser = { id: 'u42' };

  /** @type {any[]} */
  const rendered = [];
  const container = {
    replaceChildren(/** @type {any[]} */ ...children) {
      rendered.splice(0, rendered.length, ...children);
    },
  };

  const router = new Router();
  initRouter(router, /** @type {any} */ (container));

  register(router, /** @type {any} */ ({ client, saveQueue, currentUser }));
  await router.navigate('#/conversation/123');

  assert.equal(rendered.length, 1, 'container should receive one host node');
  const host = /** @type {any} */ (rendered[0]);
  assert.equal(host._children.length, 2, 'header + cora-conversation rendered');
  const conversationEl = host._children[1];
  assert.equal(conversationEl.client, client);
  assert.equal(conversationEl.saveQueue, saveQueue);
  assert.equal(conversationEl.caseId, '123');
  assert.equal(conversationEl.currentUser, currentUser);
});

test('conversation route: renders a cora-route-error panel when the page module fails to load', async () => {
  const origConsoleError = console.error;
  console.error = () => {};
  try {
    /** @type {any[]} */
    let mounted = [];
    const container = {
      replaceChildren(/** @type {any} */ ...args) {
        mounted = args;
      },
    };

    const router = new Router();
    initRouter(router, /** @type {any} */ (container));

    register(router, /** @type {any} */ (makeContext()), () =>
      Promise.reject(new Error('boom'))
    );
    await router.navigate('#/conversation/99');

    assert.equal(mounted.length, 1);
    assert.equal(mounted[0].className, 'cora-route-error');
  } finally {
    console.error = origConsoleError;
  }
});

test('conversation route: source-key route passes caseType through to the fetched case', async () => {
  /** @type {any[]} */
  const getCaseCalls = [];
  const client = {
    async getCase(/** @type {string} */ id, /** @type {any} */ opts) {
      getCaseCalls.push([id, opts]);
      return { id, title: 'Case Title', conversation: [] };
    },
  };

  /** @type {any[]} */
  const rendered = [];
  const container = {
    replaceChildren(/** @type {any[]} */ ...children) {
      rendered.splice(0, rendered.length, ...children);
    },
  };

  const router = new Router();
  initRouter(router, /** @type {any} */ (container));

  register(
    router,
    /** @type {any} */ ({
      client,
      saveQueue: {},
      currentUser: { id: 'u42' },
    })
  );
  await router.navigate('#/conversation/example-review/123');
  await waitForRender(rendered[0]);

  assert.equal(getCaseCalls.length, 1);
  assert.equal(getCaseCalls[0][0], '123');
  assert.equal(rendered.length, 1);
});
