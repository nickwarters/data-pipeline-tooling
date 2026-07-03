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
// The route modules now statically import their page functions, which pull in
// components that call customElements.define at module-eval time. Install the
// stubs before a dynamic import so that hoisted static imports can't run first.
/** @type {any} */ (globalThis).HTMLElement = class {};
/** @type {any} */ (globalThis).customElements = { define() {} };

const { Router } = await import('../src/lib/router.js');
const { registerRoutes } = await import('../src/setup/register-routes.js');

/** @returns {import('../src/setup/register-routes.js').AppContext} */
function makeContext() {
  return /** @type {any} */ ({
    client: {},
    saveQueue: {},
    currentUser: { id: 'u1' },
    capabilities: {},
    eligibleCaseTypes: [],
    appEl: {
      classList: { add() {}, remove() {} },
      setAttribute() {},
      appendChild() {},
      replaceChildren() {},
    },
  });
}

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

test('registerRoutes: #/ mount renders home route directly (no redirect)', () => {
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
    router.navigate('#/');
    assert.equal(rendered.length, 1, 'home route should render one section');
    assert.equal(rendered[0].tagName, 'SECTION');
    assert.deepEqual(locations, [], 'should not redirect away from #/');
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
    /** @type {any} */ (globalThis).location = origLocation;
  }
});

test('registerRoutes: #/dashboard mount composes the dashboard page into the container', () => {
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
    router.navigate('#/dashboard');
    assert.equal(
      rendered.length,
      1,
      'dashboard route mounts a single host node'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});

test('registerRoutes: #/question-bank mount adds cr-fullbleed to appEl', () => {
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
    assert.ok(
      appEl.classList.added.includes('cr-fullbleed'),
      'cr-fullbleed added on mount'
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

test('registerRoutes: #/reports mount renders reports index directly', () => {
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
    router.navigate('#/reports');
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

test('registerRoutes: #/reports/reviewer-team redirects when the user is not a reviewer manager', () => {
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
    router.navigate('#/reports/reviewer-team');
    assert.deepEqual(
      locations,
      ['#/reports'],
      'guard redirects non-managers back to #/reports'
    );
  } finally {
    /** @type {any} */ (globalThis).location = origLocation;
  }
});

test('registerRoutes: #/question-bank unmount removes cr-fullbleed from appEl', () => {
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
    router.navigate('#/dashboard');
    assert.ok(
      removed.includes('cr-fullbleed'),
      'cr-fullbleed removed on unmount'
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
