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
const { register } = await import('../src/routes/dashboard.js');

/** @param {any} node @param {string} tag @returns {any|null} */
function findTag(node, tag) {
  if (node.tagName === tag.toUpperCase()) return node;
  for (const c of node._children ?? []) {
    const f = findTag(c, tag);
    if (f) return f;
  }
  return null;
}

test('routes-dashboard: registers #/dashboard route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({
      client: {},
      currentUser: { id: 'u1' },
      capabilities: {
        isReviewer: false,
        ownedCaseTypes: [],
        isAdviser: false,
      },
      eligibleCaseTypes: [],
    })
  );
  assert.ok(
    router._routes.some((r) => r.re.test('#/dashboard')),
    '#/dashboard should be registered'
  );
});

test('routes-dashboard: mounts DashboardPage output for a reviewer', () => {
  const client = /** @type {any} */ ({
    async listCases() {
      return [];
    },
  });
  const currentUser = { id: 'u1' };
  const capabilities = /** @type {any} */ ({
    isReviewer: true,
    ownedCaseTypes: [],
    isAdviser: false,
  });
  const eligibleCaseTypes = ['example-review'];

  const router = new Router();
  /** @type {any[]} */
  let mounted = [];
  const container = {
    replaceChildren(/** @type {any} */ ...args) {
      mounted = args;
    },
  };
  router._container = /** @type {any} */ (container);
  register(
    router,
    /** @type {any} */ ({
      client,
      currentUser,
      capabilities,
      eligibleCaseTypes,
    })
  );
  router.navigate('#/dashboard');

  assert.equal(mounted.length, 1, 'should mount a single host element');
  assert.ok(findTag(mounted[0], 'h1'), 'should render the page heading');
});

test('routes-dashboard: unmount is a no-op (does not throw)', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({
      client: {},
      currentUser: { id: 'u1' },
      capabilities: {
        isReviewer: false,
        ownedCaseTypes: [],
        isAdviser: false,
      },
      eligibleCaseTypes: [],
    })
  );
  const route = router._routes.find((r) => r.re.test('#/dashboard'));
  assert.ok(route, 'route should exist');
  assert.doesNotThrow(() => route.handler.unmount());
});

test('routes-dashboard: passes currentUserId, capabilities, eligibleCaseTypes through to the page', () => {
  const client = /** @type {any} */ ({
    async listCases() {
      return [];
    },
  });
  const currentUser = { id: 'u99' };
  const capabilities = /** @type {any} */ ({
    isReviewer: false,
    ownedCaseTypes: ['example-review'],
    isAdviser: false,
  });
  const eligibleCaseTypes = ['example-review'];

  const router = new Router();
  /** @type {any[]} */
  let mounted = [];
  const container = {
    replaceChildren(/** @type {any} */ ...args) {
      mounted = args;
    },
  };
  router._container = /** @type {any} */ (container);
  register(
    router,
    /** @type {any} */ ({
      client,
      currentUser,
      capabilities,
      eligibleCaseTypes,
    })
  );
  router.navigate('#/dashboard');

  assert.equal(mounted.length, 1, 'should mount a single host element');
  assert.ok(
    findTag(mounted[0], 'cr-owner-summary'),
    'should render the owner summary for owned case types'
  );
});
