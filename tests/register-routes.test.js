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
// Route modules load their page functions lazily (dynamic import() inside
// mount()), and those page modules call customElements.define at module-eval
// time. Install the stubs before navigating so that a mount-time dynamic import
// has them available.
/** @type {any} */ (globalThis).HTMLElement = class {};
/** @type {any} */ (globalThis).customElements = { define() {} };

const { Router } = await import('../src/lib/router.js');
const { registerRoutes, safeRegister } =
  await import('../src/setup/register-routes.js');

/** @returns {Promise<void>} */
async function tick() {
  await Promise.resolve();
}

/** @returns {import('../src/setup/register-routes.js').AppContext} */
function makeContext() {
  return /** @type {any} */ ({
    client: {},
    saveQueue: {},
    currentUser: { id: 'u1' },
    capabilities: {},
    caseSources: [],
    allCaseSources: [],
    journeyCaseSources: [],
    allocationSources: [],
    appEl: {
      classList: { add() {}, remove() {} },
      setAttribute() {},
      appendChild() {},
      replaceChildren() {},
    },
    loadQuestionBankEditor: () => Promise.resolve(),
  });
}

test('safeRegister: a throwing registration function does not propagate and is logged', () => {
  const router = new Router();
  const context = makeContext();
  /** @type {any[]} */
  const errorCalls = [];
  const origConsoleError = console.error;
  console.error = (/** @type {any[]} */ ...args) => errorCalls.push(args);

  try {
    assert.doesNotThrow(() => {
      safeRegister(
        'boom-route',
        () => {
          throw new Error('registration boom');
        },
        router,
        context
      );
    });
    assert.equal(errorCalls.length, 1, 'the failure should be logged once');
    assert.ok(
      errorCalls[0].some(
        (/** @type {any} */ arg) =>
          typeof arg === 'string' && arg.includes('boom-route')
      ),
      'console.error should mention the failing route name'
    );
  } finally {
    console.error = origConsoleError;
  }
});

test('safeRegister: a succeeding registration function runs with router + context', () => {
  const router = new Router();
  const context = makeContext();
  /** @type {any[]} */
  const calls = [];

  safeRegister(
    'ok-route',
    (/** @type {any} */ r, /** @type {any} */ c) => {
      calls.push([r, c]);
    },
    router,
    context
  );

  assert.equal(calls.length, 1, 'the registration function should run once');
  assert.equal(calls[0][0], router, 'router is passed through');
  assert.equal(calls[0][1], context, 'context is passed through');
});

test('registerRoutes: registers #/ route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(
    router._routes.some((r) => r.re.test('#/')),
    '#/ should be registered'
  );
});

test('registerRoutes: registers #/dashboard route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(
    router._routes.some((r) => r.re.test('#/dashboard')),
    '#/dashboard should be registered'
  );
});

test('registerRoutes: registers #/conversation/:id route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(
    router._routes.some((r) => r.re.test('#/conversation/99')),
    '#/conversation/:id should be registered'
  );
});

test('registerRoutes: registers source-key conversation route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(
    router._routes.some((r) => r.re.test('#/conversation/example-review/99')),
    '#/conversation/:caseType/:id should be registered'
  );
});

test('registerRoutes: registers #/question-bank route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(
    router._routes.some((r) => r.re.test('#/question-bank')),
    '#/question-bank should be registered'
  );
});

test('registerRoutes: registers #/case/:id route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(
    router._routes.some((r) => r.re.test('#/case/99')),
    '#/case/:id should be registered'
  );
});

test('registerRoutes: registers source-key case route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(
    router._routes.some((r) => r.re.test('#/case/example-review/99')),
    '#/case/:caseType/:id should be registered'
  );
});

