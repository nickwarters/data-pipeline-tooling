// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, waitFor } from './_dom-stub.js';
import { initRouter, routeRegistrationSpy } from './helpers/router.js';

installDom();

const permissions = {
  isReviewer: true,
  listAccessCaseTypes: [],
  isAdviser: false,
  ownedCaseTypes: [],
  ownedJourneyCaseTypes: [],
  isControls: false,
  isReviewerManager: false,
  isResponsiblePartyManager: false,
  isMaintainer: false,
  isVisitor: false,
};

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
  const currentUser = { id: 'u1', displayName: 'User One' };
  return {
    client: /** @type {any} */ ({
      async getCase() {
        return caseRow;
      },
    }),
    saveQueue: /** @type {any} */ ({ loadCase() {} }),
    currentUser: /** @type {any} */ (currentUser),
    chrome: /** @type {any} */ ({
      currentUser,
      permissions,
      nav: { currentHash: '#/' },
      toasts: [],
    }),
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

test('conversation route: mount renders the store-driven conversation page', async () => {
  const client = {
    async getCase(/** @type {string} */ id) {
      return {
        id,
        caseType: 'example-review',
        title: 'Case Title',
        status: 'In-progress',
        assignedReviewer: 'u42',
        responsibleParty: 'agent',
        answers: {},
        conversation: [],
        notes: '',
        completedAt: null,
        etag: 'v1',
      };
    },
  };
  const currentUser = { id: 'u42', displayName: 'Reviewer' };
  const container = document.createElement('div');

  const router = new Router();
  initRouter(router, /** @type {any} */ (container));

  register(
    router,
    /** @type {any} */ ({
      ...makeContext(),
      client,
      currentUser,
      chrome: {
        currentUser,
        permissions,
        nav: { currentHash: '#/' },
        toasts: [],
      },
    })
  );
  await router.navigate('#/conversation/123');
  await waitFor(() => container.textContent.includes('Case Title'));

  assert.match(container.textContent, /Case Title/);
  assert.match(container.textContent, /Conversation/);
  assert.equal(container.querySelector('cora-conversation'), null);
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
      return {
        id,
        caseType: 'example-review',
        title: 'Case Title',
        status: 'In-progress',
        assignedReviewer: 'u42',
        responsibleParty: 'agent',
        answers: {},
        conversation: [],
        notes: '',
        completedAt: null,
        etag: 'v1',
      };
    },
  };

  const container = document.createElement('div');

  const router = new Router();
  initRouter(router, /** @type {any} */ (container));

  register(
    router,
    /** @type {any} */ ({
      ...makeContext(),
      client,
    })
  );
  await router.navigate('#/conversation/example-review/123');
  await waitFor(() => container.textContent.includes('Case Title'));

  assert.equal(getCaseCalls.length, 1);
  assert.equal(getCaseCalls[0][0], '123');
  assert.match(container.textContent, /Case Title/);
});
