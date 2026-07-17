// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';

isolateBrowserGlobals();

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

/** @param {{ replaceChildren: (...children: any[]) => void }} [container] */
function makeRouter(container = { replaceChildren() {} }) {
  const router = new Router();
  // init() is the public container seam. It runs before registration here, so
  // its initial navigation intentionally finds no route.
  router.init(/** @type {any} */ (container));
  return router;
}

function registeredPatterns() {
  /** @type {string[]} */
  const patterns = [];
  const router = {
    register(/** @type {string} */ pattern) {
      patterns.push(pattern);
    },
  };
  registerRoutes(/** @type {any} */ (router), makeContext());
  return patterns;
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

test('registerRoutes: registers the complete public route contract', () => {
  assert.deepEqual(registeredPatterns(), [
    '#/',
    '#/dashboard',
    '#/conversation/:caseType/:id',
    '#/conversation/:id',
    '#/question-bank',
    '#/case/:caseType/:id',
    '#/case/:id',
    '#/reports',
    '#/reports/reviewer-team',
    '#/team-cases',
    '#/my-cases',
    '#/journey-cases',
  ]);
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
        children: /** @type {any[]} */ ([]),
        appendChild(/** @type {any} */ child) {
          this.children.push(child);
          return child;
        },
        setAttribute() {},
      };
    },
    createTextNode(/** @type {string} */ text) {
      return /** @type {any} */ ({
        tagName: '#text',
        textContent: text,
        children: [],
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
    const router = makeRouter();
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
        children: /** @type {any[]} */ ([]),
        replaceChildren(/** @type {any[]} */ ...cs) {
          this.children = cs;
        },
        setAttribute() {},
      };
    },
  };

  try {
    const container = {
      replaceChildren(/** @type {any[]} */ ...children) {
        rendered.splice(0, rendered.length, ...children);
      },
    };
    const router = makeRouter(container);
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
  const container = { replaceChildren() {} };
  const router = makeRouter(container);
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
        children: /** @type {any[]} */ ([]),
        appendChild(/** @type {any} */ child) {
          this.children.push(child);
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
    const container = {
      replaceChildren(/** @type {any[]} */ ...children) {
        rendered.splice(0, rendered.length, ...children);
      },
    };
    const router = makeRouter(container);
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
    // Note: this file is the page-agnostic boot/registration proof (it must stay
    // green even with a page file deleted — see the #384 DoD), so it does NOT
    // assert this is the real page vs. the cora-route-error panel. That
    // distinction is made in tests/routes-reports.test.js.
  } finally {
    /** @type {any} */ (globalThis).document = origCreate;
  }
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
    const container = { replaceChildren() {} };
    const router = makeRouter(container);
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
  const container = { replaceChildren() {} };
  const router = makeRouter(container);
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
        children: /** @type {any[]} */ ([]),
        replaceChildren(/** @type {any[]} */ ...cs) {
          this.children = cs;
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