test('registerRoutes: #/ mount renders home route directly (no redirect)', async () => {
  const rendered = /** @type {any[]} */ ([]);
  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      return {
        tagName: tag.toUpperCase(),
        textContent: '',
        className: '',
        href: '',
        _children: /** @type {any[]} */ ([]),
        appendChild(/** @type {any} */ child) {
          this._children.push(child);
          return child;
        },
        setAttribute() {},
      };
    },
    createTextNode(/** @type {string} */ text) {
      return /** @type {any} */ ({
        tagName: '#text',
        textContent: text,
        _children: [],
      });
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
  };

  const locations = /** @type {string[]} */ ([]);
  const origLocation = globalThis.location;
  /** @type {any} */ (globalThis).location = {
    get hash() {
      return '';
    },
    set hash(v) {
      locations.push(v);
    },
  };

  try {
    const router = new Router();
    router._container = /** @type {any} */ ({});
    const context = makeContext();
    context.capabilities = {
      isReviewer: false,
      ownedCaseTypes: [],
      isAdviser: false,
      isReviewerManager: false,
      isResponsiblePartyManager: false,
      isMaintainer: false,
      listAccessCaseTypes: [],
      ownedJourneyCaseTypes: [],
      isControls: false,
      isVisitor: true,
    };
    context.appEl.replaceChildren = (/** @type {any[]} */ ...children) => {
      rendered.splice(0, rendered.length, ...children);
    };
    registerRoutes(router, context);
    await router.navigate('#/');
    assert.equal(rendered.length, 1, 'home route should render one section');
    assert.equal(rendered[0].tagName, 'SECTION');
    assert.deepEqual(locations, [], 'should not redirect away from #/');
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
    /** @type {any} */ (globalThis).location = origLocation;
  }
});

test('registerRoutes: #/dashboard mount composes the dashboard page into the container', async () => {
  const rendered = /** @type {any[]} */ ([]);
  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    activeElement: null,
    createElement(/** @type {string} */ tag) {
      return {
        tagName: tag.toUpperCase(),
        _children: /** @type {any[]} */ ([]),
        replaceChildren(/** @type {any[]} */ ...cs) {
          this._children = cs;
        },
        setAttribute() {},
      };
    },
  };

  try {
    const router = new Router();
    const container = {
      replaceChildren(/** @type {any[]} */ ...children) {
        rendered.splice(0, rendered.length, ...children);
      },
    };
    router._container = /** @type {any} */ (container);
    const context = makeContext();
    // All-false capabilities: the page renders without hitting the client.
    context.capabilities = /** @type {any} */ ({
      isReviewer: false,
      ownedCaseTypes: [],
      isAdviser: false,
    });
    registerRoutes(router, context);
    await router.navigate('#/dashboard');
    assert.equal(
      rendered.length,
      1,
      'dashboard route mounts a single host node'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});

test('registerRoutes: #/question-bank mount adds cora-fullbleed to appEl', async () => {
  const router = new Router();
  const container = { replaceChildren() {} };
  router._container = /** @type {any} */ (container);
  const appEl = {
    classList: {
      added: /** @type {string[]} */ ([]),
      add(/** @type {string} */ c) {
        this.added.push(c);
      },
      remove() {},
    },
    setAttribute() {},
  };
  const ctx = /** @type {any} */ ({ ...makeContext(), appEl });

  registerRoutes(router, ctx);

  const origCreate = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      return { setAttribute() {} };
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
  };
  try {
    router.navigate('#/question-bank');
    await tick();
    assert.ok(
      appEl.classList.added.includes('cora-fullbleed'),
      'cora-fullbleed added on mount'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origCreate;
  }
});

test('registerRoutes: registers #/reports route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(
    router._routes.some((r) => r.re.test('#/reports')),
    '#/reports should be registered'
  );
});

