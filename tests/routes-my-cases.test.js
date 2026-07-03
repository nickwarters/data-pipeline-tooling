// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** @type {Record<string, Function[]>} */
const windowListeners = {};
/** @type {any} */ (globalThis).window = {
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (windowListeners[t] ??= []).push(h);
  },
};
/** @type {any} */ (globalThis).location = { hash: '' };

class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, string>} */
    this._attrs = {};
    this.tagName = '';
    this.textContent = '';
    this.className = '';
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    this._children = cs;
  }
  appendChild(/** @type {StubEl} */ c) {
    this._children.push(c);
    return c;
  }
  addEventListener() {}
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    this._attrs[k] = v;
  }
  getAttribute(/** @type {string} */ k) {
    return this._attrs[k] ?? null;
  }
}
/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).customElements = {
  define() {},
  get() {
    return undefined;
  },
};

/** @type {any} */ (globalThis).document = {
  activeElement: null,
  createElement(/** @type {string} */ tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    return el;
  },
  createTreeWalker() {
    return {
      nextNode() {
        return null;
      },
    };
  },
};

const { Router } = await import('../src/lib/router.js');
const { register } = await import('../src/routes/my-cases.js');

/** @param {any} node @param {string} tag @returns {any|null} */
function findTag(node, tag) {
  if (node.tagName === tag.toUpperCase()) return node;
  for (const c of node._children ?? []) {
    const f = findTag(c, tag);
    if (f) return f;
  }
  return null;
}

test('routes-my-cases: registers #/my-cases route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({ client: {}, currentUser: { id: 'u1' } })
  );
  assert.ok(
    router._routes.some((r) => r.re.test('#/my-cases')),
    '#/my-cases should be registered'
  );
});

test('routes-my-cases: mounts ResponsiblePartyDashboard output', async () => {
  const client = /** @type {any} */ ({
    async listCases() {
      return [];
    },
  });
  const currentUser = { id: 'u1' };

  const router = new Router();
  /** @type {any[]} */
  let mounted = [];
  const container = {
    replaceChildren(/** @type {any} */ ...args) {
      mounted = args;
    },
  };
  router._container = /** @type {any} */ (container);
  register(router, /** @type {any} */ ({ client, currentUser }));
  router.navigate('#/my-cases');

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(mounted.length, 1, 'should mount a single host element');
  assert.ok(findTag(mounted[0], 'section'), 'should render the page sections');
});

test('routes-my-cases: unmount is a no-op (does not throw)', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({ client: {}, currentUser: { id: 'u1' } })
  );
  const route = router._routes.find((r) => r.re.test('#/my-cases'));
  assert.ok(route, 'route should exist');
  assert.doesNotThrow(() => route.handler.unmount());
});

test('routes-my-cases: passes client and currentUserId through to the page without wiring onOpenConversation (matches previous behaviour)', async () => {
  /** @type {any[]} */
  const calls = [];
  const client = /** @type {any} */ ({
    async listCases(/** @type {any} */ filter) {
      calls.push(filter);
      return [];
    },
  });
  const currentUser = { id: 'u99' };

  const router = new Router();
  /** @type {any[]} */
  let mounted = [];
  const container = {
    replaceChildren(/** @type {any} */ ...args) {
      mounted = args;
    },
  };
  router._container = /** @type {any} */ (container);
  register(router, /** @type {any} */ ({ client, currentUser }));
  router.navigate('#/my-cases');

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(mounted.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].responsibleParty, 'u99');
});
