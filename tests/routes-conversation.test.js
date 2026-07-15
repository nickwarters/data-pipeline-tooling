// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

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

async function settleRouteLoad() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  }
}

test('conversation route: register calls router.register with #/conversation/:id', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(router, /** @type {any} */ (makeContext()));
  assert.ok(
    router._routes.some((r) => r.re.test('#/conversation/99')),
    '#/conversation/:id should be registered'
  );
});

test('conversation route: registers source-key conversation route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(router, /** @type {any} */ (makeContext()));
  assert.ok(
    router._routes.some((r) => r.re.test('#/conversation/example-review/99')),
    '#/conversation/:caseType/:id should be registered'
  );
});

test('conversation route: unmount is a no-op (does not throw)', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(router, /** @type {any} */ (makeContext()));
  const route = router._routes.find((r) => r.re.test('#/conversation/99'));
  assert.ok(route, 'route should exist');
  assert.doesNotThrow(() => route.handler.unmount());
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
  router._container = /** @type {any} */ (container);

  register(router, /** @type {any} */ ({ client, saveQueue, currentUser }));
  router.navigate('#/conversation/123');

  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(rendered.length, 1, 'container should receive one host node');
  const host = /** @type {any} */ (rendered[0]);
  assert.equal(host._children.length, 2, 'header + cora-conversation rendered');
  const conversationEl = host._children[1];
  assert.equal(conversationEl.client, client);
  assert.equal(conversationEl.saveQueue, saveQueue);
  assert.equal(conversationEl.caseId, '123');
  assert.equal(conversationEl.currentUser, currentUser);
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
  router._container = /** @type {any} */ (container);

  register(
    router,
    /** @type {any} */ ({
      client,
      saveQueue: {},
      currentUser: { id: 'u42' },
    })
  );
  router.navigate('#/conversation/example-review/123');

  // loadCaseTypeConfig() performs a real dynamic import() of the case-type
  // module, and the module now reads the bank artifact before export.
  await settleRouteLoad();

  assert.equal(getCaseCalls.length, 1);
  assert.equal(getCaseCalls[0][0], '123');
  assert.equal(rendered.length, 1);
});