test('registerRoutes: #/reports mount renders reports index directly', async () => {
  const rendered = /** @type {any[]} */ ([]);
  const origCreate = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      return {
        tagName: tag.toUpperCase(),
        textContent: '',
        className: '',
        href: '',
        _children: /** @type {any[]} */ ([]),
        appendChild(/** @type {any} */ child) {
          this._children.push(child);
          return child;
        },
        setAttribute() {},
      };
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
  };

  try {
    const router = new Router();
    const container = {
      replaceChildren(/** @type {any[]} */ ...children) {
        rendered.splice(0, rendered.length, ...children);
      },
    };
    router._container = /** @type {any} */ (container);
    const context = makeContext();
    context.capabilities = {
      isReviewer: false,
      ownedCaseTypes: [],
      isAdviser: false,
      isReviewerManager: true,
      isResponsiblePartyManager: false,
      isMaintainer: false,
      listAccessCaseTypes: [],
      ownedJourneyCaseTypes: [],
      isControls: false,
      isVisitor: false,
    };
    registerRoutes(router, context);
    await router.navigate('#/reports');
    assert.equal(rendered.length, 1, 'reports index should render one card');
    assert.equal(rendered[0].tagName, 'DIV');
  } finally {
    /** @type {any} */ (globalThis).document = origCreate;
  }
});

test('registerRoutes: registers #/reports/reviewer-team route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(
    router._routes.some((r) => r.re.test('#/reports/reviewer-team')),
    '#/reports/reviewer-team should be registered'
  );
});

test('registerRoutes: #/reports/reviewer-team redirects when the user is not a reviewer manager', async () => {
  const locations = /** @type {string[]} */ ([]);
  const origLocation = globalThis.location;
  /** @type {any} */ (globalThis).location = {
    get hash() {
      return '#/reports/reviewer-team';
    },
    set hash(v) {
      locations.push(v);
    },
  };

  try {
    const router = new Router();
    const container = { replaceChildren() {} };
    router._container = /** @type {any} */ (container);
    registerRoutes(
      router,
      /** @type {any} */ ({
        ...makeContext(),
        capabilities: { isReviewerManager: false },
      })
    );
    await router.navigate('#/reports/reviewer-team');
    assert.deepEqual(
      locations,
      ['#/reports'],
      'guard redirects non-managers back to #/reports'
    );
  } finally {
    /** @type {any} */ (globalThis).location = origLocation;
  }
});

test('registerRoutes: #/question-bank unmount removes cora-fullbleed from appEl', async () => {
  const router = new Router();
  const container = { replaceChildren() {} };
  router._container = /** @type {any} */ (container);
  const removed = /** @type {string[]} */ ([]);
  const appEl = {
    classList: {
      add() {},
      remove(/** @type {string} */ c) {
        removed.push(c);
      },
    },
    setAttribute() {},
  };
  const ctx = /** @type {any} */ ({
    ...makeContext(),
    appEl,
    // All-false capabilities so the follow-on #/dashboard mount renders without
    // touching the client.
    capabilities: { isReviewer: false, ownedCaseTypes: [], isAdviser: false },
  });

  registerRoutes(router, ctx);

  const origCreate = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    activeElement: null,
    createElement(/** @type {string} */ tag) {
      return {
        tagName: tag.toUpperCase(),
        _children: /** @type {any[]} */ ([]),
        replaceChildren(/** @type {any[]} */ ...cs) {
          this._children = cs;
        },
        setAttribute() {},
      };
    },
  };
  try {
    router.navigate('#/question-bank');
    await tick();
    await router.navigate('#/dashboard');
    assert.ok(
      removed.includes('cora-fullbleed'),
      'cora-fullbleed removed on unmount'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origCreate;
  }
});

test('registerRoutes: registers #/team-cases route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(
    router._routes.some((r) => r.re.test('#/team-cases')),
    '#/team-cases should be registered'
  );
});

test('registerRoutes: registers #/my-cases route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(
    router._routes.some((r) => r.re.test('#/my-cases')),
    '#/my-cases should be registered'
  );
});

test('registerRoutes: registers #/journey-cases route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(
    router._routes.some((r) => r.re.test('#/journey-cases')),
    '#/journey-cases should be registered'
  );
});
