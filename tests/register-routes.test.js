// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

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

import { Router } from '../src/lib/router.js';
import { registerRoutes } from '../src/setup/register-routes.js';

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
      isResponsibleParty: false,
      isReviewerManager: false,
      isResponsiblePartyManager: false,
      isMaintainer: false,
      isQaReviewer: false,
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

test('registerRoutes: #/dashboard mount creates cr-dashboard element', () => {
  const created = /** @type {string[]} */ ([]);
  const origCreate = globalThis.document?.createElement;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      created.push(tag);
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
    const router = new Router();
    const container = { replaceChildren() {} };
    router._container = /** @type {any} */ (container);
    registerRoutes(router, makeContext());
    router.navigate('#/dashboard');
    assert.ok(
      created.includes('cr-dashboard'),
      'cr-dashboard should be created on mount'
    );
  } finally {
    if (origCreate) {
      /** @type {any} */ (globalThis).document = { createElement: origCreate };
    } else {
      delete (/** @type {any} */ (globalThis).document);
    }
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

test('registerRoutes: #/reports mount creates cr-reports-index element', () => {
  const created = /** @type {string[]} */ ([]);
  const origCreate = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      created.push(tag);
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
    const router = new Router();
    const container = { replaceChildren() {} };
    router._container = /** @type {any} */ (container);
    registerRoutes(router, makeContext());
    router.navigate('#/reports');
    assert.ok(
      created.includes('cr-reports-index'),
      'cr-reports-index should be created on mount'
    );
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

test('registerRoutes: #/reports/reviewer-team mount creates cr-reviewer-team-report element', () => {
  const created = /** @type {string[]} */ ([]);
  const origCreate = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      created.push(tag);
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
    const router = new Router();
    const container = { replaceChildren() {} };
    router._container = /** @type {any} */ (container);
    registerRoutes(
      router,
      /** @type {any} */ ({
        ...makeContext(),
        capabilities: { isReviewerManager: true },
      })
    );
    router.navigate('#/reports/reviewer-team');
    assert.ok(
      created.includes('cr-reviewer-team-report'),
      'cr-reviewer-team-report should be created on mount'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origCreate;
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
